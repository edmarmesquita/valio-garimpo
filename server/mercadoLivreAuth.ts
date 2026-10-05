import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getMercadoLivreConfig } from './mercadoLivreConfig.js'
import { assertEncryptionConfigured, decryptSecret, encryptSecret, hashOpaque } from './mercadoLivreCrypto.js'
import { createAuthorizationAttempt, consumeAuthorizationAttempt, getConnectionSummary, saveConnection, withLockedConnection } from './mercadoLivreRepository.js'
import { exchangeAuthorizationCode, getMercadoLivreGrant, getMercadoLivreIdentity, MercadoLivreApiError } from './mercadoLivreApi.js'
import { connectionStatus, getBackendAccessToken } from './mercadoLivreTokenService.js'

const AUTHORIZATION_URL = 'https://auth.mercadolivre.com.br/authorization'
const SESSION_COOKIE = 'meli_oauth_session'
const PENDING_TTL_MS = 10 * 60 * 1000
// Até existir login próprio, o cookie opaco vincula o navegador à conexão.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const router = Router()

function getSessionId(req: Request) {
  const cookie = req.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  const sessionId = cookie?.slice(SESSION_COOKIE.length + 1)
  return sessionId && /^[A-Za-z0-9_-]{43}$/.test(sessionId) ? sessionId : null
}

function returnToGarimpo(res: Response, success: boolean) {
  res.set('Referrer-Policy', 'no-referrer')
  res.redirect(303, success ? '/?meli=conectado' : '/?meli=erro')
}

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

router.get('/auth/iniciar', async (_req, res) => {
  const config = getMercadoLivreConfig()
  if (!config) {
    res.status(503).json({ ok: false, error: 'Integração com Mercado Livre não configurada.' })
    return
  }

  try {
    assertEncryptionConfigured()
    const state = randomBytes(32).toString('base64url')
    const sessionId = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const stateHash = hashOpaque(state)
    await createAuthorizationAttempt(
      hashOpaque(sessionId), stateHash,
      encryptSecret(codeVerifier, `verifier:${stateHash}`),
      new Date(Date.now() + SESSION_TTL_MS),
      new Date(Date.now() + PENDING_TTL_MS),
    )

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true, secure: config.secureCookie, sameSite: 'lax',
      path: '/', maxAge: SESSION_TTL_MS,
    })
    const authorizationUrl = new URL(AUTHORIZATION_URL)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', config.clientId)
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri)
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', codeChallenge)
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
    res.redirect(302, authorizationUrl.toString())
  } catch {
    res.status(503).json({ ok: false, error: 'Armazenamento OAuth indisponível.' })
  }
})

router.get('/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.query.state)
    ? req.query.state : null
  const sessionId = getSessionId(req)
  if (!state || !sessionId) {
    returnToGarimpo(res, false)
    return
  }

  try {
    const stateHash = hashOpaque(state)
    const verifierCiphertext = await consumeAuthorizationAttempt(stateHash, hashOpaque(sessionId))
    if (!verifierCiphertext) {
      returnToGarimpo(res, false)
      return
    }
    // O state é consumido mesmo quando o provedor retorna erro ou não envia code.
    const code = typeof req.query.code === 'string' ? req.query.code : null
    const config = getMercadoLivreConfig()
    if (req.query.error || !code || !config) {
      returnToGarimpo(res, false)
      return
    }

    const verifier = decryptSecret(verifierCiphertext, `verifier:${stateHash}`)
    const tokens = await exchangeAuthorizationCode(config, code, verifier)
    const identity = await getMercadoLivreIdentity(tokens.accessToken)
    if (tokens.userId && tokens.userId !== identity.userId) throw new Error('Identidade Mercado Livre divergente')

    await saveConnection({
      sessionHash: hashOpaque(sessionId), userId: identity.userId,
      nickname: identity.nickname, scope: tokens.scope,
      accessTokenCiphertext: encryptSecret(tokens.accessToken, `access:${identity.userId}`),
      refreshTokenCiphertext: encryptSecret(tokens.refreshToken, `refresh:${identity.userId}`),
      accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    })
    returnToGarimpo(res, true)
  } catch {
    // Não registrar code, verifier, tokens ou resposta do provedor em logs.
    returnToGarimpo(res, false)
  }
})

router.get('/status', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.json({ connected: false })
    return
  }

  try {
    const config = getMercadoLivreConfig()
    if (!config) throw new Error('Configuração OAuth ausente')
    assertEncryptionConfigured()
    res.json(await connectionStatus(hashOpaque(sessionId), config))
  } catch {
    res.status(503).json({ ok: false, error: 'Não foi possível verificar a conexão com o Mercado Livre.' })
  }
})

router.get('/diagnostico', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.json({ connected: false })
    return
  }

  try {
    const config = getMercadoLivreConfig()
    if (!config) throw new Error('Configuração OAuth ausente')
    assertEncryptionConfigured()
    const sessionHash = hashOpaque(sessionId)
    let accessToken = await getBackendAccessToken(sessionHash, config)
    if (!accessToken) {
      res.json({ connected: false })
      return
    }

    let identity
    try {
      identity = await getMercadoLivreIdentity(accessToken)
    } catch (error) {
      if (!(error instanceof MercadoLivreApiError) || error.kind !== 'unauthorized') throw error
      accessToken = await getBackendAccessToken(sessionHash, config, accessToken)
      if (!accessToken) {
        res.json({ connected: false, requiresReconnect: true })
        return
      }
      identity = await getMercadoLivreIdentity(accessToken)
    }

    res.json({ connected: true, id: identity.userId, nickname: identity.nickname })
  } catch (error) {
    if (error instanceof MercadoLivreApiError) {
      res.status(502).json({ ok: false, error: 'Não foi possível consultar o Mercado Livre.' })
      return
    }
    res.status(503).json({ ok: false, error: 'Não foi possível verificar a conexão com o Mercado Livre.' })
  }
})

// Diagnóstico temporário: expõe exclusivamente os campos do grant da conta vinculada à sessão.
router.get('/diagnostico/grants', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
    return
  }

  try {
    const config = getMercadoLivreConfig()
    if (!config || config.clientId !== '6332151948097527') throw new Error('Aplicação OAuth divergente')
    assertEncryptionConfigured()
    const sessionHash = hashOpaque(sessionId)
    const connection = await getConnectionSummary(sessionHash)
    if (!connection || connection.status !== 'connected') {
      res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
      return
    }
    let accessToken = await getBackendAccessToken(sessionHash, config)
    if (!accessToken) {
      res.status(401).json({ error: 'Conexão com o Mercado Livre expirada.' })
      return
    }

    let grant
    try {
      grant = await getMercadoLivreGrant(accessToken, connection.meli_user_id)
    } catch (error) {
      if (!(error instanceof MercadoLivreApiError) || error.kind !== 'unauthorized') throw error
      accessToken = await getBackendAccessToken(sessionHash, config, accessToken)
      if (!accessToken) {
        res.status(401).json({ error: 'Conexão com o Mercado Livre expirada.' })
        return
      }
      grant = await getMercadoLivreGrant(accessToken, connection.meli_user_id)
    }

    if (!grant) {
      res.status(404).json({ error: 'Grant da conta conectada não encontrado.' })
      return
    }
    res.json(grant)
  } catch (error) {
    res.status(error instanceof MercadoLivreApiError ? 502 : 503)
      .json({ error: 'Não foi possível consultar os grants do Mercado Livre.' })
  }
})

// Diagnóstico temporário do mesmo GET /items usado na consulta de produto.
router.get('/diagnostico/item', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
    return
  }

  try {
    assertEncryptionConfigured()
    const credentials = await withLockedConnection(hashOpaque(sessionId), async (_client, connection) => {
      if (connection.status !== 'connected') return null
      return {
        accessToken: decryptSecret(connection.access_token_ciphertext, `access:${connection.meli_user_id}`),
        refreshToken: decryptSecret(connection.refresh_token_ciphertext, `refresh:${connection.meli_user_id}`),
      }
    })
    if (!credentials) {
      res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
      return
    }

    const response = await fetch('https://api.mercadolibre.com/items/MLB4045941169', {
      headers: { accept: 'application/json', authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type')
    let databasePassword: string | undefined
    try { databasePassword = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : undefined }
    catch { /* URL indisponível para extração de senha */ }
    const secrets = [credentials.accessToken, credentials.refreshToken, sessionId,
      process.env.MELI_CLIENT_SECRET, process.env.MELI_TOKEN_ENCRYPTION_KEY,
      process.env.DATABASE_URL, databasePassword, req.get('cookie')]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.length - a.length)
    const safeText = (value: string) => secrets.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value)
      .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    const result: {
      providerStatus: number
      contentType: string | null
      bodySize: number
      body?: Record<string, string | number | boolean | null>
    } = { providerStatus: response.status, contentType: contentType ? safeText(contentType) : null, bodySize: bytes.length }

    if (contentType && /(?:^|\/)\S*(?:json|\+json)(?:\s*;|\s*$)/i.test(contentType)) {
      let parsed: unknown
      try { parsed = JSON.parse(bytes.toString('utf8')) } catch { parsed = null }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const source = parsed as Record<string, unknown>
        const body: Record<string, string | number | boolean | null> = {}
        for (const field of ['error', 'code', 'message', 'status', 'blocked_by']) {
          const value = source[field]
          if (typeof value === 'string') {
            body[field] = safeText(value)
          } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
            body[field] = value
          }
        }
        result.body = body
      }
    }
    res.json(result)
  } catch {
    res.status(503).json({ error: 'Não foi possível consultar o Mercado Livre.' })
  }
})

// Diagnóstico temporário do endpoint bulk com o token armazenado, sem renovação.
router.get('/diagnostico/item-bulk', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
    return
  }

  try {
    assertEncryptionConfigured()
    const credentials = await withLockedConnection(hashOpaque(sessionId), async (_client, connection) => {
      if (connection.status !== 'connected') return null
      return {
        accessToken: decryptSecret(connection.access_token_ciphertext, `access:${connection.meli_user_id}`),
        refreshToken: decryptSecret(connection.refresh_token_ciphertext, `refresh:${connection.meli_user_id}`),
      }
    })
    if (!credentials) {
      res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
      return
    }

    const response = await fetch('https://api.mercadolibre.com/items/bulk?ids=MLB4045941169', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    let databasePassword: string | undefined
    try { databasePassword = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : undefined }
    catch { /* URL indisponível para extração de senha */ }
    const secrets = [credentials.accessToken, credentials.refreshToken, sessionId,
      process.env.MELI_CLIENT_SECRET, process.env.MELI_TOKEN_ENCRYPTION_KEY,
      process.env.DATABASE_URL, databasePassword, req.get('cookie')]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.length - a.length)
    const safeText = (value: string) => secrets.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value)
      .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    const safeKeys = (source: Record<string, unknown>) => Object.keys(source)
      .filter((key) => key.length <= 80 && /^[a-z_][a-z0-9_]*$/i.test(key)
        && !/(?:authorization|cookie|token|secret|password|credential|database_url|api_key|private_key)/i.test(key))
      .slice(0, 100)
    const safeScalar = (value: unknown): string | number | boolean | null | undefined => {
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
      if (typeof value !== 'string') return undefined
      const sanitized = safeText(value)
      if (sanitized.length > 160 || /\[REDACTED\]|(?:authorization|cookie|token|secret|password|credential|database_url|api_key|private_key)|https?:\/\/|@|[a-z0-9+/_=-]{40,}/i.test(sanitized)) return undefined
      return sanitized
    }
    const valueType = (value: unknown) => Array.isArray(value) ? 'array'
      : value === null ? 'null' : typeof value
    const contentType = response.headers.get('content-type')
    const result: Record<string, unknown> = {
      providerStatus: response.status,
      contentType: contentType ? safeText(contentType) : null,
      bodySize: bytes.length,
      parsedType: 'other',
      isArray: false,
    }
    const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase()
    if (mediaType === 'application/json' || mediaType?.endsWith('+json')) {
      let parsed: unknown
      try { parsed = JSON.parse(bytes.toString('utf8')) } catch { parsed = null }
      if (Array.isArray(parsed)) {
        result.parsedType = 'array'
        result.isArray = true
        result.arrayLength = parsed.length
        const first = parsed[0]
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          const item = first as Record<string, unknown>
          result.firstElementKeys = safeKeys(item)
          for (const [sourceKey, resultKey] of [
            ['code', 'firstElementCode'], ['status_code', 'firstElementStatusCode'],
            ['status', 'firstElementStatus'],
          ]) {
            const value = safeScalar(item[sourceKey])
            if (value !== undefined) result[resultKey] = value
          }
          if (Object.hasOwn(item, 'body')) {
            result.firstElementBodyType = valueType(item.body)
            if (item.body && typeof item.body === 'object' && !Array.isArray(item.body)) {
              const body = item.body as Record<string, unknown>
              result.firstElementBodyKeys = safeKeys(body)
              for (const [sourceKey, resultKey] of [
                ['error', 'firstElementBodyError'], ['code', 'firstElementBodyCode'],
                ['status', 'firstElementBodyStatus'], ['message', 'firstElementBodyMessage'],
              ]) {
                const value = safeScalar(body[sourceKey])
                if (value !== undefined) result[resultKey] = value
              }
            }
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        result.parsedType = 'object'
        result.topLevelKeys = safeKeys(parsed as Record<string, unknown>)
      }
    }
    res.json(result)
  } catch {
    res.status(503).json({ error: 'Não foi possível consultar o Mercado Livre.' })
  }
})

// Diagnóstico temporário da busca pública, usando somente o access token armazenado.
router.get('/diagnostico/search', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
    return
  }

  try {
    assertEncryptionConfigured()
    const credentials = await withLockedConnection(hashOpaque(sessionId), async (_client, connection) => {
      if (connection.status !== 'connected') return null
      return {
        accessToken: decryptSecret(connection.access_token_ciphertext, `access:${connection.meli_user_id}`),
        refreshToken: decryptSecret(connection.refresh_token_ciphertext, `refresh:${connection.meli_user_id}`),
      }
    })
    if (!credentials) {
      res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
      return
    }

    const response = await fetch('https://api.mercadolibre.com/sites/MLB/search?q=tenis%20carina%20street%20puma', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    let databasePassword: string | undefined
    try { databasePassword = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : undefined }
    catch { /* URL indisponível para extração de senha */ }
    const secrets = [credentials.accessToken, credentials.refreshToken, sessionId,
      process.env.MELI_CLIENT_SECRET, process.env.MELI_TOKEN_ENCRYPTION_KEY,
      process.env.DATABASE_URL, databasePassword, req.get('cookie')]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.length - a.length)
    const safeText = (value: string) => secrets.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value)
      .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
      .replace(/(?:access_token|refresh_token|authorization|cookie|client_secret|database_url)/gi, '[REDACTED]')
    const scalar = (value: unknown): string | number | null | undefined => {
      if (typeof value === 'string') return safeText(value)
      if (value === null || (typeof value === 'number' && Number.isFinite(value))) return value
      return undefined
    }
    const fields = (source: Record<string, unknown>, names: string[]) => {
      const result: Record<string, string | number | null> = {}
      for (const name of names) {
        const value = scalar(source[name])
        if (value !== undefined) result[name] = value
      }
      return result
    }
    const contentType = response.headers.get('content-type')
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch { parsed = null }
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null
    if (!response.ok || !source || !Array.isArray(source.results)) {
      res.status(response.ok ? 502 : response.status).json({
        error: 'Não foi possível consultar a busca do Mercado Livre.',
        ...((source && !response.ok) ? fields(source, ['error', 'code', 'message', 'status', 'blocked_by']) : {}),
      })
      return
    }

    const results = source.results.slice(0, 5).map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {}
      const item = entry as Record<string, unknown>
      const result: Record<string, unknown> = fields(item, [
        'id', 'title', 'price', 'currency_id', 'permalink', 'available_quantity', 'thumbnail',
      ])
      if (item.seller && typeof item.seller === 'object' && !Array.isArray(item.seller)) {
        const seller = fields(item.seller as Record<string, unknown>, ['id'])
        if (Object.hasOwn(seller, 'id')) result.seller = seller
      }
      return result
    })
    const paging = source.paging && typeof source.paging === 'object' && !Array.isArray(source.paging)
      ? source.paging as Record<string, unknown> : {}
    res.json({
      providerStatus: response.status,
      contentType: contentType && /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*charset=[\w-]+)?$/i.test(contentType)
        ? contentType : null,
      bodySize: bytes.length,
      paging: fields(paging, ['total']),
      resultsCount: results.length,
      results,
    })
  } catch {
    res.status(503).json({ error: 'Não foi possível consultar a busca do Mercado Livre.' })
  }
})

// Diagnóstico temporário do estado da aplicação e do usuário, sem renovar o token.
router.get('/diagnostico/status', async (req, res) => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
    return
  }

  try {
    assertEncryptionConfigured()
    const accessToken = await withLockedConnection(hashOpaque(sessionId), async (_client, connection) => {
      if (connection.status !== 'connected') return null
      return decryptSecret(connection.access_token_ciphertext, `access:${connection.meli_user_id}`)
    })
    if (!accessToken) {
      res.status(401).json({ error: 'Conexão com o Mercado Livre ausente.' })
      return
    }

    let databasePassword: string | undefined
    try { databasePassword = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : undefined }
    catch { /* URL indisponível para extração de senha */ }
    const secrets = [accessToken, sessionId, process.env.MELI_CLIENT_SECRET,
      process.env.MELI_TOKEN_ENCRYPTION_KEY, process.env.DATABASE_URL, databasePassword, req.get('cookie')]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.length - a.length)
    const safeText = (value: string) => secrets.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value)
      .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    const scalar = (value: unknown): string | number | boolean | null | undefined => {
      if (typeof value === 'string') return safeText(value)
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
      return undefined
    }
    const fields = (source: Record<string, unknown>, names: string[]) => {
      const result: Record<string, string | number | boolean | null> = {}
      for (const name of names) {
        const value = scalar(source[name])
        if (value !== undefined) result[name] = value
      }
      return result
    }
    const read = async (url: string, kind: 'application' | 'user') => {
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        })
        const result: Record<string, unknown> = { httpStatus: response.status }
        const contentType = response.headers.get('content-type')
        if (!contentType || !/\b(?:application\/json|[^\s;/]+\/[^\s;/]+\+json)\b/i.test(contentType)) return result
        let parsed: unknown
        try { parsed = await response.json() } catch { return result }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
        const source = parsed as Record<string, unknown>
        if (!response.ok) return { ...result, ...fields(source, ['error', 'code', 'message', 'status', 'blocked_by']) }

        Object.assign(result, fields(source, kind === 'application'
          ? ['id', 'site_id', 'active', 'certification_status']
          : ['id', 'nickname', 'blocked_by', 'validation_status', 'restriction_status', 'restriction_code', 'block_code']))
        if (kind === 'application') {
          if (Array.isArray(source.scopes)) {
            const scopes = source.scopes.filter((scope): scope is string => typeof scope === 'string').map(safeText)
            result.scopes = scopes
            result.hasMercadoPagoScope = source.scopes.some((scope) => typeof scope === 'string' && scope.startsWith('urn:mp:'))
          } else {
            result.hasMercadoPagoScope = false
          }
        } else {
          if (Array.isArray(source.tags)) result.tags = source.tags.map(scalar).filter((tag) => tag !== undefined)
          if (source.status && typeof source.status === 'object' && !Array.isArray(source.status)) {
            result.status = fields(source.status as Record<string, unknown>,
              ['site_status', 'status', 'code', 'blocked_by', 'validation_status', 'restriction_status', 'restriction_code', 'block_code'])
          } else {
            const status = scalar(source.status)
            if (status !== undefined) result.status = status
          }
        }
        return result
      } catch {
        return { httpStatus: null, error: 'Não foi possível consultar o Mercado Livre.' }
      }
    }

    const [application, user] = await Promise.all([
      read('https://api.mercadolibre.com/applications/6332151948097527', 'application'),
      read('https://api.mercadolibre.com/users/3334862827?attributes=status', 'user'),
    ])
    res.json({ application, user })
  } catch {
    res.status(503).json({ error: 'Não foi possível consultar o Mercado Livre.' })
  }
})

export default router
