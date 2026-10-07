export type DadosProduto = {
  titulo?: string
  descricao?: string
  preco?: number
  moeda?: string
  imagens?: string[]
  idMercadoLivre?: string
}

export type ProdutoImportado = {
  numero: number
  linkOriginal: string
  status: 'valido' | 'invalido'
  motivo?: string
  dados?: DadosProduto
}

export type ProdutoConsultado = {
  id: string
  titulo: string
  preco: number | null
  moeda: string | null
  imagemPrincipal: string | null
  permalink: string | null
  status: string | null
  quantidadeDisponivel: number | null
  originalUrl?: string
  catalogProductId?: string
  itemId?: string | null
  atributos?: { id: string; nome: string | null; valor: string | null }[]
}

export type OrigemProduto = 'api-item' | 'api-catalog'
