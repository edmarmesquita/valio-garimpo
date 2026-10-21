import { createClient } from '@supabase/supabase-js'
import type { SupabaseConfig } from './supabase.js'
import type { LinhaPrecoHar, PrecosHarGateway } from '../precosHar.js'

export function criarPrecosHarGateway(config: SupabaseConfig, enviar: typeof fetch = fetch): PrecosHarGateway {
  const db = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: enviar } })
  return {
    async buscar(id) {
      const { data, error } = await db.from('produtos').select('mercado_livre_id,titulo,preco,ativo,oferta_relampago,oferta_inicio,oferta_fim')
        .eq('mercado_livre_id', id).limit(2)
      if (error) throw new Error('Falha na consulta.')
      return data as LinhaPrecoHar[]
    },
    async atualizar(anterior, novoPreco) {
      let q = db.from('produtos').update({ preco: novoPreco }).eq('mercado_livre_id', anterior.mercado_livre_id)
        .eq('ativo', true).eq('preco', anterior.preco).eq('oferta_relampago', anterior.oferta_relampago)
      for (const coluna of ['oferta_inicio', 'oferta_fim'] as const) q = anterior[coluna] === null ? q.is(coluna, null) : q.eq(coluna, anterior[coluna])
      const { data, error } = await q.select('mercado_livre_id')
      if (error) throw new Error('Falha na atualização condicional.')
      return data?.length ?? 0
    },
  }
}
