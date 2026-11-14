import type { Router } from 'express'
import { criarCatalogoGateway } from '../services/supabase.js'
import { CATEGORIAS_VALIO } from '../valioProduto.js'
import type { ContextoRotas } from './contexto.js'

export function registrarManutencao(router: Router, { deps, autorizar }: ContextoRotas) {

  router.post('/produtos/exclusao-definitiva', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body as { id_interno?: unknown; confirmar?: unknown } | null
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)
      || Object.keys(entrada).sort().join(',') !== 'confirmar,id_interno'
      || entrada.confirmar !== true || !Number.isSafeInteger(entrada.id_interno) || (entrada.id_interno as number) <= 0) {
      res.status(400).json({ ok: false, erro: 'Confirme explicitamente a exclusão e informe um ID interno válido.' })
      return
    }
    const id = entrada.id_interno as number
    try {
      const gateway = (deps.catalogo ?? criarCatalogoGateway)(config)
      const existente = await gateway.buscarPorIdInterno(id)
      if (!existente) { res.status(404).json({ ok: false, erro: 'Produto não encontrado; nada foi excluído.' }); return }
      const excluido = await gateway.excluirPorIdInterno(id)
      if (excluido === null) { res.status(404).json({ ok: false, erro: 'Produto não encontrado no momento da exclusão; nada foi removido.' }); return }
      if (excluido !== id) { res.status(502).json({ ok: false, erro: 'A API não confirmou a exclusão do ID solicitado.' }); return }
      res.json({ ok: true, id_interno: id })
    } catch (erro) {
      if ((erro as { code?: string })?.code === '23503') {
        res.status(409).json({ ok: false, erro: 'O produto possui registros relacionados; a exclusão foi bloqueada para preservar a integridade e o histórico.' })
        return
      }
      res.status(502).json({ ok: false, erro: 'Não foi possível confirmar a exclusão definitiva do produto.' })
    }
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
}
