import { Router } from 'express'
import { criarAutorizador } from './routes/contexto.js'
import type { Dependencias } from './routes/contexto.js'
import { registrarMetricas } from './routes/metricas.js'
import { registrarCatalogo, registrarPublicacao } from './routes/produtos.js'
import { registrarPrecos } from './routes/precos.js'
import { registrarManutencao } from './routes/manutencao.js'
import { registrarLinksAfiliados } from './routes/linksAfiliados.js'

export function criarRotaValioProdutos(deps: Dependencias = {}) {
  const router = Router()
  const contexto = { deps, autorizar: criarAutorizador(deps) }
  registrarMetricas(router, contexto)
  registrarCatalogo(router, contexto)
  registrarPrecos(router, contexto)
  registrarManutencao(router, contexto)
  registrarLinksAfiliados(router, contexto)
  registrarPublicacao(router, contexto)
  return router
}
