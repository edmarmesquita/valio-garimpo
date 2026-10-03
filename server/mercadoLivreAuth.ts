import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'

const AUTHORIZATION_URL = 'https://auth.mercadolivre.com.br/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const SESSION_COOKIE = 'meli_oauth_session'
const PENDING_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 6 * 60 * 60 * 1000

type PendingAuthorization = {
  sessionId: string
  codeVerifier: string
  expiresAt: number
}

type TokenRecord = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

// Prova inicial: cada instância da função mantém seus próprios dados em memória.
// Substituir por armazenamento persistente seguro antes de uso contínuo na Vercel.
const pendingAuthorizations = new Map<string, PendingAuthorization>()
const tokensBySession = new Map<string, TokenRecord>()

const router = Router()

function getConfiguration() {
  const clientId = process.env.MELI_CLIENT_ID?.trim()
  const clientSecret = process.env.MELI_CLIENT_SECRET?.trim()
  const redirectUri = process.env.MELI_REDIRECT_URI?.trim()

  if (!clientId || !clientSecret || !redirectUri) return null

  try {
    const url = new URL(redirectUri)
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)

    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.pathname !== '/api/mercadolivre/callback' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) return null

    return { clientId, clientSecret, redirectUri, secureCookie: url.protocol === 'https:' }
  } catch {
    return null
  }
}

function getSessionId(req: Request) {
  const cookie = req.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))

  const sessionId = cookie?.slice(SESSION_COOKIE.length + 1)
  return sessionId && /^[A-Za-z0-9_-]{43}$/.test(sessionId) ? sessionId : null
}

function removeExpiredEntries() {
  const now = Date.now()

  for (const [state, authorization] of pendingAuthorizations) {
    if (authorization.expiresAt <= now) pendingAuthorizations.delete(state)
  }

  for (const [sessionId, token] of tokensBySession) {
    if (token.expiresAt <= now) tokensBySession.delete(sessionId)
  }
}

function returnToGarimpo(res: Response, success: boolean) {
  res.set('Referrer-Policy', 'no-referrer')
  res.redirect(303, success ? '/?meli=conectado' : '/?meli=erro')
}

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

router.get('/auth/iniciar', (_req, res) => {
  const config = getConfiguration()

  if (!config) {
    res.status(503).json({ ok: false, error: 'Integração com Mercado Livre não configurada.' })
    return
  }

  removeExpiredEntries()

  const state = randomBytes(32).toString('base64url')
  const sessionId = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  pendingAuthorizations.set(state, {
    sessionId,
    codeVerifier,
    expiresAt: Date.now() + PENDING_TTL_MS,
  })

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  })

  const authorizationUrl = new URL(AUTHORIZATION_URL)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('client_id', config.clientId)
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri)
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')

  res.redirect(302, authorizationUrl.toString())
})

router.get('/callback', async (req, res) => {
  removeExpiredEntries()

  const state = typeof req.query.state === 'string' ? req.query.state : null
  const sessionId = getSessionId(req)
  const authorization = state ? pendingAuthorizations.get(state) : undefined

  if (!state || !sessionId || !authorization || authorization.sessionId !== sessionId) {
    returnToGarimpo(res, false)
    return
  }

  // O state é de uso único, inclusive quando o provedor retorna erro.
  pendingAuthorizations.delete(state)

  const code = typeof req.query.code === 'string' ? req.query.code : null
  const config = getConfiguration()

  if (req.query.error || !code || !config) {
    returnToGarimpo(res, false)
    return
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: authorization.codeVerifier,
  })

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      returnToGarimpo(res, false)
      return
    }

    const token: unknown = await response.json()

    if (
      typeof token !== 'object' || token === null ||
      !('access_token' in token) || typeof token.access_token !== 'string' || !token.access_token ||
      !('refresh_token' in token) || typeof token.refresh_token !== 'string' || !token.refresh_token ||
      !('expires_in' in token) || typeof token.expires_in !== 'number' ||
      !Number.isFinite(token.expires_in) || token.expires_in <= 0
    ) {
      returnToGarimpo(res, false)
      return
    }

    tokensBySession.set(sessionId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    })

    returnToGarimpo(res, true)
  } catch {
    returnToGarimpo(res, false)
  }
})

router.get('/status', (req, res) => {
  removeExpiredEntries()

  const sessionId = getSessionId(req)
  const token = sessionId ? tokensBySession.get(sessionId) : undefined

  res.json({
    connected: Boolean(token?.accessToken && token.refreshToken && token.expiresAt > Date.now()),
  })
})

export default router
