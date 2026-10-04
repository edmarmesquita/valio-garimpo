import type { MercadoLivreConfig } from './mercadoLivreConfig.js'

const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const USER_URL = 'https://api.mercadolibre.com/users/me'
const ITEM_URL = 'https://api.mercadolibre.com/items/'

export class MercadoLivreApiError extends Error {
  constructor(
    public readonly kind: 'invalid_grant' | 'unauthorized' | 'unavailable' | 'not_found',
    public readonly itemFailure?: {
      providerStatus: number | null
      providerCode: string | null
      providerMessage: string | null
    },
  ) {
    super(`Mercado Livre OAuth: ${kind}`)
  }
}

export type MercadoLivreItem = {
  id: string
  titulo: string
  preco: number
  moeda: string | null
  imagemPrincipal: string | null
  permalink: string | null
  status: string | null
  quantidadeDisponivel: number | null
}

export async function getMercadoLivreItem(accessToken: string, itemId: string): Promise<MercadoLivreItem> {
  function itemError(kind: 'unauthorized' | 'unavailable' | 'not_found', providerStatus: number | null, body: unknown = null) {
    const details = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown> : null
    // Somente códigos conhecidos podem sair do processo; texto livre do provedor pode conter segredos.
    const safeCodes = ['not_found', 'forbidden', 'unauthorized', 'invalid_token', 'invalid_request', 'provider_unavailable']
    const providerCode = typeof details?.error === 'string' && safeCodes.includes(details.error)
      ? details.error : null
    const providerMessage = null
    console.error('Falha na consulta de item do Mercado Livre:', {
      stage: 'items', itemId, providerStatus, providerCode, providerMessage,
    })
    return new MercadoLivreApiError(kind, { providerStatus, providerCode, providerMessage })
  }

  let response: Response
  try {
    response = await fetch(`${ITEM_URL}${itemId}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw itemError('unavailable', null)
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const kind = response.status === 401 || response.status === 403 ? 'unauthorized'
      : response.status === 404 ? 'not_found' : 'unavailable'
    throw itemError(kind, response.status, body)
  }

  const value: unknown = await response.json().catch(() => null)
  if (typeof value !== 'object' || value === null) throw new MercadoLivreApiError('unavailable')
  const item = value as Record<string, unknown>
  if (item.id !== itemId || typeof item.title !== 'string' ||
      typeof item.price !== 'number' || !Number.isFinite(item.price)) {
    throw new MercadoLivreApiError('unavailable')
  }
  return {
    id: itemId,
    titulo: item.title,
    preco: item.price,
    moeda: typeof item.currency_id === 'string' ? item.currency_id : null,
    imagemPrincipal: typeof item.thumbnail === 'string' ? item.thumbnail : null,
    permalink: typeof item.permalink === 'string' ? item.permalink : null,
    status: typeof item.status === 'string' ? item.status : null,
    quantidadeDisponivel: typeof item.available_quantity === 'number' ? item.available_quantity : null,
  }
}

export type MercadoLivreTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string | null
  scope: string | null
}

function userId(value: unknown): string | null {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return null
}

async function requestTokens(params: URLSearchParams): Promise<MercadoLivreTokens> {
  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new MercadoLivreApiError('unavailable')
  }

  if (!response.ok) {
    // O provedor invalida o refresh token antigo depois de cada uso.
    if (response.status === 400 || response.status === 401) {
      const body: unknown = await response.json().catch(() => null)
      if (typeof body === 'object' && body !== null && 'error' in body && body.error === 'invalid_grant') {
        throw new MercadoLivreApiError('invalid_grant')
      }
    }
    throw new MercadoLivreApiError('unavailable')
  }

  const value: unknown = await response.json().catch(() => null)
  if (typeof value !== 'object' || value === null) throw new MercadoLivreApiError('unavailable')
  const token = value as Record<string, unknown>
  if (
    typeof token.access_token !== 'string' || !token.access_token ||
    typeof token.refresh_token !== 'string' || !token.refresh_token ||
    typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0
  ) throw new MercadoLivreApiError('unavailable')

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    userId: userId(token.user_id),
    scope: typeof token.scope === 'string' ? token.scope : null,
  }
}

export function exchangeAuthorizationCode(config: MercadoLivreConfig, code: string, verifier: string) {
  return requestTokens(new URLSearchParams({
    grant_type: 'authorization_code', client_id: config.clientId,
    client_secret: config.clientSecret, code, redirect_uri: config.redirectUri,
    code_verifier: verifier,
  }))
}

export function refreshTokens(config: MercadoLivreConfig, refreshToken: string) {
  return requestTokens(new URLSearchParams({
    grant_type: 'refresh_token', client_id: config.clientId,
    client_secret: config.clientSecret, refresh_token: refreshToken,
  }))
}

export async function getMercadoLivreIdentity(accessToken: string): Promise<{ userId: string; nickname: string | null }> {
  let response: Response
  try {
    response = await fetch(USER_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new MercadoLivreApiError('unavailable')
  }
  if (response.status === 401 || response.status === 403) throw new MercadoLivreApiError('unauthorized')
  if (!response.ok) throw new MercadoLivreApiError('unavailable')
  const value: unknown = await response.json().catch(() => null)
  if (typeof value !== 'object' || value === null) throw new MercadoLivreApiError('unavailable')
  const identity = value as Record<string, unknown>
  const id = userId(identity.id)
  if (!id) throw new MercadoLivreApiError('unavailable')
  return { userId: id, nickname: typeof identity.nickname === 'string' ? identity.nickname : null }
}
