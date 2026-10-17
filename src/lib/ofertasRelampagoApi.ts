import type { OfertaPublicada } from '../features/ofertas-relampago/gerenciarOfertas'
export type ModoOferta = 'AGENDAR' | 'ATIVAR_AGORA' | 'ATIVAR' | 'DESATIVAR' | 'PRIORIDADE' | 'ENVIAR' | 'SUBSTITUIR' | 'REATIVAR' | 'HOME' | 'LIMPAR_EXPIRADAS'
export type ItemOferta = { tipo: 'ATUALIZAR_OFERTA' | 'NOVO_PRODUTO'; dados: Record<string, unknown> }
export type LinhaPreviaOferta = { itemId: string; produto: string; situacaoAtual: string; acao: string
  prioridade: number; precoAnterior: number | null; precoAtual: number; percentualDesconto: number | null
  ofertaFim: string | null; resultadoEsperado: string; homeOfertaMode?: 'auto' | 'fixada' | 'fila' }
export type PreviaRemotaOfertas = { modo: ModoOferta; emitidaEm: number; operacoes: LinhaPreviaOferta[]
  desativarAtuais: number; ativarSelecionadas: number; ativasNaPrevia: string[]; avisos?: string[] }
export type PreviaAssinadaOfertas = { previa: PreviaRemotaOfertas; assinatura: string }
export type ResultadoConfirmacaoOfertas = { criadas: number; ativadas: number; atualizadas: number; desativadas: number
  semAlteracao: number; conflitos: number; erros: number; itens: { itemId: string; resultado: string; motivo?: string }[] }

async function requisitar(caminho: string, corpo: object, token: string, enviar: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!token.trim()) throw new Error('Informe o token de publicação.')
  let resposta: Response
  try { resposta = await enviar(`/api/valio/ofertas-relampago/${caminho}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
    body: JSON.stringify(corpo), cache: 'no-store',
  }) } catch { throw new Error('Não foi possível conectar à API de ofertas.') }
  let dados: unknown
  try { dados = await resposta.json() } catch { throw new Error('A API de ofertas não retornou JSON válido.') }
  const resultado = dados && typeof dados === 'object' ? dados as Record<string, unknown> : {}
  if (!resposta.ok || resultado.ok !== true) throw new Error(typeof resultado.erro === 'string' ? resultado.erro : 'Falha na API de ofertas.')
  return resultado
}

export async function preverOfertas(modo: ModoOferta, itens: ItemOferta[], token: string,
  enviar: typeof fetch = fetch): Promise<PreviaAssinadaOfertas> {
  const resposta = await requisitar('prever', { modo, itens }, token, enviar)
  const previa = resposta.previa as PreviaRemotaOfertas | undefined
  if (!previa || !Array.isArray(previa.operacoes) || typeof resposta.assinatura !== 'string') throw new Error('Prévia de ofertas inválida.')
  return { previa, assinatura: resposta.assinatura }
}

export async function listarOfertasPublicadas(token: string, itemId?: string): Promise<OfertaPublicada[]> {
  const resposta = await requisitar('listar', itemId ? { itemId } : {}, token)
  if (!Array.isArray(resposta.produtos)) throw new Error('Listagem de ofertas inválida.')
  return resposta.produtos as OfertaPublicada[]
}

export async function preverLotePreparado(itens: ItemOferta[], token: string): Promise<PreviaAssinadaOfertas> {
  const resposta = await requisitar('prever', { modo: 'ENVIAR', itens, exigirPrazoValido: true }, token)
  const previa = resposta.previa as PreviaRemotaOfertas | undefined
  if (!previa || !Array.isArray(previa.operacoes) || typeof resposta.assinatura !== 'string') throw new Error('Prévia do lote preparado inválida.')
  return { previa, assinatura: resposta.assinatura }
}

export async function preverLimpezaExpiradas(token: string): Promise<PreviaAssinadaOfertas> {
  const resposta = await requisitar('expiradas/prever', {}, token)
  const previa = resposta.previa as PreviaRemotaOfertas | undefined
  if (!previa || !Array.isArray(previa.operacoes) || typeof resposta.assinatura !== 'string') throw new Error('Prévia de limpeza inválida.')
  return { previa, assinatura: resposta.assinatura }
}

export async function confirmarOfertas(preview: PreviaAssinadaOfertas, token: string,
  enviar: typeof fetch = fetch): Promise<ResultadoConfirmacaoOfertas> {
  const resposta = await requisitar('confirmar', preview, token, enviar)
  if (!Array.isArray(resposta.itens) || typeof resposta.criadas !== 'number' || typeof resposta.conflitos !== 'number') {
    throw new Error('Resultado da confirmação inválido.')
  }
  return resposta as ResultadoConfirmacaoOfertas
}
