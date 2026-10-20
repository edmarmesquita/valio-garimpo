import type { MercadoLivreConfig } from './mercadoLivreConfig.js'

const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const USER_URL = 'https://api.mercadolibre.com/users/me'
const ITEM_URL = 'https://api.mercadolibre.com/items/'
const PRODUCT_URL = 'https://api.mercadolibre.com/products/'
const GRANTS_URL = 'https://api.mercadolibre.com/applications/6332151948097527/grants'
const GRANTS_APP_ID = '6332151948097527'

type TokenFailureDiagnostic = {
  statusHttpExterno: number | null
  codigoErroMercadoLivre: string | null
  mensagemMercadoLivre: string | null
  campoMensagemMercadoLivre: 'message' | 'error_description' | null
  contentTypeResposta: string | null
  respostaJsonValida: boolean | null
  clientIdPresente: boolean
  clientSecretPresente: boolean
  redirectUriIgual: boolean
  codeVerifierPresente: boolean
  grantTypeAuthorizationCode: boolean
}

export class MercadoLivreApiError extends Error {
  constructor(
    public readonly kind: 'invalid_grant' | 'unauthorized' | 'unavailable' | 'not_found',
    public readonly itemFailure?: {
      providerStatus: number | null
      providerCode: string | null
      providerMessage: string | null
    },
    public readonly tokenFailure?: TokenFailureDiagnostic,
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

export type MercadoLivreCatalogProduct = {
  id: string
  titulo: string
  preco: null
  moeda: null
  imagemPrincipal: string | null
  permalink: string
  status: string | null
  quantidadeDisponivel: null
  catalogProductId: string
  itemId: string | null
  originalUrl: string
  atributos: { id: string; nome: string | null; valor: string | null }[]
}

export async function getMercadoLivreCatalogProduct(accessToken: string, catalogProductId: string, itemId: string | null, originalUrl: string): Promise<MercadoLivreCatalogProduct> {
  let response: Response
  try {
    response = await fetch(`${PRODUCT_URL}${catalogProductId}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new MercadoLivreApiError('unavailable')
  }
  if (!response.ok) throw new MercadoLivreApiError(response.status === 404 ? 'not_found' : 'unavailable')
  const value: unknown = await response.json().catch(() => null)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MercadoLivreApiError('unavailable')
  const product = value as Record<string, unknown>
  const title = typeof product.name === 'string' && product.name.trim() ? product.name.trim()
    : typeof product.title === 'string' && product.title.trim() ? product.title.trim() : null
  if (product.id !== catalogProductId || !title) throw new MercadoLivreApiError('unavailable')
  const pictures = Array.isArray(product.pictures) ? product.pictures : []
  const image = pictures.find((picture: unknown) => {
    if (typeof picture !== 'object' || picture === null) return false
    const row = picture as Record<string, unknown>
    return typeof row.secure_url === 'string' && row.secure_url.startsWith('https://')
      || typeof row.url === 'string' && row.url.startsWith('https://')
  }) as Record<string, unknown> | undefined
  const attributes = Array.isArray(product.attributes) ? product.attributes : []
  return {
    id: catalogProductId, titulo: title, preco: null, moeda: null,
    imagemPrincipal: typeof image?.secure_url === 'string' && image.secure_url.startsWith('https://')
      ? image.secure_url : typeof image?.url === 'string' && image.url.startsWith('https://') ? image.url : null,
    permalink: originalUrl, status: typeof product.status === 'string' ? product.status : null,
    quantidadeDisponivel: null, catalogProductId, itemId, originalUrl,
    atributos: attributes.flatMap((attribute: unknown) => {
      if (typeof attribute !== 'object' || attribute === null) return []
      const row = attribute as Record<string, unknown>
      if (typeof row.id !== 'string') return []
      return [{ id: row.id, nome: typeof row.name === 'string' ? row.name : null,
        valor: typeof row.value_name === 'string' ? row.value_name : null }]
    }),
  }
}

export type MercadoLivreGrant = {
  user_id: string
  app_id: string
  date_created: string
  scopes: string[]
}

export async function getMercadoLivreGrant(accessToken: string, connectedUserId: string): Promise<MercadoLivreGrant | null> {
  let response: Response
  try {
    response = await fetch(GRANTS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new MercadoLivreApiError('unavailable')
  }
  if (response.status === 401 || response.status === 403) throw new MercadoLivreApiError('unauthorized')
  if (!response.ok) throw new MercadoLivreApiError('unavailable')

  const value: unknown = await response.json().catch(() => null)
  if (typeof value !== 'object' || value === null || !('grants' in value) || !Array.isArray(value.grants)) {
    throw new MercadoLivreApiError('unavailable')
  }
  const grant = value.grants.find((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const row = entry as Record<string, unknown>
    return userId(row.user_id) === connectedUserId && userId(row.app_id) === GRANTS_APP_ID
  }) as Record<string, unknown> | undefined
  if (!grant) return null
  if (typeof grant.date_created !== 'string' ||
      !Array.isArray(grant.scopes) || !grant.scopes.every((scope: unknown) => typeof scope === 'string')) {
    throw new MercadoLivreApiError('unavailable')
  }
  return {
    user_id: connectedUserId,
    app_id: GRANTS_APP_ID,
    date_created: grant.date_created,
    scopes: grant.scopes,
  }
}

export async function getMercadoLivreItem(accessToken: string, itemId: string): Promise<MercadoLivreItem> {
  function itemError(kind: 'unauthorized' | 'unavailable' | 'not_found', providerStatus: number | null, body: unknown = null, contentType: string | null = null, bodyLength = 0) {
    const details = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown> : null
    // Apenas valores conhecidos podem entrar em logs; texto livre do provedor pode conter segredos.
    const safeCodes = ['not_found', 'forbidden', 'unauthorized', 'invalid_token', 'invalid_request', 'provider_unavailable']
    const safeValue = (value: unknown) => typeof value === 'string' && safeCodes.includes(value) ? value : null
    const providerError = safeValue(details?.error)
    const providerBodyCode = details?.code === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES'
      ? details.code : safeValue(details?.code)
    const providerCode = providerError
    const providerMessage = null
    const safeContentType = contentType?.split(';', 1)[0].trim().toLowerCase()
    const providerContentType = ['application/json', 'application/problem+json', 'text/html', 'text/plain'].includes(safeContentType ?? '')
      ? safeContentType : null
    if (details) {
      console.error('Falha na consulta de item do Mercado Livre:', {
        stage: 'items', itemId, providerStatus, providerContentType, bodyLength,
        providerError, providerBodyCode,
        providerMessage: typeof details.message === 'string' && ['Forbidden', 'Access denied', 'Not found'].includes(details.message)
          ? details.message : null,
        providerBlockedBy: typeof details.blocked_by === 'string' && ['policy_agent', 'waf', 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES'].includes(details.blocked_by)
          ? details.blocked_by : null,
        providerBodyStatus: typeof details.status === 'number' && Number.isInteger(details.status) && details.status >= 100 && details.status <= 599
          ? details.status : null,
      })
    } else {
      console.error('Falha na consulta de item do Mercado Livre:', { providerStatus, providerContentType, bodyLength })
    }
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
    const contentType = response.headers.get('content-type')
    const bodyText = await response.text().catch(() => '')
    let body: unknown = null
    try { body = JSON.parse(bodyText) } catch { /* resposta não JSON */ }
    const kind = response.status === 401 || response.status === 403 ? 'unauthorized'
      : response.status === 404 ? 'not_found' : 'unavailable'
    throw itemError(kind, response.status, body, contentType, bodyText.length)
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

function mensagemTokenSanitizada(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const mensagem = value.toLowerCase().slice(0, 1000)
  if (/redirect[_ -]?uri|callback/.test(mensagem)) return 'Redirect URI recusada ou divergente.'
  if (/code[_ -]?verifier|pkce|code[_ -]?challenge/.test(mensagem)) return 'Verificador PKCE recusado.'
  if (/client[_ -]?secret|client[_ -]?id|invalid[_ -]?client/.test(mensagem)) return 'Credenciais da aplicação recusadas.'
  if (/authorization[_ -]?code|invalid[_ -]?grant|expir|expired|reutiliz|already used/.test(mensagem)) {
    return 'Código de autorização inválido, expirado ou já utilizado.'
  }
  if (/scope|permission/.test(mensagem)) return 'Permissão OAuth recusada.'
  if (/rate[_ -]?limit|too many/.test(mensagem)) return 'Limite de requisições do provedor.'
  return 'Mensagem do provedor recebida; conteúdo omitido.'
}

function diagnosticoToken(params: URLSearchParams, response?: Response, json?: { valido: boolean; valor: unknown }): TokenFailureDiagnostic | undefined {
  const ambiente = process.env.VERCEL_ENV
  if (ambiente !== 'preview' && ambiente !== 'development' && !(ambiente === undefined && process.env.NODE_ENV === 'development')) return undefined
  const body = json?.valor && typeof json.valor === 'object' && !Array.isArray(json.valor)
    ? json.valor as Record<string, unknown> : null
  const codigos = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_request',
    'unsupported_grant_type', 'access_denied', 'server_error', 'temporarily_unavailable']
  const codigoErroMercadoLivre = typeof body?.error === 'string'
    ? codigos.includes(body.error) ? body.error : 'outro_codigo' : null
  const campoMensagemMercadoLivre = typeof body?.error_description === 'string' ? 'error_description'
    : typeof body?.message === 'string' ? 'message' : null
  const mensagemMercadoLivre = mensagemTokenSanitizada(campoMensagemMercadoLivre ? body?.[campoMensagemMercadoLivre] : null)
  const tipoOriginal = response?.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const tipos = ['application/json', 'application/problem+json', 'text/html', 'text/plain', 'application/octet-stream']
  return {
    statusHttpExterno: response?.status ?? null,
    codigoErroMercadoLivre,
    mensagemMercadoLivre,
    campoMensagemMercadoLivre,
    contentTypeResposta: tipoOriginal ? tipos.includes(tipoOriginal) ? tipoOriginal : 'outro' : null,
    respostaJsonValida: json?.valido ?? null,
    clientIdPresente: Boolean(params.get('client_id')),
    clientSecretPresente: Boolean(params.get('client_secret')),
    redirectUriIgual: params.get('redirect_uri') === process.env.MELI_REDIRECT_URI,
    codeVerifierPresente: Boolean(params.get('code_verifier')),
    grantTypeAuthorizationCode: params.get('grant_type') === 'authorization_code',
  }
}

async function lerJson(response: Response): Promise<{ valido: boolean; valor: unknown }> {
  try { return { valido: true, valor: await response.json() } }
  catch { return { valido: false, valor: null } }
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
    throw new MercadoLivreApiError('unavailable', undefined, diagnosticoToken(params))
  }

  if (!response.ok) {
    // O provedor invalida o refresh token antigo depois de cada uso.
    if (response.status === 400 || response.status === 401) {
      const json = await lerJson(response)
      if (typeof json.valor === 'object' && json.valor !== null && 'error' in json.valor && json.valor.error === 'invalid_grant') {
        throw new MercadoLivreApiError('invalid_grant', undefined, diagnosticoToken(params, response, json))
      }
      throw new MercadoLivreApiError('unavailable', undefined, diagnosticoToken(params, response, json))
    }
    const json = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'
      || (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'development') ? await lerJson(response) : undefined
    throw new MercadoLivreApiError('unavailable', undefined, diagnosticoToken(params, response, json))
  }

  const json = await lerJson(response)
  const value = json.valor
  if (typeof value !== 'object' || value === null) throw new MercadoLivreApiError('unavailable', undefined, diagnosticoToken(params, response, json))
  const token = value as Record<string, unknown>
  if (
    typeof token.access_token !== 'string' || !token.access_token ||
    typeof token.refresh_token !== 'string' || !token.refresh_token ||
    typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0
  ) throw new MercadoLivreApiError('unavailable', undefined, diagnosticoToken(params, response, json))

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
