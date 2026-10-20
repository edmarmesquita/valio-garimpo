import type { ProdutoCatalogo } from './manutencaoVitrine'

export type ConsultaPreco = { itemId: string; situacao: 'OK' | 'NÃO ENCONTRADO' | 'REVISAR' | 'ERRO TEMPORÁRIO';
  preco: number | null; motivo: string | null }
export type ResultadoAutomatico = ConsultaPreco & { status: 'PREÇO IGUAL' | 'PREÇO ALTERADO' | 'NÃO ENCONTRADO' | 'REVISAR' | 'ERRO TEMPORÁRIO';
  coletadoEm: string; possivelOfertaExpirada: boolean }
export type RevisaoSalva = { versao: 1; ids: string[]; resultados: Record<string, ResultadoAutomatico>; pilotoAprovado?: boolean }
export const CHAVE_REVISAO_AUTOMATICA = 'valio-garimpa:revisao-precos-auto:v1'
export class SessaoMercadoLivreExpirada extends Error {}

export function ofertaAindaAtiva(produto: ProdutoCatalogo, agora = Date.now()): boolean {
  if (!produto.ofertaRelampago) return false
  const fim = produto.ofertaFim ? Date.parse(produto.ofertaFim) : null
  // Uma oferta agendada ou sem fim conhecido também exige revisão manual.
  return fim === null || !Number.isFinite(fim) || fim > agora
}

export function classificarConsulta(produto: ProdutoCatalogo, consulta: ConsultaPreco, agora = Date.now()): ResultadoAutomatico {
  const precoConfiavel = consulta.situacao === 'OK' && typeof consulta.preco === 'number'
    && Number.isFinite(consulta.preco) && consulta.preco > 0
  const ativa = ofertaAindaAtiva(produto, agora)
  const status = consulta.situacao === 'NÃO ENCONTRADO' ? 'NÃO ENCONTRADO'
    : consulta.situacao === 'ERRO TEMPORÁRIO' ? 'ERRO TEMPORÁRIO'
      : !precoConfiavel || ativa ? 'REVISAR'
        : Math.round(consulta.preco! * 100) === Math.round(produto.preco * 100) ? 'PREÇO IGUAL' : 'PREÇO ALTERADO'
  const fim = produto.ofertaFim ? Date.parse(produto.ofertaFim) : NaN
  return { ...consulta, status, motivo: ativa ? 'Oferta Relâmpago ainda válida: revisão manual necessária.' : consulta.motivo,
    coletadoEm: new Date(agora).toISOString(),
    possivelOfertaExpirada: Boolean(produto.ofertaRelampago && Number.isFinite(fim) && fim <= agora
      && precoConfiavel && consulta.preco! > produto.preco) }
}

export function restaurarRevisao(storage: Pick<Storage, 'getItem'>): RevisaoSalva | null {
  try {
    const valor = storage.getItem(CHAVE_REVISAO_AUTOMATICA)
    if (!valor) return null
    const salvo: unknown = JSON.parse(valor)
    if (!salvo || typeof salvo !== 'object' || Array.isArray(salvo)) return null
    const registro = salvo as Record<string, unknown>
    if (registro.versao !== 1 || !Array.isArray(registro.ids) || registro.ids.some((id) => typeof id !== 'string' || !/^MLB\d+$/.test(id))
      || (registro.pilotoAprovado !== undefined && typeof registro.pilotoAprovado !== 'boolean')
      || !registro.resultados || typeof registro.resultados !== 'object' || Array.isArray(registro.resultados)) return null
    const resultados = registro.resultados as Record<string, unknown>
    const ids = registro.ids as string[]
    if (Object.entries(resultados).some(([id, resultado]) => !ids.includes(id) || !resultado
      || typeof resultado !== 'object' || !['PREÇO IGUAL', 'PREÇO ALTERADO', 'NÃO ENCONTRADO', 'REVISAR', 'ERRO TEMPORÁRIO']
        .includes((resultado as ResultadoAutomatico).status))) return null
    return registro as RevisaoSalva
  } catch { return null }
}

export async function consultarPrecosOficiais(ids: string[], sinal?: AbortSignal, enviar: typeof fetch = fetch): Promise<ConsultaPreco[]> {
  if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some((id) => !/^MLB\d+$/.test(id)))
    throw new Error('Consulte de 1 a 5 ITEM_IDs únicos por grupo.')
  const resposta = await enviar('/api/mercadolivre/precos/consultar', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: ids }), signal: sinal, cache: 'no-store' })
  const dado: unknown = await resposta.json().catch(() => null)
  if (resposta.status === 401) throw new SessaoMercadoLivreExpirada('Conecte sua conta do Mercado Livre e repita o piloto.')
  if (!resposta.ok || !dado || typeof dado !== 'object' || !Array.isArray((dado as { resultados?: unknown }).resultados))
    throw new Error(`Consulta oficial indisponível (HTTP ${resposta.status}).`)
  const resultados = (dado as { resultados: ConsultaPreco[] }).resultados
  if (resultados.length !== ids.length || resultados.some((item, i) => item?.itemId !== ids[i]
    || !['OK', 'NÃO ENCONTRADO', 'REVISAR', 'ERRO TEMPORÁRIO'].includes(item.situacao)))
    throw new Error('Resposta oficial inconsistente por ITEM_ID.')
  return resultados
}
