import type { ComparacaoHar } from './compararHarCatalogo'
import { candidatoSeguroHar } from './previaHar'
import type { PreviaFinalHar } from './previaHar'
import type { PedidoPrecoHar, RevalidacaoAssinadaHar, ResultadoPrecoHar } from './atualizacaoHarTipos'

export function pedidoRevalidacaoHar(previa: PreviaFinalHar, linhas: ComparacaoHar[]): { fonte: 'api'; itens: PedidoPrecoHar[] } {
  if (previa.fonte !== 'api') throw new Error('Atualização indisponível com catálogo CSV. Carregue o catálogo pela API para revalidar e gravar.')
  return { fonte: 'api', itens: previa.itens.map((i) => {
    const encontrados = linhas.filter((l) => l.har.itemId === i.itemId)
    const l = encontrados[0]
    if (encontrados.length !== 1 || !candidatoSeguroHar(l) || l.produto.preco !== i.precoBase || l.har.precoAtual !== i.novoPreco
      || l.har.classificacao !== i.classificacao) throw new Error('Prévia desatualizada. Gere uma nova prévia.')
    return { itemId: i.itemId, precoBase: i.precoBase, novoPreco: i.novoPreco, classificacao: i.classificacao,
      evidencia: { moeda: 'BRL', labels: [...new Set(l.har.capturas.map((p) => p.discountLabel ?? ''))],
        precoAnterior: l.har.capturas[0].precoAnterior, conflito: Boolean(l.har.conflito) } }
  }) }
}
async function requisitar(acao: 'revalidar' | 'confirmar', body: unknown, token: string, enviar: typeof fetch) {
  if (!token.trim()) throw new Error('Informe o token operacional para revalidar pelo backend.')
  let resposta: Response
  try { resposta = await enviar(`/api/valio/produtos/precos-har/${acao}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }) }
  catch { throw new Error(acao === 'confirmar' ? 'Resultado da gravação desconhecido. Recarregue o catálogo antes de tentar novamente.' : 'Não foi possível conectar à API para revalidar.') }
  let dados
  try { dados = await resposta.json() } catch { throw new Error('Resposta inválida da API. Recarregue o catálogo antes de continuar.') }
  if (!resposta.ok || dados?.ok !== true) throw new Error('A API recusou a operação. Recarregue o catálogo e revalide a prévia.')
  return dados
}
export async function revalidarPrecosHar(previa: PreviaFinalHar, linhas: ComparacaoHar[], token: string, enviar: typeof fetch = fetch): Promise<RevalidacaoAssinadaHar> {
  const dados = await requisitar('revalidar', pedidoRevalidacaoHar(previa, linhas), token, enviar)
  if (!dados.previa || !Array.isArray(dados.previa.resultados) || typeof dados.assinatura !== 'string') throw new Error('Revalidação inválida retornada pela API.')
  return { previa: dados.previa, assinatura: dados.assinatura }
}
export async function confirmarPrecosHar(revalidacao: RevalidacaoAssinadaHar, token: string, enviar: typeof fetch = fetch): Promise<ResultadoPrecoHar[]> {
  const dados = await requisitar('confirmar', revalidacao, token, enviar)
  if (!Array.isArray(dados.resultados)) throw new Error('Resultado inválido. Recarregue o catálogo antes de continuar.')
  return dados.resultados
}
