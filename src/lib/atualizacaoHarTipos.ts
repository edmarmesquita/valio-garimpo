export type PedidoPrecoHar = {
  itemId: string; precoBase: number; novoPreco: number; classificacao: string
  evidencia: { moeda: string; labels: string[]; precoAnterior: number | null; conflito: boolean }
}
export type StatusPrecoHar = 'PRONTO' | 'ATUALIZADO' | 'BLOQUEADO_PRECO_ALTERADO' | 'BLOQUEADO_VARIACAO_EXTREMA'
  | 'BLOQUEADO_OFERTA' | 'BLOQUEADO_CLASSIFICACAO' | 'BLOQUEADO_INATIVO' | 'BLOQUEADO_NAO_ENCONTRADO' | 'ERRO'
export type ResultadoPrecoHar = { itemId: string; titulo: string; precoBase: number; novoPreco: number; status: StatusPrecoHar; motivo: string }
export type SelecaoConfirmacaoHar = { versao: string; itens: { itemId: string; precoBase: number; novoPreco: number; classificacao: string }[] }
export type RevalidacaoHar = { finalidade: 'precos-har-v1'; versao: string; fonte: 'api'; emitidaEm: number; itens: PedidoPrecoHar[]; resultados: ResultadoPrecoHar[] }
export type RevalidacaoAssinadaHar = { previa: RevalidacaoHar; assinatura: string }
