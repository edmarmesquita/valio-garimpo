import type { Router } from 'express'
import { criarLinkAfiliadoGateway } from '../services/supabase.js'
import { ehLinkOficialParaAtualizacao } from '../../src/lib/linksAfiliados.js'
import { confirmarLinksLote, criarPreviaLinks } from '../linksAfiliadosLote.js'
import type { ContextoRotas } from './contexto.js'
import { ErroDestinoAfiliado, resolverItemId, validarDestinoAfiliado } from '../validarDestinoAfiliado.js'

export function registrarLinksAfiliados(router: Router, { deps, autorizar }: ContextoRotas) {

  router.post('/produtos/links-afiliados/identificar', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)
      || Object.keys(entrada).length !== 1 || !Array.isArray(entrada.links)
      || entrada.links.length < 1 || entrada.links.length > 50
      || entrada.links.some((link: unknown) => typeof link !== 'string' || !ehLinkOficialParaAtualizacao(link))) {
      res.status(400).json({ ok: false, erro: 'Envie de 1 a 50 links oficiais para identificar.' }); return
    }
    const resolver = deps.resolverDestino ?? resolverItemId
    const destinos = await Promise.all(entrada.links.map(async (link: string) => {
      try { return await resolver(link) } catch { return null }
    }))
    res.json({ ok: true, destinos: destinos.map((itemId) => /^MLB\d+$/.test(itemId ?? '') ? itemId : null) })
  })

  router.patch('/produtos/link-afiliado', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)
      || Object.keys(entrada).length !== 2 || !Object.hasOwn(entrada, 'mercado_livre_id')
      || !Object.hasOwn(entrada, 'link_afiliado')
      || typeof entrada.mercado_livre_id !== 'string' || !/^MLB\d+$/.test(entrada.mercado_livre_id)
      || typeof entrada.link_afiliado !== 'string' || !ehLinkOficialParaAtualizacao(entrada.link_afiliado)) {
      res.status(400).json({ ok: false, erro: 'Informe um ITEM_ID válido e um link oficial HTTPS meli.la ou /social/ com rastreamento.' })
      return
    }
    try {
      const gateway = (deps.linkAfiliado ?? criarLinkAfiliadoGateway)(config)
      const encontrados = await gateway.buscar(entrada.mercado_livre_id)
      if (!encontrados.length) { res.status(404).json({ ok: false, erro: 'Produto não encontrado.' }); return }
      if (encontrados.length !== 1) { res.status(409).json({ ok: false, erro: 'Mais de um produto corresponde ao ITEM_ID.' }); return }
      const anterior = encontrados[0]
      await (deps.validarDestino ?? validarDestinoAfiliado)(entrada.mercado_livre_id, entrada.link_afiliado, 'atualizacao:individual')
      const atualizados = await gateway.atualizar(entrada.mercado_livre_id, anterior.link_afiliado, entrada.link_afiliado)
      if (atualizados.length !== 1 || atualizados[0].mercado_livre_id !== entrada.mercado_livre_id
        || atualizados[0].link_afiliado !== entrada.link_afiliado) {
        res.status(409).json({ ok: false, erro: 'O link mudou durante a atualização ou mais de um produto foi afetado. Confira o cadastro.' })
        return
      }
      res.json({ ok: true, produto: anterior.titulo, mercado_livre_id: entrada.mercado_livre_id,
        link_anterior: anterior.link_afiliado, link_afiliado: atualizados[0].link_afiliado })
    } catch (erro) {
      if (erro instanceof ErroDestinoAfiliado) {
        res.status(erro.status).json({ ok: false, erro: erro.message }); return
      }
      res.status(502).json({ ok: false, erro: 'Não foi possível atualizar o link afiliado.' })
    }
  })
  router.post('/produtos/links-afiliados/previa', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).length !== 1 || typeof req.body.texto !== 'string') {
      res.status(400).json({ ok: false, erro: 'Envie somente texto com até 50 linhas.' }); return
    }
    try {
      const previa = await criarPreviaLinks(req.body.texto, (deps.linkAfiliado ?? criarLinkAfiliadoGateway)(config), deps.validarDestino)
      res.json({ ok: true, ...previa })
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Lote inválido.' })
    }
  })
  router.patch('/produtos/links-afiliados', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).length !== 2 || typeof req.body.texto !== 'string'
      || !Array.isArray(req.body.confirmacoes)) {
      res.status(400).json({ ok: false, erro: 'Envie o lote e as confirmações da prévia.' }); return
    }
    try {
      const resultado = await confirmarLinksLote(req.body.texto, req.body.confirmacoes,
        (deps.linkAfiliado ?? criarLinkAfiliadoGateway)(config), deps.validarDestino)
      res.json({ ok: true, ...resultado })
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Lote inválido.' })
    }
  })
}
