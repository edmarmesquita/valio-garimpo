import { createClient } from '@supabase/supabase-js'
import type { SupabaseConfig } from './supabase.js'

export type CliqueEntrada = { mercadoLivreId: string; categoria: string | null; origem: string | null }
export type LinhaCliquesDia = { mercadoLivreId: string; categoria: string | null; dia: string; cliques: number }
export type CliquesGateway = {
  registrar: (clique: CliqueEntrada) => Promise<void>
  listarPorDia: (inicio?: string) => Promise<LinhaCliquesDia[]>
}

export function criarCliquesGateway(config: SupabaseConfig): CliquesGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async registrar(clique) {
      const { error } = await supabase.from('produto_cliques').insert({
        mercado_livre_id: clique.mercadoLivreId, categoria: clique.categoria, origem: clique.origem,
      })
      if (error) throw error
    },
    async listarPorDia(inicio) {
      const linhas: LinhaCliquesDia[] = []
      const tamanho = 1000
      for (let offset = 0; ; offset += tamanho) {
        let consulta = supabase.from('produto_cliques_diario')
          .select('mercado_livre_id,categoria,dia,cliques')
          .order('dia', { ascending: false })
          .order('mercado_livre_id', { ascending: true })
          .order('categoria', { ascending: true })
          .range(offset, offset + tamanho - 1)
        if (inicio) consulta = consulta.gte('dia', inicio)
        const { data, error } = await consulta
        if (error) throw error
        linhas.push(...(data ?? []).map((row) => ({
          mercadoLivreId: row.mercado_livre_id, categoria: row.categoria,
          dia: row.dia, cliques: Number(row.cliques),
        })))
        if (!data || data.length < tamanho) return linhas
      }
    },
  }
}
