import type { Router } from 'express'
import { criarCatalogoGateway } from '../services/supabase.js'
import { CATEGORIAS_VALIO } from '../valioProduto.js'
import type { ContextoRotas } from './contexto.js'

export function registrarManutencao(router: Router, { deps, autorizar }: ContextoRotas) {

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
}
