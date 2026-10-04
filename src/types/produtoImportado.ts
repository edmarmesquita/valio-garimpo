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
  preco: number
  moeda: string | null
  imagemPrincipal: string | null
  permalink: string | null
  status: string | null
  quantidadeDisponivel: number | null
}
