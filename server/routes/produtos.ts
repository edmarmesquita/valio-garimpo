import type { Router } from 'express'
import { criarCatalogoGateway, criarConsultaProdutosGateway, criarProdutosGateway, publicarProduto } from '../services/supabase.js'
import { validarProdutoPublicacao } from '../valioProduto.js'
import type { ContextoRotas } from './contexto.js'

export function registrarCatalogo(router: Router, { deps, autorizar }: ContextoRotas) {

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
    } catch {
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
      const acao = await publicarProduto(produto, gateway, somenteCriar)
      res.json({ ok: true, acao })
    } catch (erro) {
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
