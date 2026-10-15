import { createClient } from '@supabase/supabase-js'
import { ehLinkMonetizado, ehLinkOficialParaAtualizacao } from '../../src/lib/linksAfiliados.js'
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
  obterLinkAfiliado: (mercadoLivreId: string) => Promise<string | null>
  upsert: (row: ProdutoRow) => Promise<void>
  inserir?: (row: ProdutoRow) => Promise<void>
}
export type LinhaLinkAfiliado = { mercado_livre_id: string; titulo: string; link_afiliado: string }
export type LinkAfiliadoGateway = {
  buscar: (mercadoLivreId: string) => Promise<LinhaLinkAfiliado[]>
  atualizar: (mercadoLivreId: string, linkAnterior: string, linkNovo: string) => Promise<Pick<LinhaLinkAfiliado, 'mercado_livre_id' | 'link_afiliado'>[]>
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

export function diagnosticarSupabaseEnv(env: NodeJS.ProcessEnv = process.env) {
  const url = env.SUPABASE_URL
  const chave = env.SUPABASE_SERVICE_ROLE_KEY
  let urlHttps = false
  try { urlHttps = Boolean(url?.trim() && new URL(url.trim()).protocol === 'https:') }
  catch { /* URL ausente ou inválida */ }
  return {
    SUPABASE_URL: { encontrada: url !== undefined, comprimentoMaiorQueZero: Boolean(url?.trim()) },
    SUPABASE_SERVICE_ROLE_KEY: { encontrada: chave !== undefined, comprimentoMaiorQueZero: Boolean(chave?.trim()) },
    urlHttps,
  }
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
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
    async obterLinkAfiliado(mercadoLivreId) {
      const { data, error } = await supabase.from('produtos')
        .select('link_afiliado').eq('mercado_livre_id', mercadoLivreId).maybeSingle()
      if (error) throw error
      return data?.link_afiliado ?? null
    },
    async upsert(row) {
      const { error } = await supabase.from('produtos')
        .upsert(row, { onConflict: 'mercado_livre_id' }).select('id').single()
      if (error) throw error
    },
    async inserir(row) {
      const { error } = await supabase.from('produtos').insert(row).select('id').single()
      if (error) throw error
    },
  }
}

export function criarLinkAfiliadoGateway(config: SupabaseConfig): LinkAfiliadoGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async buscar(mercadoLivreId) {
      const { data, error } = await supabase.from('produtos')
        .select('mercado_livre_id,titulo,link_afiliado').eq('mercado_livre_id', mercadoLivreId).limit(2)
      if (error) throw error
      return data ?? []
    },
    async atualizar(mercadoLivreId, linkAnterior, linkNovo) {
      const { data, error } = await supabase.from('produtos')
        .update({ link_afiliado: linkNovo })
        .eq('mercado_livre_id', mercadoLivreId).eq('link_afiliado', linkAnterior)
        .select('mercado_livre_id,link_afiliado')
      if (error) throw error
      return data ?? []
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

export async function publicarProduto(produto: ProdutoPublicacao, gateway: ProdutosGateway, somenteCriar = false): Promise<AcaoPublicacao> {
  if (somenteCriar) {
    if (!ehLinkOficialParaAtualizacao(produto.linkAfiliado)) throw new Error('Produto novo sem link afiliado oficial.')
    if (!gateway.inserir) throw new Error('Criação exclusiva indisponível.')
    await gateway.inserir({
      mercado_livre_id: produto.mercadoLivreId, titulo: produto.titulo, descricao: produto.descricao,
      preco: produto.preco, data_preco: produto.dataPreco, link_afiliado: produto.linkAfiliado,
      categoria: produto.categoria, rating: produto.rating, imagem: produto.imagem,
      ativo: true, updated_at: new Date().toISOString(),
    })
    return 'criado'
  }
  const linkExistente = await gateway.obterLinkAfiliado(produto.mercadoLivreId)
  const linkAfiliado = linkExistente && ehLinkMonetizado(linkExistente) && !ehLinkMonetizado(produto.linkAfiliado)
    ? linkExistente : produto.linkAfiliado
  await gateway.upsert({
    mercado_livre_id: produto.mercadoLivreId,
    titulo: produto.titulo,
    descricao: produto.descricao,
    preco: produto.preco,
    data_preco: produto.dataPreco,
    link_afiliado: linkAfiliado,
    categoria: produto.categoria,
    rating: produto.rating,
    imagem: produto.imagem,
    ativo: true,
    updated_at: new Date().toISOString(),
  })
  return linkExistente === null ? 'criado' : 'atualizado'
}
