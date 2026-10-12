import { createHash, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { criarCatalogoGateway, criarConsultaProdutosGateway, criarProdutosGateway, diagnosticarSupabaseEnv, getSupabaseConfig, publicarProduto } from './services/supabase.js'
import type { CatalogoGateway, ConsultaProdutosGateway, ProdutosGateway, SupabaseConfig } from './services/supabase.js'
import { CATEGORIAS_VALIO, validarProdutoPublicacao } from './valioProduto.js'
import { criarCliquesGateway } from './services/cliques.js'
import type { CliquesGateway } from './services/cliques.js'
import { diagnosticarErroClique } from './services/diagnosticoCliques.js'
import { agregarCliques, inicioPeriodo, PERIODOS_CLIQUES, validarClique } from './metricasCliques.js'
import type { PeriodoCliques } from './metricasCliques.js'

type Dependencias = {
  config?: () => SupabaseConfig | null
  gateway?: (config: SupabaseConfig) => ProdutosGateway
  consulta?: (config: SupabaseConfig) => ConsultaProdutosGateway
  catalogo?: (config: SupabaseConfig) => CatalogoGateway
  cliques?: (config: SupabaseConfig) => CliquesGateway
  token?: () => string | undefined
  agora?: () => Date
  limiteCliques?: number
}

type PrecoLote = { mercadoLivreId: string; preco: number; atualizarPreco: boolean }
function validarPrecosLote(corpo: unknown): PrecoLote[] | null {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null
  const entrada = corpo as Record<string, unknown>
  if (Object.keys(entrada).length !== 1 || !Array.isArray(entrada.produtos) || !entrada.produtos.length || entrada.produtos.length > 50) return null
  const ids = new Set<string>()
  const produtos: PrecoLote[] = []
  for (const bruto of entrada.produtos) {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
    const item = bruto as Record<string, unknown>
    if (Object.keys(item).length !== 3 || typeof item.mercadoLivreId !== 'string' || !/^MLB\d+$/.test(item.mercadoLivreId)
      || typeof item.preco !== 'number' || !Number.isFinite(item.preco) || item.preco <= 0
      || typeof item.atualizarPreco !== 'boolean' || ids.has(item.mercadoLivreId)) return null
    ids.add(item.mercadoLivreId)
    produtos.push(item as PrecoLote)
  }
  return produtos
}

function tokenValido(informado: string | undefined, esperado: string): boolean {
  if (!informado) return false
  const hashInformado = createHash('sha256').update(informado).digest()
  const hashEsperado = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(hashInformado, hashEsperado)
}

export function criarRotaValioProdutos(deps: Dependencias = {}) {
  const router = Router()
  let janelaCliques = 0
  let cliquesNaJanela = 0
  function autorizar(req: import('express').Request, res: import('express').Response): SupabaseConfig | null {
    const config = (deps.config ?? getSupabaseConfig)()
    const esperado = (deps.token ?? (() => process.env.VALIO_PUBLISH_TOKEN))()?.trim()
    if (!config || !esperado || esperado.length < 32 || esperado === config.serviceRoleKey) {
      res.status(503).json({ ok: false, erro: 'Publicação no Valiô não configurada no servidor.' })
      return null
    }
    const authorization = req.get('authorization')
    const informado = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    if (!tokenValido(informado, esperado)) {
      res.status(401).json({ ok: false, erro: 'Token de publicação inválido.' })
      return null
    }
    return config
  }
  router.post('/cliques', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let clique
    try { clique = validarClique(req.body) }
    catch (erro) { res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Clique inválido.' }); return }
    const agora = (deps.agora ?? (() => new Date()))().getTime()
    if (agora - janelaCliques >= 60_000) { janelaCliques = agora; cliquesNaJanela = 0 }
    if (cliquesNaJanela >= (deps.limiteCliques ?? 600)) { res.status(429).json({ ok: false, erro: 'Limite de cliques atingido. Tente novamente depois.' }); return }
    cliquesNaJanela++
    const config = (deps.config ?? getSupabaseConfig)()
    if (!config) {
      if (!deps.config) console.error('Valiô cliques: configuração Supabase indisponível', diagnosticarSupabaseEnv())
      res.status(503).json({ ok: false, erro: 'Registro de cliques indisponível.' })
      return
    }
    try {
      await (deps.cliques ?? criarCliquesGateway)(config).registrar(clique)
      res.status(201).json({ ok: true })
    } catch (erro) {
      console.error('Valiô cliques: falha na inserção Supabase', diagnosticarErroClique(erro))
      res.status(502).json({ ok: false, erro: 'Não foi possível registrar o clique.' })
    }
  })
  router.get('/metricas/cliques', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    const periodo = req.query.periodo ?? '30dias'
    if (typeof periodo !== 'string' || !PERIODOS_CLIQUES.includes(periodo as PeriodoCliques)) {
      res.status(400).json({ ok: false, erro: 'Período inválido.' }); return
    }
    try {
      const agora = (deps.agora ?? (() => new Date()))()
      const [linhas, catalogo] = await Promise.all([
        (deps.cliques ?? criarCliquesGateway)(config).listarPorDia(inicioPeriodo(periodo as PeriodoCliques, agora)),
        (deps.catalogo ?? criarCatalogoGateway)(config).listar(),
      ])
      res.json({ ok: true, ...agregarCliques(linhas, catalogo, periodo as PeriodoCliques, agora) })
    } catch { res.status(502).json({ ok: false, erro: 'Não foi possível consultar as métricas.' }) }
  })
  router.get('/catalogo', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    try {
      const produtos = await (deps.catalogo ?? criarCatalogoGateway)(config).listar()
      res.json({ ok: true, produtos })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível consultar o catálogo do Valiô.' })
    }
  })
  router.patch('/produtos/precos-lote', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const produtos = validarPrecosLote(req.body)
    if (!produtos) { res.status(400).json({ ok: false, erro: 'Envie de 1 a 50 produtos com ITEM_ID, preço e atualizarPreco, sem duplicatas.' }); return }
    const agora = (deps.agora ?? (() => new Date()))()
    const dataPreco = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora)
    const updatedAt = agora.toISOString()
    const gateway = (deps.catalogo ?? criarCatalogoGateway)(config)
    const resultados: { mercadoLivreId: string; status: 'atualizado' | 'confirmado' | 'erro'; erro?: string; dataPreco?: string; updatedAt?: string }[] = []
    for (let inicio = 0; inicio < produtos.length; inicio += 5) {
      const bloco = produtos.slice(inicio, inicio + 5)
      resultados.push(...await Promise.all(bloco.map(async (produto) => {
        try {
          const encontrado = await gateway.atualizarPreco(produto.mercadoLivreId, produto.preco, dataPreco, updatedAt, !produto.atualizarPreco)
          return encontrado
            ? { mercadoLivreId: produto.mercadoLivreId, status: produto.atualizarPreco ? 'atualizado' as const : 'confirmado' as const, dataPreco, updatedAt }
            : { mercadoLivreId: produto.mercadoLivreId, status: 'erro' as const, erro: produto.atualizarPreco ? 'Produto não encontrado.' : 'Produto não encontrado ou preço salvo diferente.' }
        } catch { return { mercadoLivreId: produto.mercadoLivreId, status: 'erro' as const, erro: 'Falha ao atualizar o produto.' } }
      })))
    }
    const atualizados = resultados.filter((item) => item.status === 'atualizado').length
    const confirmados = resultados.filter((item) => item.status === 'confirmado').length
    res.json({ ok: true, atualizados, confirmados, erros: resultados.length - atualizados - confirmados, resultados })
  })
  router.patch('/produtos/:mercadoLivreId/status', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const id = req.params.mercadoLivreId
    if (typeof id !== 'string' || !/^MLB\d+$/.test(id) || !req.body || typeof req.body !== 'object'
      || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || typeof req.body.ativo !== 'boolean') {
      res.status(400).json({ ok: false, erro: 'Envie um ITEM_ID válido e somente ativo: true ou false.' })
      return
    }
    try {
      const encontrado = await (deps.catalogo ?? criarCatalogoGateway)(config).alterarStatus(id, req.body.ativo)
      if (!encontrado) { res.status(404).json({ ok: false, erro: 'Produto não encontrado.' }); return }
      res.json({ ok: true, mercadoLivreId: id, ativo: req.body.ativo })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível alterar o status do produto.' })
    }
  })
  router.patch('/produtos/:mercadoLivreId/categoria', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const id = req.params.mercadoLivreId
    const categoria = req.body?.categoria
    if (typeof id !== 'string' || !/^MLB\d+$/.test(id) || !req.body || typeof req.body !== 'object'
      || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !CATEGORIAS_VALIO.includes(categoria)) {
      res.status(400).json({ ok: false, erro: 'Envie um ITEM_ID e uma categoria válida.' })
      return
    }
    try {
      const encontrado = await (deps.catalogo ?? criarCatalogoGateway)(config).alterarCategoria(id, categoria)
      if (!encontrado) { res.status(404).json({ ok: false, erro: 'Produto não encontrado.' }); return }
      res.json({ ok: true, mercadoLivreId: id, categoria })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível alterar a categoria do produto.' })
    }
  })
  router.post('/produtos/verificar', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body?.mercadoLivreIds
    if (!Array.isArray(entrada) || entrada.some((id) => typeof id !== 'string')) {
      res.status(400).json({ ok: false, erro: 'Envie mercadoLivreIds como lista de IDs.' })
      return
    }
    const ids = [...new Set(entrada.map((id: string) => id.trim()).filter(Boolean))]
    if (ids.length > 500 || ids.some((id) => !/^MLB\d+$/.test(id))) {
      res.status(400).json({ ok: false, erro: 'Envie até 500 ITEM_IDs válidos.' })
      return
    }
    if (!ids.length) { res.json({ ok: true, existentes: [] }); return }
    try {
      const existentes = await (deps.consulta ?? criarConsultaProdutosGateway)(config).consultarExistentes(ids)
      res.json({ ok: true, existentes })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível verificar os produtos no Valiô.' })
    }
  })
  router.post('/produtos', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    let produto
    try { produto = validarProdutoPublicacao(req.body) }
    catch (erro) {
      res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Produto inválido.' })
      return
    }
    try {
      const gateway = (deps.gateway ?? criarProdutosGateway)(config)
      const acao = await publicarProduto(produto, gateway)
      res.json({ ok: true, acao })
    } catch {
      res.status(502).json({ ok: false, erro: 'Falha ao publicar no Valiô. Confira a configuração e tente novamente.' })
    }
  })
  return router
}
