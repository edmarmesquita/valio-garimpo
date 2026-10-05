import 'dotenv/config'
import { query } from '../server/mercadoLivreDb.js'
import { getMercadoLivreConfig } from '../server/mercadoLivreConfig.js'
import { getBackendAccessToken } from '../server/mercadoLivreTokenService.js'

const APP_ID = '6332151948097527'
const USER_ID = '3334862827'
let diagnosticToken = ''

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const secrets = [diagnosticToken, process.env.DATABASE_URL, process.env.MELI_CLIENT_SECRET,
      process.env.MELI_TOKEN_ENCRYPTION_KEY].filter((item): item is string => Boolean(item))
    return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value)
  }
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1)).filter((item) => item !== undefined)
  if (typeof value !== 'object') return undefined
  const allowed = new Set(['site_status', 'status', 'state', 'active', 'allow', 'code', 'codes',
    'buy', 'sell', 'list', 'billing', 'shipping', 'validation', 'blocked_by', 'required_action'])
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key))
    .map(([key, item]) => [key, safeValue(item, depth + 1)]).filter(([, item]) => item !== undefined))
}

function pick(source: unknown, keys: string[]) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const object = source as Record<string, unknown>
  return Object.fromEntries(keys.filter((key) => key in object)
    .map((key) => [key, safeValue(object[key])]).filter(([, value]) => value !== undefined))
}

async function inspect(url: string, token: string, kind: 'application' | 'user') {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    const body: unknown = await response.json().catch(() => null)
    const fields = kind === 'application'
      ? ['id', 'site_id', 'active', 'certification_status', 'status', 'state', 'scopes']
      : ['id', 'nickname', 'status', 'tags', 'codes', 'blocked_by', 'validation']
    const safe = pick(body, response.ok ? fields : ['error', 'message', 'status', 'code'])
    const scopes = response.ok && body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).scopes : undefined
    return {
      httpStatus: response.status,
      body: safe,
      ...(kind === 'application' ? { hasUrnMpScope: Array.isArray(scopes) &&
        scopes.some((scope) => typeof scope === 'string' && scope.startsWith('urn:mp:')) } : {}),
    }
  } catch {
    return { httpStatus: null, error: 'Falha de rede ou tempo esgotado.' }
  }
}

async function main() {
  const config = getMercadoLivreConfig()
  if (!config || config.clientId !== APP_ID || !process.env.DATABASE_URL || !process.env.MELI_TOKEN_ENCRYPTION_KEY) {
    console.log(JSON.stringify({ error: 'Configuração OAuth local ausente ou aplicação divergente.' }))
    process.exitCode = 1
    return
  }
  const sessions = await query<{ session_hash: string }>(
    `SELECT session.session_hash FROM oauth_sessions AS session
     JOIN meli_connections AS connection ON connection.meli_user_id = session.meli_user_id
     WHERE session.meli_user_id = $1 AND session.expires_at > now()
       AND connection.status = 'connected'
     ORDER BY session.expires_at DESC LIMIT 1`, [USER_ID],
  )
  const sessionHash = sessions.rows[0]?.session_hash
  if (!sessionHash) {
    console.log(JSON.stringify({ error: 'Sessão OAuth ativa da conta não encontrada.' }))
    process.exitCode = 1
    return
  }
  const token = await getBackendAccessToken(sessionHash, config)
  if (!token) {
    console.log(JSON.stringify({ error: 'Sessão OAuth expirada; reconexão necessária.' }))
    process.exitCode = 1
    return
  }
  diagnosticToken = token
  const application = await inspect(`https://api.mercadolibre.com/applications/${APP_ID}`, token, 'application')
  const user = await inspect(`https://api.mercadolibre.com/users/${USER_ID}?attributes=status`, token, 'user')
  console.log(JSON.stringify({ application, user }, null, 2))
}

main().catch(() => {
  console.log(JSON.stringify({ error: 'Não foi possível executar o diagnóstico OAuth.' }))
  process.exitCode = 1
})
