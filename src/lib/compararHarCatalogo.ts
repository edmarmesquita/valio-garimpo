import type { ProdutoCatalogo } from './manutencaoVitrine'
import type { ProdutoUnicoHar, ResultadoParsingHar } from './harAfiliadosParser'
import { instanteOferta } from '../features/ofertas-relampago/gerenciarOfertas'

export type StatusComparacaoHar = 'IGUAL' | 'ALTERADO' | 'PIX_REVISAR' | 'CUPOM_REVISAR' | 'OUTRO_REVISAR'
  | 'CONFLITO_HAR' | 'PRECO_INVALIDO' | 'MOEDA_INVALIDA' | 'OFERTA_PROTEGIDA' | 'CATALOGO_REVISAR'
export type ComparacaoHar = {
  produto: ProdutoCatalogo; har: ProdutoUnicoHar; status: StatusComparacaoHar
  diferenca: number | null; diferencaPercentual: number | null
  oferta: 'DESATIVADA' | 'ATIVA' | 'AGENDADA' | 'EXPIRADA' | 'REVISAR'; ofertaProtegida: boolean
}
export function compararHarCatalogo(parsing: ResultadoParsingHar, catalogo: ProdutoCatalogo[], agora = Date.now()) {
  const ativos = catalogo.filter((p) => p.ativo)
  const contagens = new Map<string, number>()
  for (const p of ativos) contagens.set(p.mercadoLivreId, (contagens.get(p.mercadoLivreId) ?? 0) + 1)
  const porId = new Map(parsing.produtos.map((p) => [p.itemId, p]))
  const encontrados: ComparacaoHar[] = []
  const naoEncontrados: ProdutoCatalogo[] = []
  for (const produto of ativos) {
    const har = porId.get(produto.mercadoLivreId)
    if (!har) { naoEncontrados.push(produto); continue }
    const inicio = instanteOferta(produto.ofertaInicio ?? null)
    const fim = instanteOferta(produto.ofertaFim ?? null, true)
    const dataInvalida = Boolean((produto.ofertaInicio && inicio === null) || (produto.ofertaFim && fim === null)
      || (inicio !== null && fim !== null && inicio >= fim))
    const oferta = !produto.ofertaRelampago ? 'DESATIVADA' : dataInvalida ? 'REVISAR'
      : fim !== null && fim <= agora ? 'EXPIRADA' : inicio !== null && inicio > agora ? 'AGENDADA' : 'ATIVA'
    const ofertaProtegida = oferta === 'ATIVA' || oferta === 'AGENDADA' || oferta === 'REVISAR'
    const validoSalvo = typeof produto.preco === 'number' && Number.isFinite(produto.preco) && produto.preco > 0
      && Number.isSafeInteger(Math.round(produto.preco * 100))
    const ambiguo = contagens.get(produto.mercadoLivreId) !== 1
    const comparavel = validoSalvo && har.valido && !ambiguo
    const diferenca = comparavel ? (Math.round(har.precoAtual! * 100) - Math.round(produto.preco * 100)) / 100 : null
    const diferencaPercentual = diferenca === null ? null : diferenca / produto.preco * 100
    const status: StatusComparacaoHar = har.conflito ? 'CONFLITO_HAR'
      : har.capturas.some((p) => p.precoAtual === null) || !validoSalvo ? 'PRECO_INVALIDO'
        : har.capturas.some((p) => p.moeda !== 'BRL') ? 'MOEDA_INVALIDA'
          : ambiguo ? 'CATALOGO_REVISAR' : ofertaProtegida ? 'OFERTA_PROTEGIDA'
            : har.classificacao === 'PIX' ? 'PIX_REVISAR' : har.classificacao === 'CUPOM' ? 'CUPOM_REVISAR'
              : har.classificacao === 'OUTRO_REVISAR' ? 'OUTRO_REVISAR' : diferenca === 0 ? 'IGUAL' : 'ALTERADO'
    encontrados.push({ produto, har, status, diferenca, diferencaPercentual, oferta, ofertaProtegida })
  }
  return { encontrados, naoEncontrados, totalAtivos: ativos.length,
    iguais: encontrados.filter((p) => p.diferenca === 0).length,
    diferentes: encontrados.filter((p) => p.diferenca !== null && p.diferenca !== 0).length }
}
export const filtrosHar = ['Todos', 'Alterados', 'Iguais', 'Normal', 'Desconto', 'Pix', 'Cupom', 'Revisar', 'Conflitos', 'Oferta protegida'] as const
export type FiltroHar = typeof filtrosHar[number]
export function filtrarComparacaoHar(itens: ComparacaoHar[], filtro: FiltroHar): ComparacaoHar[] {
  return itens.filter((p) => {
    switch (filtro) {
      case 'Alterados': return p.diferenca !== null && p.diferenca !== 0
      case 'Iguais': return p.diferenca === 0
      case 'Normal': return p.har.classificacao === 'NORMAL'
      case 'Desconto': return p.har.classificacao === 'DESCONTO'
      case 'Pix': return p.har.classificacao === 'PIX'
      case 'Cupom': return p.har.classificacao === 'CUPOM'
      case 'Revisar': return p.status !== 'IGUAL' && p.status !== 'ALTERADO'
      case 'Conflitos': return p.har.conflito !== null
      case 'Oferta protegida': return p.ofertaProtegida
      default: return true
    }
  })
}
