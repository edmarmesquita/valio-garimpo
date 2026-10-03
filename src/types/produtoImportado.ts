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
