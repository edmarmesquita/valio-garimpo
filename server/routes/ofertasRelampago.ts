import type { Router } from 'express'
import { criarOfertasGateway } from '../services/supabase.js'
import { assinarPrevia, confirmarPreviaOfertas, criarPreviaOfertas, criarPreviaLimpezaExpiradas, validarAssinatura, validarPedidoOfertas } from '../ofertasRelampagoLote.js'
import type { ContextoRotas } from './contexto.js'

export function registrarOfertasRelampago(router: Router, { deps, autorizar }: ContextoRotas) {
  router.post('/ofertas-relampago/listar', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    const pedido = req.body
    if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)
      || Object.keys(pedido).some((chave) => chave !== 'itemId')
      || pedido.itemId !== undefined && (typeof pedido.itemId !== 'string' || !/^MLB\d+$/.test(pedido.itemId))) {
      res.status(400).json({ ok: false, erro: 'Consulta de ofertas inválida.' }); return
    }
    try {
      const gateway = (deps.ofertas ?? criarOfertasGateway)(config)
      const encontrados = pedido.itemId ? await gateway.buscar(pedido.itemId)
        : await (gateway.listarGerenciamento ?? gateway.listarAtivas)()
      if (pedido.itemId && encontrados.length !== 1) {
        res.status(404).json({ ok: false, erro: 'ITEM_ID não encontrado ou ambíguo.' }); return
      }
      const produtos = encontrados.map((produto) => ({
        mercado_livre_id: produto.mercado_livre_id, titulo: produto.titulo, imagem: produto.imagem,
        categoria: produto.categoria, preco: produto.preco, ativo: produto.ativo,
        oferta_relampago: produto.oferta_relampago, oferta_inicio: produto.oferta_inicio, oferta_fim: produto.oferta_fim,
        preco_anterior: produto.preco_anterior, percentual_desconto: produto.percentual_desconto,
        prioridade_oferta: produto.prioridade_oferta,
        home_oferta_mode: produto.home_oferta_mode ?? 'auto',
        controle_home_disponivel: Object.hasOwn(produto, 'home_oferta_mode'),
      }))
      res.json({ ok: true, produtos })
    } catch { res.status(502).json({ ok: false, erro: 'Não foi possível carregar as ofertas do catálogo.' }) }
  })

  router.post('/ofertas-relampago/expiradas/prever', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
      res.status(400).json({ ok: false, erro: 'A limpeza consulta as expiradas no catálogo; não envie campos de produto.' }); return
    }
    try {
      const previa = await criarPreviaLimpezaExpiradas((deps.ofertas ?? criarOfertasGateway)(config), (deps.agora?.() ?? new Date()).getTime())
      res.json({ ok: true, previa, assinatura: assinarPrevia(previa, config.serviceRoleKey) })
    } catch (erro) { res.status(409).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível preparar a limpeza.' }) }
  })

  router.post('/ofertas-relampago/prever', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    try { validarPedidoOfertas(req.body) }
    catch (erro) { res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Lote inválido.' }); return }
    try {
      const previa = await criarPreviaOfertas(req.body, (deps.ofertas ?? criarOfertasGateway)(config))
      res.json({ ok: true, previa, assinatura: assinarPrevia(previa, config.serviceRoleKey) })
    } catch (erro) {
      res.status(409).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível preparar a prévia.' })
    }
  })

  router.post('/ofertas-relampago/confirmar', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)
      || Object.keys(entrada).length !== 2 || !Object.hasOwn(entrada, 'previa') || !Object.hasOwn(entrada, 'assinatura')
      || !validarAssinatura(entrada.previa, entrada.assinatura, config.serviceRoleKey)) {
      res.status(400).json({ ok: false, erro: 'Prévia inválida ou expirada; consulte novamente antes de confirmar.' }); return
    }
    try {
      const resultado = await confirmarPreviaOfertas(entrada.previa, (deps.ofertas ?? criarOfertasGateway)(config),
        new Date(), [config.serviceRoleKey, req.headers.authorization ?? ''])
      res.json({ ok: true, ...resultado })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível consultar o estado atual das ofertas.' })
    }
  })
}
