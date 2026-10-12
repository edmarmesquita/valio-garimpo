export type PeriodoCliques = 'hoje' | '7dias' | '30dias' | 'todos'
export type MetricasCliques = {
  periodo: PeriodoCliques
  totalCliques: number
  totalProdutosComClique: number
  produtosSemClique: number
  rankingProdutos: { mercadoLivreId: string; titulo: string; categoria: string; cliques: number }[]
  rankingCategorias: { categoria: string; cliques: number }[]
  cliquesPorDia: { data: string; cliques: number }[]
}

export async function carregarMetricasCliques(periodo: PeriodoCliques, token: string, enviar: typeof fetch = fetch): Promise<MetricasCliques> {
  if (!token.trim()) throw new Error('Informe o token de publicação para consultar as métricas.')
  let resposta: Response
  try { resposta = await enviar(`/api/valio/metricas/cliques?periodo=${periodo}`, {
    headers: { Authorization: `Bearer ${token.trim()}` }, cache: 'no-store',
  }) } catch { throw new Error('Não foi possível conectar à API de métricas.') }
  let dados: unknown
  try { dados = await resposta.json() }
  catch { throw new Error(`A API respondeu HTTP ${resposta.status} sem JSON válido.`) }
  const resultado = dados && typeof dados === 'object' ? dados as Record<string, unknown> : {}
  if (!resposta.ok || resultado.ok !== true) throw new Error(typeof resultado.erro === 'string' ? resultado.erro : `A API respondeu HTTP ${resposta.status}.`)
  if (!Array.isArray(resultado.rankingProdutos) || !Array.isArray(resultado.rankingCategorias) || !Array.isArray(resultado.cliquesPorDia))
    throw new Error('Resposta inválida das métricas.')
  return resultado as MetricasCliques
}
