import type { Router } from 'express'
import { criarCatalogoGateway, diagnosticarSupabaseEnv, getSupabaseConfig } from '../services/supabase.js'
import { criarCliquesGateway } from '../services/cliques.js'
import { diagnosticarErroClique } from '../services/diagnosticoCliques.js'
import { agregarCliques, inicioPeriodo, PERIODOS_CLIQUES, validarClique } from '../metricasCliques.js'
import type { PeriodoCliques } from '../metricasCliques.js'
import type { ContextoRotas } from './contexto.js'

export function registrarMetricas(router: Router, { deps, autorizar }: ContextoRotas) {
  let janelaCliques = 0
  let cliquesNaJanela = 0

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
}
