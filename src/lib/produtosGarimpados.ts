import type { ProdutoAfiliado } from './extrairProdutosAfiliados'

export const CATEGORIAS_VALIO = [
  'Achados para Casa',
  'Achados para Maridos',
  'Achados para Elas',
  'Achados para Presentear',
] as const

export type CategoriaValio = typeof CATEGORIAS_VALIO[number]
export type Ordenacao = 'original' | 'comissao' | 'menor-preco' | 'maior-preco' | 'desconto' | 'avaliacao'
export type Filtros = {
  somenteComPreco: boolean
  somenteComissaoExtra: boolean
  comissaoMinima: number | null
  avaliacaoMinima: number | null
}
export type ProdutoValio = {
  id: string
  title: string
  description: string
  price: number
  priceReferenceDate: string
  link: string
  category: CategoriaValio
  rating?: number
  image: string
}

export function alternarSelecao(selecionados: ReadonlySet<number>, indice: number): Set<number> {
  const proxima = new Set(selecionados)
  if (proxima.has(indice)) proxima.delete(indice)
  else proxima.add(indice)
  return proxima
}

export function selecionarTodos(quantidade: number): Set<number> {
  return new Set(Array.from({ length: quantidade }, (_, indice) => indice))
}

function percentualDesconto(texto: string | null): number | null {
  const valor = texto?.match(/(\d+(?:[.,]\d+)?)\s*%/)
  return valor ? Number(valor[1].replace(',', '.')) : null
}

export function filtrarEOrdenarProdutos(produtos: ProdutoAfiliado[], filtros: Filtros, ordenacao: Ordenacao): number[] {
  const indices = produtos.map((_, indice) => indice).filter((indice) => {
    const produto = produtos[indice]
    return (!filtros.somenteComPreco || produto.precoAtual !== null)
      && (!filtros.somenteComissaoExtra || produto.extraCommission === true)
      && (filtros.comissaoMinima === null || (produto.comissaoPercentual ?? -Infinity) >= filtros.comissaoMinima)
      && (filtros.avaliacaoMinima === null || (produto.avaliacao ?? -Infinity) >= filtros.avaliacaoMinima)
  })
  const valor = (produto: ProdutoAfiliado): number | null => {
    switch (ordenacao) {
      case 'comissao': return produto.comissaoPercentual
      case 'menor-preco':
      case 'maior-preco': return produto.precoAtual
      case 'desconto': return percentualDesconto(produto.desconto)
      case 'avaliacao': return produto.avaliacao
      default: return null
    }
  }
  if (ordenacao !== 'original') indices.sort((a, b) => {
    const primeiro = valor(produtos[a])
    const segundo = valor(produtos[b])
    if (primeiro === null) return segundo === null ? a - b : 1
    if (segundo === null) return -1
    return (ordenacao === 'menor-preco' ? primeiro - segundo : segundo - primeiro) || a - b
  })
  return indices
}

export function problemasExportacao(produto: ProdutoAfiliado, categoria?: CategoriaValio): string[] {
  const problemas: string[] = []
  if (!categoria) problemas.push('categoria')
  if (!produto.itemId?.trim()) problemas.push('ITEM_ID')
  if (!produto.titulo?.trim()) problemas.push('título')
  if (produto.precoAtual === null || !Number.isFinite(produto.precoAtual)) problemas.push('preço')
  if (!produto.linkOriginal?.trim()) problemas.push('link original')
  return problemas
}

export function converterParaProdutoValio(produto: ProdutoAfiliado, categoria: CategoriaValio, data = new Date()): ProdutoValio {
  const problemas = problemasExportacao(produto, categoria)
  if (problemas.length) throw new Error(`Dados obrigatórios ausentes: ${problemas.join(', ')}`)
  return {
    id: produto.itemId!,
    title: produto.titulo!,
    description: '',
    price: produto.precoAtual!,
    priceReferenceDate: `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}/${String(data.getFullYear()).padStart(4, '0')}`,
    link: produto.linkOriginal!,
    category: categoria,
    ...(produto.avaliacao !== null && Number.isFinite(produto.avaliacao) ? { rating: produto.avaliacao } : {}),
    image: produto.imagemUrl ?? '',
  }
}

export function gerarProdutosValio(produtos: ProdutoAfiliado[], selecionados: ReadonlySet<number>, categorias: ReadonlyMap<number, CategoriaValio>, data = new Date()): ProdutoValio[] {
  if (!selecionados.size) throw new Error('Selecione ao menos um produto.')
  const invalidos = [...selecionados].flatMap((indice) => {
    const produto = produtos[indice]
    if (!produto) return [`Produto ${indice + 1}: não encontrado`]
    const problemas = problemasExportacao(produto, categorias.get(indice))
    return problemas.length ? [`${produto.titulo || produto.itemId || `Produto ${indice + 1}`}: ${problemas.join(', ')}`] : []
  })
  if (invalidos.length) throw new Error(`Revise os selecionados antes de gerar o JSON: ${invalidos.join('; ')}`)
  return [...selecionados].sort((a, b) => a - b)
    .map((indice) => converterParaProdutoValio(produtos[indice], categorias.get(indice)!, data))
}
