import { createClient } from '@supabase/supabase-js'
import type { ProdutoPublicacao } from '../valioProduto.js'

export type SupabaseConfig = { url: string; serviceRoleKey: string }
export type AcaoPublicacao = 'criado' | 'atualizado'
export type ProdutoRow = {
  mercado_livre_id: string
  titulo: string
  descricao: string
  preco: number
  data_preco: string
  link_afiliado: string
  categoria: string
  rating: number | null
  imagem: string
  ativo: true
  updated_at: string
}
export type ProdutosGateway = {
  existe: (mercadoLivreId: string) => Promise<boolean>
  upsert: (row: ProdutoRow) => Promise<void>
}
export type ProdutoExistente = {
  mercadoLivreId: string
  titulo: string
  preco: number
  dataPreco: string
  categoria: string
  linkAfiliado: string
  imagem: string
  ativo: boolean
}
export type ConsultaProdutosGateway = { consultarExistentes: (ids: string[]) => Promise<ProdutoExistente[]> }
export type ProdutoCatalogo = ProdutoExistente & { rating: number | null; updatedAt: string }
export type CatalogoGateway = {
  listar: () => Promise<ProdutoCatalogo[]>
  alterarStatus: (id: string, ativo: boolean) => Promise<boolean>
  alterarCategoria: (id: string, categoria: string) => Promise<boolean>
  atualizarPreco: (id: string, preco: number, dataPreco: string, updatedAt: string, confirmar: boolean) => Promise<boolean>
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null
  try {
    if (new URL(url).protocol !== 'https:') return null
    return { url, serviceRoleKey }
  } catch { return null }
}

export function criarProdutosGateway(config: SupabaseConfig): ProdutosGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async existe(mercadoLivreId) {
      const { data, error } = await supabase.from('produtos')
        .select('id').eq('mercado_livre_id', mercadoLivreId).maybeSingle()
      if (error) throw error
      return data !== null
    },
    async upsert(row) {
      const { error } = await supabase.from('produtos')
        .upsert(row, { onConflict: 'mercado_livre_id' }).select('id').single()
      if (error) throw error
    },
  }
}

export function criarConsultaProdutosGateway(config: SupabaseConfig): ConsultaProdutosGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async consultarExistentes(ids) {
      const { data, error } = await supabase.from('produtos')
        .select('mercado_livre_id,titulo,preco,data_preco,categoria,link_afiliado,imagem,ativo')
        .in('mercado_livre_id', ids)
      if (error) throw error
      return (data ?? []).map((row) => ({
        mercadoLivreId: row.mercado_livre_id, titulo: row.titulo, preco: row.preco,
        dataPreco: row.data_preco, categoria: row.categoria, linkAfiliado: row.link_afiliado,
        imagem: row.imagem, ativo: row.ativo,
      }))
    },
  }
}

export function criarCatalogoGateway(config: SupabaseConfig): CatalogoGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async listar() {
      const produtos: ProdutoCatalogo[] = []
      const tamanho = 500
      for (let inicio = 0; ; inicio += tamanho) {
        const { data, error } = await supabase.from('produtos')
          .select('mercado_livre_id,titulo,preco,data_preco,categoria,link_afiliado,imagem,rating,ativo,updated_at')
          .order('id', { ascending: true }).range(inicio, inicio + tamanho - 1)
        if (error) throw error
        produtos.push(...(data ?? []).map((row) => ({
          mercadoLivreId: row.mercado_livre_id, titulo: row.titulo, preco: row.preco,
          dataPreco: row.data_preco, categoria: row.categoria, linkAfiliado: row.link_afiliado,
          imagem: row.imagem, rating: row.rating, ativo: row.ativo, updatedAt: row.updated_at,
        })))
        if (!data || data.length < tamanho) return produtos
      }
    },
    async alterarStatus(id, ativo) {
      const { data, error } = await supabase.from('produtos').update({ ativo })
        .eq('mercado_livre_id', id).select('mercado_livre_id').maybeSingle()
      if (error) throw error
      return data !== null
    },
    async alterarCategoria(id, categoria) {
      const { data, error } = await supabase.from('produtos')
        .update({ categoria, updated_at: new Date().toISOString() })
        .eq('mercado_livre_id', id).select('mercado_livre_id').maybeSingle()
      if (error) throw error
      return data !== null
    },
    async atualizarPreco(id, preco, dataPreco, updatedAt, confirmar) {
      const alteracoes = confirmar ? { data_preco: dataPreco, updated_at: updatedAt }
        : { preco, data_preco: dataPreco, updated_at: updatedAt }
      let consulta = supabase.from('produtos').update(alteracoes).eq('mercado_livre_id', id)
      if (confirmar) consulta = consulta.eq('preco', preco)
      const { data, error } = await consulta.select('mercado_livre_id').maybeSingle()
      if (error) throw error
      return data !== null
    },
  }
}

export async function publicarProduto(produto: ProdutoPublicacao, gateway: ProdutosGateway): Promise<AcaoPublicacao> {
  const existente = await gateway.existe(produto.mercadoLivreId)
  await gateway.upsert({
    mercado_livre_id: produto.mercadoLivreId,
    titulo: produto.titulo,
    descricao: produto.descricao,
    preco: produto.preco,
    data_preco: produto.dataPreco,
    link_afiliado: produto.linkAfiliado,
    categoria: produto.categoria,
    rating: produto.rating,
    imagem: produto.imagem,
    ativo: true,
    updated_at: new Date().toISOString(),
  })
  return existente ? 'atualizado' : 'criado'
}
