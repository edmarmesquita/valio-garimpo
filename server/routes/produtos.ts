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
}
