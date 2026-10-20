import { createClient } from '@supabase/supabase-js'
import { ehLinkMonetizado, ehLinkOficialParaAtualizacao } from '../../src/lib/linksAfiliados.js'
import type { ProdutoPublicacao } from '../valioProduto.js'
import type { OfertaGateway, OfertaRow } from '../ofertasRelampagoLote.js'

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
export function mapearProdutoParaRow(produto: ProdutoPublicacao, agora = new Date()): ProdutoRow {
  return {
    mercado_livre_id: produto.mercadoLivreId, titulo: produto.titulo, descricao: produto.descricao,
    preco: produto.preco, data_preco: produto.dataPreco, link_afiliado: produto.linkAfiliado,
    categoria: produto.categoria, rating: produto.rating, imagem: produto.imagem,
    ativo: true, updated_at: agora.toISOString(),
  }
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
export type ProdutoCatalogo = ProdutoExistente & { rating: number | null; updatedAt: string;
  ofertaRelampago?: boolean; ofertaInicio?: string | null; ofertaFim?: string | null }
export type CatalogoGateway = {
  listar: () => Promise<ProdutoCatalogo[]>
  alterarStatus: (id: string, ativo: boolean) => Promise<boolean>
  alterarCategoria: (id: string, categoria: string) => Promise<boolean>
  atualizarPreco: (id: string, preco: number, dataPreco: string, updatedAt: string, confirmar: boolean, precoEsperado?: number) => Promise<boolean>
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

const COLUNAS_OFERTA = 'mercado_livre_id,titulo,preco,categoria,imagem,link_afiliado,ativo,oferta_relampago,oferta_inicio,oferta_fim,preco_anterior,percentual_desconto,texto_oferta,prioridade_oferta'
const COLUNAS_OFERTA_HOME = `${COLUNAS_OFERTA},home_oferta_mode` as const

export function criarOfertasGateway(config: SupabaseConfig): OfertaGateway {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const produtos = criarProdutosGateway(config)
  let colunas: typeof COLUNAS_OFERTA | typeof COLUNAS_OFERTA_HOME = COLUNAS_OFERTA_HOME
  const semColunaHome = (erro: { code: string; message: string }) => ['42703', 'PGRST204'].includes(erro.code) && erro.message.includes('home_oferta_mode')
  async function listarOfertas(coluna: 'id' | 'created_at', ascending: boolean) {
    const ofertas: OfertaRow[] = []
    for (let inicio = 0; ; inicio += 500) {
      let { data, error } = await supabase.from('produtos').select(colunas)
        .eq('oferta_relampago', true).order(coluna, { ascending }).range(inicio, inicio + 499).overrideTypes<OfertaRow[], { merge: false }>()
      if (error && semColunaHome(error) && colunas !== COLUNAS_OFERTA) {
        colunas = COLUNAS_OFERTA
        ;({ data, error } = await supabase.from('produtos').select(colunas)
          .eq('oferta_relampago', true).order(coluna, { ascending }).range(inicio, inicio + 499).overrideTypes<OfertaRow[], { merge: false }>())
      }
      if (error) throw error
      ofertas.push(...(data ?? []) as OfertaRow[])
      if (!data || data.length < 500) return ofertas
    }
  }
  return {
    async buscar(id) {
      let { data, error } = await supabase.from('produtos').select(colunas)
        .eq('mercado_livre_id', id).limit(2).overrideTypes<OfertaRow[], { merge: false }>()
      if (error && semColunaHome(error) && colunas !== COLUNAS_OFERTA) {
        colunas = COLUNAS_OFERTA
        ;({ data, error } = await supabase.from('produtos').select(colunas).eq('mercado_livre_id', id).limit(2).overrideTypes<OfertaRow[], { merge: false }>())
      }
      if (error) throw error
      return (data ?? []) as OfertaRow[]
    },
    async listarAtivas() {
      return listarOfertas('id', true)
    },
    async listarGerenciamento() {
      return listarOfertas('created_at', false)
    },
    async atualizar(id, anterior, alteracao) {
      let consulta = supabase.from('produtos').update(alteracao).eq('mercado_livre_id', id)
      for (const [coluna, valor] of Object.entries(anterior)) {
        if (coluna === 'mercado_livre_id') continue
        consulta = valor === null ? consulta.is(coluna, null) : consulta.eq(coluna, valor)
      }
      const { data, error } = await consulta.select(colunas).overrideTypes<OfertaRow[], { merge: false }>()
      if (error) throw error
      return (data ?? []) as OfertaRow[]
    },
    async inserir(produto) {
      await produtos.inserir!(produto)
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
        const { data, error, status } = await supabase.from('produtos')
          .select('mercado_livre_id,titulo,preco,data_preco,categoria,link_afiliado,imagem,rating,ativo,updated_at,oferta_relampago,oferta_inicio,oferta_fim')
          .order('id', { ascending: true }).range(inicio, inicio + tamanho - 1)
        if (error) throw Object.assign(error, { status })
        produtos.push(...(data ?? []).map((row) => ({
          mercadoLivreId: row.mercado_livre_id, titulo: row.titulo, preco: row.preco,
          dataPreco: row.data_preco, categoria: row.categoria, linkAfiliado: row.link_afiliado,
          imagem: row.imagem, rating: row.rating, ativo: row.ativo, updatedAt: row.updated_at,
          ofertaRelampago: row.oferta_relampago, ofertaInicio: row.oferta_inicio, ofertaFim: row.oferta_fim,
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
    async atualizarPreco(id, preco, dataPreco, updatedAt, confirmar, precoEsperado) {
      const alteracoes = confirmar ? { data_preco: dataPreco, updated_at: updatedAt }
        : { preco, data_preco: dataPreco, updated_at: updatedAt }
      let consulta = supabase.from('produtos').update(alteracoes).eq('mercado_livre_id', id)
      if (confirmar || precoEsperado !== undefined) consulta = consulta.eq('preco', precoEsperado ?? preco)
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
    await gateway.inserir(mapearProdutoParaRow(produto))
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
