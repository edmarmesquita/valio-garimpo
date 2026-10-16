import type { Router } from 'express'
import { criarOfertasGateway } from '../services/supabase.js'
import { assinarPrevia, confirmarPreviaOfertas, criarPreviaOfertas, validarAssinatura, validarPedidoOfertas } from '../ofertasRelampagoLote.js'
import type { ContextoRotas } from './contexto.js'

export function registrarOfertasRelampago(router: Router, { deps, autorizar }: ContextoRotas) {
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
