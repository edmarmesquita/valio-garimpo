import type { Router } from 'express'
import { criarCatalogoGateway, criarConsultaProdutosGateway, criarProdutosGateway, publicarProduto } from '../services/supabase.js'
import { validarProdutoPublicacao } from '../valioProduto.js'
import type { ContextoRotas } from './contexto.js'
import { ErroDestinoAfiliado } from '../validarDestinoAfiliado.js'

export function registrarCatalogo(router: Router, { deps, autorizar }: ContextoRotas) {

  router.get('/catalogo', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    let etapa = 'criar cliente Supabase'
    try {
      const gateway = (deps.catalogo ?? criarCatalogoGateway)(config)
      etapa = 'consultar tabela produtos'
      const produtos = await gateway.listar()
      res.json({ ok: true, produtos })
    } catch (erro) {
      const diagnostico = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'
      const dados = typeof erro === 'object' && erro !== null ? erro as { status?: unknown; code?: unknown } : {}
      const statusHttpSupabase = typeof dados.status === 'number' && dados.status >= 100 && dados.status <= 599
        ? dados.status : null
      const codigoSupabase = typeof dados.code === 'string'
        && (/^[0-9A-Z]{5}$/.test(dados.code) || /^PGRST\d{3}$/.test(dados.code)) ? dados.code : null
      const mensagemSanitizada = codigoSupabase === '42P01' ? 'Tabela do catálogo não encontrada.'
        : codigoSupabase === '42703' ? 'Coluna do catálogo não encontrada.'
          : codigoSupabase === '42501' || statusHttpSupabase === 403 ? 'Acesso à tabela do catálogo negado.'
            : statusHttpSupabase === 401 ? 'Credencial do Supabase rejeitada.'
              : statusHttpSupabase === 404 ? 'Recurso do catálogo não encontrado.'
                : statusHttpSupabase === null && etapa === 'consultar tabela produtos'
                  ? 'Consulta sem resposta HTTP identificável; verifique rede ou erro local.'
                  : 'Falha na consulta ao catálogo; detalhes omitidos.'
      res.status(502).json({
        ok: false, erro: 'Não foi possível consultar o catálogo do Valiô.',
        ...(diagnostico ? {
          etapa, statusHttpSupabase, codigoSupabase, mensagemSanitizada,
          supabaseUrlPresente: Boolean(config.url),
          supabaseUrlHttpsValida: URL.canParse(config.url) && new URL(config.url).protocol === 'https:',
          serviceRolePresente: Boolean(config.serviceRoleKey),
          tabela: 'produtos',
          chegouAoSupabase: etapa === 'criar cliente Supabase' ? false : statusHttpSupabase === null ? null : true,
        } : {}),
      })
    }
  })
}

export function registrarPublicacao(router: Router, { deps, autorizar }: ContextoRotas) {
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
    } catch (erro) {
      const codigo = typeof erro === 'object' && erro !== null && 'code' in erro
        && typeof erro.code === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(erro.code)
        ? erro.code : undefined
      console.error('[valio] Falha na verificação de produtos:', {
        status: 502,
        message: 'Não foi possível verificar os produtos no Valiô.',
        cause: codigo ?? (erro instanceof Error ? 'Error' : typeof erro),
        quantidadeIds: ids.length,
      })
      res.status(502).json({ ok: false, erro: 'Não foi possível verificar os produtos no Valiô.' })
    }
  })
  router.post('/produtos', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const somenteCriar = req.body?.somenteCriar === true
    if (req.body?.somenteCriar !== undefined && req.body.somenteCriar !== true) {
      res.status(400).json({ ok: false, erro: 'somenteCriar inválido.' })
      return
    }
    let produto
    try {
      const { somenteCriar: _opcao, ...dados } = req.body ?? {}
      void _opcao
      produto = validarProdutoPublicacao(dados)
    }
    catch (erro) {
      res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Produto inválido.' })
      return
    }
    try {
      const gateway = (deps.gateway ?? criarProdutosGateway)(config)
      const informada = req.get('x-valio-origem-link') ?? ''
      const origem = ['importacao-html', 'importacao-json', 'gerador-lote'].includes(informada)
        ? informada : 'publicacao:recebido'
      const acao = await publicarProduto(produto, gateway, somenteCriar, deps.validarDestino, origem)
      res.json({ ok: true, acao })
    } catch (erro) {
      if (erro instanceof ErroDestinoAfiliado) {
        res.status(erro.status).json({ ok: false, erro: erro.message }); return
      }
      if (somenteCriar && (erro as { code?: string })?.code === '23505') {
        res.status(409).json({ ok: false, erro: 'Produto já existe no Valiô; nenhuma alteração foi feita.' })
        return
      }
      if (somenteCriar && erro instanceof Error && /link afiliado oficial|Criação exclusiva/.test(erro.message)) {
        res.status(400).json({ ok: false, erro: erro.message })
        return
      }
      res.status(502).json({ ok: false, erro: 'Falha ao publicar no Valiô. Confira a configuração e tente novamente.' })
    }
  })
}
