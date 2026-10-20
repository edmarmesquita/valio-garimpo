export type PrecoConsultado = {
  itemId: string
  situacao: 'OK' | 'NÃO ENCONTRADO' | 'REVISAR' | 'ERRO TEMPORÁRIO'
  preco: number | null
  motivo: string | null
  autenticacaoExpirada?: true
  diagnostico?: {
    itemId: string
    statusHttp: number
    error?: string
    mensagemSanitizada?: string
    contentType: string | null
    jsonValido: boolean
    tokenEnviado: boolean
    refreshExecutado: boolean
    refreshBemSucedido: boolean | null
  }
}

const diagnosticoHabilitado = () => process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'

function erroSeguro(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined
  const conhecidos = ['forbidden', 'FORBIDDEN', 'unauthorized', 'access_denied', 'not_found', 'not.found', 'insufficient_scope', 'PA_BLOCKED']
  return conhecidos.includes(valor) ? valor : 'Erro do Mercado Livre omitido por segurança.'
}

function mensagemSegura(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined
  const conhecidas = ['Caller ID must match item owner', 'Caller ID does not have rights to access this endpoint',
    'Forbidden', 'Access denied', 'Unauthorized', 'Item not found']
  return conhecidas.includes(valor) ? valor : 'Mensagem do Mercado Livre omitida por segurança.'
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
    if (!resposta.ok) {
      let diagnostico: PrecoConsultado['diagnostico']
      if (resposta.status === 403 && diagnosticoHabilitado()) {
        const tipo = resposta.headers?.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        const contentType = tipo && ['application/json', 'application/problem+json', 'text/html', 'text/plain'].includes(tipo)
          ? tipo : null
        let corpo: unknown
        let jsonValido = false
        try { corpo = await resposta.json(); jsonValido = true }
        catch { /* o corpo não é JSON válido */ }
        const campos = corpo && typeof corpo === 'object' && !Array.isArray(corpo)
          ? corpo as Record<string, unknown> : {}
        const mensagem = [campos.message, campos.error_description].map(mensagemSegura)
          .find((valor) => valor && valor !== 'Mensagem do Mercado Livre omitida por segurança.')
          ?? mensagemSegura(campos.message ?? campos.error_description)
        diagnostico = {
          itemId, statusHttp: resposta.status,
          ...(erroSeguro(campos.error) ? { error: erroSeguro(campos.error) } : {}),
          ...(mensagem ? { mensagemSanitizada: mensagem } : {}),
          contentType, jsonValido, tokenEnviado: Boolean(accessToken),
          refreshExecutado: false, refreshBemSucedido: null,
        }
      }
      return { itemId, situacao: 'REVISAR', preco: null,
        motivo: resposta.status === 403 ? 'A conexão OAuth não tem acesso ao preço deste ITEM_ID.' : `Consulta oficial respondeu HTTP ${resposta.status}.`,
        ...(diagnostico ? { diagnostico } : {}) }
    }
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
