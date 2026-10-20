export type PrecoConsultado = {
  itemId: string
  situacao: 'OK' | 'NÃO ENCONTRADO' | 'REVISAR' | 'ERRO TEMPORÁRIO'
  preco: number | null
  motivo: string | null
  autenticacaoExpirada?: true
}

const aguardar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Preço de venda do canal marketplace; nunca usa price/base_price de /items.
export async function consultarPrecoAtual(itemId: string, accessToken: string,
  enviar: typeof fetch = fetch, espera: (ms: number) => Promise<unknown> = aguardar): Promise<PrecoConsultado> {
  if (!/^MLB\d+$/.test(itemId)) return { itemId, situacao: 'REVISAR', preco: null, motivo: 'ITEM_ID inválido.' }
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let resposta: Response
    try {
      resposta = await enviar(`https://api.mercadolibre.com/items/${itemId}/sale_price?context=channel_marketplace`, {
        headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000), cache: 'no-store',
      })
    } catch {
      if (tentativa < 2) { await espera(300 * (tentativa + 1)); continue }
      return { itemId, situacao: 'ERRO TEMPORÁRIO', preco: null, motivo: 'Rede ou timeout na consulta ao Mercado Livre.' }
    }
    if (resposta.status === 404) return { itemId, situacao: 'NÃO ENCONTRADO', preco: null, motivo: 'ITEM_ID não encontrado na fonte oficial.' }
    if (resposta.status === 429 || resposta.status >= 500) {
      if (tentativa < 2) { await espera(500 * (tentativa + 1)); continue }
      return { itemId, situacao: 'ERRO TEMPORÁRIO', preco: null, motivo: `Mercado Livre respondeu HTTP ${resposta.status}.` }
    }
    if (resposta.status === 401) return { itemId, situacao: 'REVISAR', preco: null,
      motivo: 'Access token rejeitado pelo Mercado Livre.', autenticacaoExpirada: true }
    if (!resposta.ok) return { itemId, situacao: 'REVISAR', preco: null,
      motivo: resposta.status === 401 || resposta.status === 403 ? 'A conexão OAuth não tem acesso ao preço deste ITEM_ID.' : `Consulta oficial respondeu HTTP ${resposta.status}.` }
    const json: unknown = await resposta.json().catch(() => null)
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return { itemId, situacao: 'REVISAR', preco: null, motivo: 'Resposta oficial inválida.' }
    const dado = json as Record<string, unknown>
    if (typeof dado.amount !== 'number' || !Number.isFinite(dado.amount) || dado.amount <= 0 || dado.currency_id !== 'BRL')
      return { itemId, situacao: 'REVISAR', preco: null, motivo: 'Preço de venda BRL ausente ou ambíguo.' }
    return { itemId, situacao: 'OK', preco: dado.amount, motivo: null }
  }
  return { itemId, situacao: 'ERRO TEMPORÁRIO', preco: null, motivo: 'Consulta interrompida.' }
}
