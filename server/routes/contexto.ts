import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { getSupabaseConfig } from '../services/supabase.js'
import type { CatalogoGateway, ConsultaProdutosGateway, LinkAfiliadoGateway, ProdutosGateway, SupabaseConfig } from '../services/supabase.js'
import type { CliquesGateway } from '../services/cliques.js'
import type { OfertaGateway } from '../ofertasRelampagoLote.js'

export type Dependencias = {
  config?: () => SupabaseConfig | null
  gateway?: (config: SupabaseConfig) => ProdutosGateway
  consulta?: (config: SupabaseConfig) => ConsultaProdutosGateway
  catalogo?: (config: SupabaseConfig) => CatalogoGateway
  linkAfiliado?: (config: SupabaseConfig) => LinkAfiliadoGateway
  cliques?: (config: SupabaseConfig) => CliquesGateway
  ofertas?: (config: SupabaseConfig) => OfertaGateway
  token?: () => string | undefined
  agora?: () => Date
  limiteCliques?: number
}

function tokenValido(informado: string | undefined, esperado: string): boolean {
  if (!informado) return false
  const hashInformado = createHash('sha256').update(informado).digest()
  const hashEsperado = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(hashInformado, hashEsperado)
}

export function criarAutorizador(deps: Dependencias) {
  return function autorizar(req: Request, res: Response): SupabaseConfig | null {
    const config = (deps.config ?? getSupabaseConfig)()
    const esperado = (deps.token ?? (() => process.env.VALIO_PUBLISH_TOKEN))()?.trim()
    if (!config || !esperado || esperado.length < 32 || esperado === config.serviceRoleKey) {
      res.status(503).json({ ok: false, erro: 'Publicação no Valiô não configurada no servidor.' })
      return null
    }
    const authorization = req.get('authorization')
    const informado = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    if (!tokenValido(informado, esperado)) {
      res.status(401).json({ ok: false, erro: 'Token de publicação inválido.' })
      return null
    }
    return config
  }
}

export type ContextoRotas = { deps: Dependencias; autorizar: ReturnType<typeof criarAutorizador> }
