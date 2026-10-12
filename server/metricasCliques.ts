import type { CliqueEntrada, LinhaCliquesDia } from './services/cliques.js'
import type { ProdutoCatalogo } from './services/supabase.js'

export const ORIGENS_CLIQUE = ['vitrine', 'busca', 'colecao'] as const
export type PeriodoCliques = 'hoje' | '7dias' | '30dias' | 'todos'
export const PERIODOS_CLIQUES: PeriodoCliques[] = ['hoje', '7dias', '30dias', 'todos']
const CATEGORIAS = ['Achados para Casa', 'Achados para Maridos', 'Achados para Elas', 'Achados para Presentear']

export function validarClique(corpo: unknown): CliqueEntrada {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Payload inválido.')
  const entrada = corpo as Record<string, unknown>
  if (Object.keys(entrada).some((chave) => !['mercadoLivreId', 'categoria', 'origem'].includes(chave))) throw new Error('Campos não permitidos no clique.')
  if (typeof entrada.mercadoLivreId !== 'string' || !/^MLB\d+$/.test(entrada.mercadoLivreId)) throw new Error('ITEM_ID inválido.')
  if (entrada.categoria !== undefined && (typeof entrada.categoria !== 'string' || !CATEGORIAS.includes(entrada.categoria))) throw new Error('Categoria inválida.')
  if (entrada.origem !== undefined && (typeof entrada.origem !== 'string' || !ORIGENS_CLIQUE.includes(entrada.origem as typeof ORIGENS_CLIQUE[number]))) throw new Error('Origem inválida.')
  return { mercadoLivreId: entrada.mercadoLivreId, categoria: entrada.categoria as string ?? null, origem: entrada.origem as string ?? null }
}

function hojeLocal(agora: Date) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora)
  const obter = (tipo: string) => partes.find((parte) => parte.type === tipo)!.value
  return `${obter('year')}-${obter('month')}-${obter('day')}`
}

export function inicioPeriodo(periodo: PeriodoCliques, agora = new Date()): string | undefined {
  if (periodo === 'todos') return undefined
  const hoje = hojeLocal(agora)
  const inicio = new Date(`${hoje}T00:00:00Z`)
  inicio.setUTCDate(inicio.getUTCDate() - (periodo === 'hoje' ? 0 : periodo === '7dias' ? 6 : 29))
  return inicio.toISOString().slice(0, 10)
}

export function agregarCliques(linhas: LinhaCliquesDia[], catalogo: ProdutoCatalogo[], periodo: PeriodoCliques, agora = new Date()) {
  const inicio = inicioPeriodo(periodo, agora)
  const hoje = hojeLocal(agora)
  const produtos = new Map(catalogo.map((item) => [item.mercadoLivreId, item]))
  const porProduto = new Map<string, { mercadoLivreId: string; titulo: string; categoria: string; cliques: number }>()
  const porCategoria = new Map<string, number>()
  const porDia = new Map<string, number>()
  let totalCliques = 0
  for (const linha of linhas) {
    if (inicio && linha.dia < inicio || linha.dia > hoje || !Number.isSafeInteger(linha.cliques) || linha.cliques < 0) continue
    totalCliques += linha.cliques
    const produto = produtos.get(linha.mercadoLivreId)
    const categoria = linha.categoria ?? produto?.categoria ?? 'Sem categoria'
    const anterior = porProduto.get(linha.mercadoLivreId)
    porProduto.set(linha.mercadoLivreId, { mercadoLivreId: linha.mercadoLivreId,
      titulo: produto?.titulo ?? linha.mercadoLivreId, categoria: produto?.categoria ?? categoria,
      cliques: (anterior?.cliques ?? 0) + linha.cliques })
    porCategoria.set(categoria, (porCategoria.get(categoria) ?? 0) + linha.cliques)
    porDia.set(linha.dia, (porDia.get(linha.dia) ?? 0) + linha.cliques)
  }
  const rankingProdutos = [...porProduto.values()].sort((a, b) => b.cliques - a.cliques || a.mercadoLivreId.localeCompare(b.mercadoLivreId)).slice(0, 10)
  const rankingCategorias = [...porCategoria].map(([categoria, cliques]) => ({ categoria, cliques }))
    .sort((a, b) => b.cliques - a.cliques || a.categoria.localeCompare(b.categoria, 'pt-BR'))
  const cliquesPorDia = [...porDia].sort(([a], [b]) => a.localeCompare(b))
    .map(([data, cliques]) => ({ data: `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`, cliques }))
  const produtosSemClique = catalogo.filter((produto) => produto.ativo && !porProduto.has(produto.mercadoLivreId)).length
  return { periodo, totalCliques, totalProdutosComClique: porProduto.size, produtosSemClique,
    rankingProdutos, rankingCategorias, cliquesPorDia }
}
