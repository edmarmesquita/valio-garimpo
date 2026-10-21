import type { ComparacaoHar } from './compararHarCatalogo'

export function motivosBloqueioHar(linha: ComparacaoHar): string[] {
  const motivos: string[] = []
  if (!linha.produto.ativo || linha.produto.mercadoLivreId !== linha.har.itemId || !/^MLB\d+$/.test(linha.har.itemId)) motivos.push('CATÁLOGO/ITEM_ID INVÁLIDO')
  if (linha.har.conflito) motivos.push('CONFLITO HAR')
  if (linha.ofertaProtegida) motivos.push('OFERTA PROTEGIDA')
  if (!Number.isFinite(linha.produto.preco) || linha.produto.preco <= 0 || linha.har.precoAtual === null
    || !Number.isFinite(linha.har.precoAtual) || linha.har.precoAtual <= 0 || linha.har.capturas.some((p) => p.precoAtual === null)) motivos.push('PREÇO INVÁLIDO')
  if (linha.har.capturas.some((p) => p.moeda !== 'BRL')) motivos.push('MOEDA INVÁLIDA')
  if (linha.har.classificacao === 'PIX') motivos.push('PIX')
  if (linha.har.classificacao === 'CUPOM') motivos.push('CUPOM')
  if (linha.har.classificacao === 'OUTRO_REVISAR') {
    const combinada = linha.har.capturas.some((p) => /pix/i.test([p.discountLabel, ...p.evidenciasCondicao].join(' '))
      && /cupom/i.test([p.discountLabel, ...p.evidenciasCondicao].join(' ')))
    motivos.push(combinada ? 'CONDIÇÃO COMBINADA (PIX + CUPOM)' : 'OUTRO/REVISAR')
  }
  if (linha.diferenca === 0) motivos.push('PREÇO IGUAL')
  if (linha.status === 'CATALOGO_REVISAR') motivos.push('CATÁLOGO AMBÍGUO')
  if (!motivos.length && (linha.status !== 'ALTERADO' || !linha.har.valido || linha.diferenca === null
    || !Number.isFinite(linha.diferencaPercentual))) motivos.push('REVISAR COMPARAÇÃO')
  return motivos
}
export function candidatoSeguroHar(linha: ComparacaoHar): boolean {
  return motivosBloqueioHar(linha).length === 0 && ['NORMAL', 'DESCONTO'].includes(linha.har.classificacao)
}
export function selecionarCandidatosHar(linhas: ComparacaoHar[]): string[] {
  return [...new Set(linhas.filter(candidatoSeguroHar).map((p) => p.har.itemId))]
}
export type ItemPreviaHar = Readonly<{
  itemId: string; titulo: string; precoBase: number; novoPreco: number; diferenca: number; diferencaPercentual: number
  classificacao: 'NORMAL' | 'DESCONTO'; discountLabels: readonly string[]; arquivosOrigem: readonly string[]
}>
export type PreviaFinalHar = Readonly<{
  versao: string
  fonte: 'api' | 'csv'; itens: readonly ItemPreviaHar[]
  resumo: Readonly<{ selecionados: number; aumentos: number; reducoes: number; mediaPercentual: number
    maiorAumentoPercentual: number | null; maiorReducaoPercentual: number | null }>
}>
// Snapshot local: não contém gateway, token, request ou operação de escrita.
export function gerarPreviaHar(linhas: ComparacaoHar[], selecionados: readonly string[], fonte: 'api' | 'csv'): PreviaFinalHar {
  if (!selecionados.length || new Set(selecionados).size !== selecionados.length) throw new Error('Selecione candidatos seguros para gerar a prévia.')
  const itens = selecionados.map((id): ItemPreviaHar => {
    const matches = linhas.filter((p) => p.har.itemId === id)
    if (matches.length !== 1 || !candidatoSeguroHar(matches[0])) throw new Error('Seleção inválida ou desatualizada. Revise os candidatos novamente.')
    const p = matches[0]
    return Object.freeze({ itemId: id, titulo: p.produto.titulo, precoBase: p.produto.preco, novoPreco: p.har.precoAtual!,
      diferenca: p.diferenca!, diferencaPercentual: p.diferencaPercentual!, classificacao: p.har.classificacao as 'NORMAL' | 'DESCONTO',
      discountLabels: Object.freeze([...new Set(p.har.capturas.map((c) => c.discountLabel ?? '—'))]),
      arquivosOrigem: Object.freeze([...new Set(p.har.capturas.map((c) => c.listaId
        ? `${c.arquivoOrigem} · ${c.listaNome} (${c.listaId})` : c.arquivoOrigem))]) })
  })
  const aumentos = itens.filter((p) => p.diferenca > 0)
  const reducoes = itens.filter((p) => p.diferenca < 0)
  return Object.freeze({ versao: crypto.randomUUID(), fonte, itens: Object.freeze(itens), resumo: Object.freeze({ selecionados: itens.length,
    aumentos: aumentos.length, reducoes: reducoes.length, mediaPercentual: itens.reduce((s, p) => s + p.diferencaPercentual, 0) / itens.length,
    maiorAumentoPercentual: aumentos.length ? Math.max(...aumentos.map((p) => p.diferencaPercentual)) : null,
    maiorReducaoPercentual: reducoes.length ? Math.min(...reducoes.map((p) => p.diferencaPercentual)) : null }) })
}
