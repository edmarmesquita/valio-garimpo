import { Router } from 'express'
import { criarAutorizador } from './routes/contexto.js'
import type { Dependencias } from './routes/contexto.js'
import { registrarMetricas } from './routes/metricas.js'
import { registrarCatalogo, registrarPublicacao } from './routes/produtos.js'
import { registrarPrecos } from './routes/precos.js'
import { registrarPrecosHar } from './routes/precosHar.js'
import { registrarManutencao } from './routes/manutencao.js'
import { registrarLinksAfiliados } from './routes/linksAfiliados.js'
import { registrarOfertasRelampago } from './routes/ofertasRelampago.js'
import { registrarReativacaoInativos } from './routes/reativacaoInativos.js'

export function criarRotaValioProdutos(deps: Dependencias = {}) {
  const router = Router()
  const contexto = { deps, autorizar: criarAutorizador(deps) }
  registrarMetricas(router, contexto)
  registrarCatalogo(router, contexto)
  registrarPrecos(router, contexto)
  registrarPrecosHar(router, contexto)
  registrarManutencao(router, contexto)
  registrarReativacaoInativos(router, contexto)
  registrarLinksAfiliados(router, contexto)
  registrarOfertasRelampago(router, contexto)
  registrarPublicacao(router, contexto)
  return router
}
