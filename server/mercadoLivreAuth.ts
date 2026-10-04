import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getMercadoLivreConfig } from './mercadoLivreConfig.js'
import { assertEncryptionConfigured, decryptSecret, encryptSecret, hashOpaque } from './mercadoLivreCrypto.js'
import { createAuthorizationAttempt, consumeAuthorizationAttempt, getConnectionSummary, saveConnection } from './mercadoLivreRepository.js'
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

export default router
