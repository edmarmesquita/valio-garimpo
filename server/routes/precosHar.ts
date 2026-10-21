import type { Router } from 'express'
import type { ContextoRotas } from './contexto.js'
import { criarPrecosHarGateway } from '../services/precosHar.js'
import { assinarPreviaHar, assinaturaHarValida, processarPrecosHar, validarPedidoHar } from '../precosHar.js'
import type { RevalidacaoHar } from '../../src/lib/atualizacaoHarTipos.js'
import { selecaoCorrespondeHar } from '../../src/lib/vinculoPreviaHar.js'

export function registrarPrecosHar(router: Router, { deps, autorizar }: ContextoRotas) {
  router.post('/produtos/precos-har/revalidar', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res); if (!config) return
    let itens
    try { itens = validarPedidoHar(req.body) } catch { res.status(400).json({ ok: false, erro: 'Pedido HAR inválido. Use catálogo API, preços válidos e somente os campos permitidos.' }); return }
    const agora = () => (deps.agora?.() ?? new Date()).getTime()
    const resultados = await processarPrecosHar(itens, (deps.precosHar ?? criarPrecosHarGateway)(config), agora)
    const previa: RevalidacaoHar = { finalidade: 'precos-har-v1', versao: req.body.versao, fonte: 'api', emitidaEm: agora(), itens, resultados }
    res.json({ ok: true, previa, assinatura: assinarPreviaHar(previa, config.serviceRoleKey) })
  })
  router.post('/produtos/precos-har/confirmar', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const config = autorizar(req, res); if (!config) return
    const agora = () => (deps.agora?.() ?? new Date()).getTime()
    const b = req.body
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 3
      || !['previa', 'assinatura', 'selecaoAtual'].every((k) => Object.hasOwn(b, k))
      || !assinaturaHarValida(b.previa, b.assinatura, config.serviceRoleKey, agora())
      || !selecaoCorrespondeHar(b.previa, b.selecaoAtual)) {
      res.status(409).json({ ok: false, erro: 'Revalidação inválida ou expirada. Revalide novamente.' }); return
    }
    let itens
    try { itens = validarPedidoHar({ fonte: b.previa.fonte, versao: b.previa.versao, itens: b.previa.itens }) }
    catch { res.status(400).json({ ok: false, erro: 'Prévia inválida.' }); return }
    const prontos = new Set(b.previa.resultados.filter((p: { status: string }) => p.status === 'PRONTO').map((p: { itemId: string }) => p.itemId))
    const atualizados = await processarPrecosHar(itens.filter((i) => prontos.has(i.itemId)), (deps.precosHar ?? criarPrecosHarGateway)(config), agora, true)
    const porId = new Map(atualizados.map((r) => [r.itemId, r]))
    const resultados = b.previa.resultados.map((r: { itemId: string }) => porId.get(r.itemId) ?? r)
    res.json({ ok: true, resultados })
  })
}
