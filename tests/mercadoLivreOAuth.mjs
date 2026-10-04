import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'

const dbPort = 46000 + Math.floor(Math.random() * 1000)
const providerPort = dbPort + 1000
const apiPorts = [dbPort + 2000, dbPort + 2001]
const key = randomBytes(32).toString('base64')
const db = await PGlite.create()
const migration = await readFile(new URL('../migrations/001_mercado_livre_oauth.sql', import.meta.url), 'utf8')
await db.exec(migration)
const dbServer = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 8 })
await dbServer.start()

let refreshCalls = 0
let rejectedAccessToken = null
let rejectRefresh = false
const usedRefreshTokens = new Set()
const provider = createServer(async (req, res) => {
  if (req.url === '/users/me') {
    const authorization = req.headers.authorization
    if (!authorization?.startsWith('Bearer access-') || authorization === `Bearer ${rejectedAccessToken}`) {
      res.writeHead(401).end()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 123456789, nickname: 'conta-teste', access_token: 'nunca-retornar' }))
    return
  }
  if (req.url === '/oauth/token') {
    let body = ''
    for await (const chunk of req) body += chunk
    const params = new URLSearchParams(body)
    const grant = params.get('grant_type')
    if (grant === 'authorization_code' && params.get('code') === 'codigo-teste' && params.get('code_verifier')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, user_id: 123456789 }))
      return
    }
    if (grant === 'refresh_token') {
      refreshCalls++
      const oldToken = params.get('refresh_token')
      if (rejectRefresh || !oldToken || usedRefreshTokens.has(oldToken)) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }
      usedRefreshTokens.add(oldToken)
      await new Promise((resolve) => setTimeout(resolve, 80))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ access_token: `access-${refreshCalls + 1}`, refresh_token: `refresh-${refreshCalls + 1}`, expires_in: 3600, user_id: 123456789 }))
      return
    }
  }
  res.writeHead(400).end()
})
await new Promise((resolve) => provider.listen(providerPort, '127.0.0.1', resolve))

const env = {
  ...process.env,
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres`,
  MELI_TOKEN_ENCRYPTION_KEY: key,
  MELI_CLIENT_ID: 'client-teste',
  MELI_CLIENT_SECRET: 'secret-teste',
  MELI_REDIRECT_URI: `http://localhost:${apiPorts[0]}/api/mercadolivre/callback`,
  MELI_TEST_PROVIDER_PORT: String(providerPort),
}
const children = apiPorts.map((port) => spawn(process.execPath, [
  '--require', './tests/meliMockFetch.cjs', '--import', 'tsx', 'server/local.ts',
], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }))
const childErrors = children.map(() => '')
children.forEach((child, index) => {
  child.stderr.on('data', (chunk) => { childErrors[index] += chunk.toString() })
})

async function request(port, path, cookie) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
}

async function ready(port) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await request(port, '/api/health')).ok) return
    } catch { /* ainda iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`API ${port} não iniciou: ${childErrors[apiPorts.indexOf(port)]}`)
}

try {
  await Promise.all(apiPorts.map(ready))
  for (const port of apiPorts) {
    assert.equal((await request(port, '/api/health')).status, 200)
    assert.equal((await request(port, '/api/garimpo/status')).status, 200)
  }

  const start = await request(apiPorts[0], '/api/mercadolivre/auth/iniciar')
  assert.equal(start.status, 302)
  const cookie = start.headers.get('set-cookie').split(';')[0]
  const authUrl = new URL(start.headers.get('location'))
  const state = authUrl.searchParams.get('state')
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256')
  const inspectAttempt = new pg.Client({ connectionString: env.DATABASE_URL })
  await inspectAttempt.connect()
  const attempt = (await inspectAttempt.query('SELECT verifier_ciphertext FROM oauth_attempts')).rows[0]
  assert.ok(attempt.verifier_ciphertext.startsWith('v1:'))
  await inspectAttempt.end()
  assert.equal((await request(apiPorts[1], `/api/mercadolivre/callback?state=${'x'.repeat(43)}&code=codigo-teste`, cookie)).headers.get('location'), '/?meli=erro')
  assert.equal((await request(apiPorts[1], `/api/mercadolivre/callback?state=${state}&code=codigo-teste`, `meli_oauth_session=${'z'.repeat(43)}`)).headers.get('location'), '/?meli=erro')
  const callback = await request(apiPorts[1], `/api/mercadolivre/callback?state=${state}&code=codigo-teste`, cookie)
  if (callback.headers.get('location') !== '/?meli=conectado') {
    const inspect = new pg.Client({ connectionString: env.DATABASE_URL })
    await inspect.connect()
    console.error('Callback falhou:', {
      attempts: (await inspect.query('SELECT count(*)::int AS n FROM oauth_attempts')).rows[0].n,
      connections: (await inspect.query('SELECT count(*)::int AS n FROM meli_connections')).rows[0].n,
      childErrors,
    })
    await inspect.end()
  }
  assert.equal(callback.headers.get('location'), '/?meli=conectado')
  assert.equal((await request(apiPorts[0], `/api/mercadolivre/callback?state=${state}&code=codigo-teste`, cookie)).headers.get('location'), '/?meli=erro')

  const status = await request(apiPorts[0], '/api/mercadolivre/status', cookie)
  assert.equal(status.status, 200)
  assert.deepEqual(await status.json(), { connected: true, account: { id: '123456789', nickname: 'conta-teste' } })
  const diagnosticPath = '/api/mercadolivre/diagnostico'
  assert.deepEqual(await (await request(apiPorts[0], diagnosticPath)).json(), { connected: false })
  assert.deepEqual(await (await request(apiPorts[0], diagnosticPath, `meli_oauth_session=${'z'.repeat(43)}`)).json(), { connected: false })
  const diagnostic = await request(apiPorts[1], diagnosticPath, cookie)
  assert.equal(diagnostic.status, 200)
  assert.deepEqual(await diagnostic.json(), { connected: true, id: '123456789', nickname: 'conta-teste' })

  const client = new pg.Client({ connectionString: env.DATABASE_URL })
  await client.connect()
  try {
    const row = (await client.query('SELECT * FROM meli_connections')).rows[0]
    assert.ok(row.access_token_ciphertext.startsWith('v1:'))
    assert.ok(row.refresh_token_ciphertext.startsWith('v1:'))
    assert.ok(!JSON.stringify(row).includes('refresh-1'))
    const stateHash = createHash('sha256').update(state).digest('hex')
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM oauth_attempts WHERE state_hash = $1', [stateHash])).rows[0].count, 0)

    await client.query("UPDATE meli_connections SET access_expires_at = now() - interval '1 minute'")
    const concurrent = await Promise.all(apiPorts.map((port) => request(port, '/api/mercadolivre/status', cookie)))
    for (const response of concurrent) {
      assert.equal(response.status, 200)
      assert.equal((await response.json()).connected, true)
    }
    assert.equal(refreshCalls, 1)
    const newRow = (await client.query('SELECT * FROM meli_connections')).rows[0]
    assert.equal(newRow.token_version, '2')
    assert.ok(!JSON.stringify(newRow).includes('refresh-2'))

    rejectedAccessToken = 'access-2'
    const renewedDiagnostic = await request(apiPorts[0], diagnosticPath, cookie)
    assert.equal(renewedDiagnostic.status, 200)
    assert.deepEqual(await renewedDiagnostic.json(), { connected: true, id: '123456789', nickname: 'conta-teste' })
    assert.equal(refreshCalls, 2)
    assert.equal((await client.query('SELECT token_version FROM meli_connections')).rows[0].token_version, '3')

    rejectedAccessToken = 'access-3'
    rejectRefresh = true
    const reconnectDiagnostic = await request(apiPorts[1], diagnosticPath, cookie)
    assert.equal(reconnectDiagnostic.status, 200)
    assert.deepEqual(await reconnectDiagnostic.json(), { connected: false, requiresReconnect: true })
    assert.equal((await client.query('SELECT status FROM meli_connections')).rows[0].status, 'reauth_required')
  } finally {
    await client.end()
  }
  assert.equal((await request(apiPorts[0], '/api/mercadolivre/status')).status, 200)
  const unavailablePort = apiPorts[1] + 1
  const unavailable = spawn(process.execPath, [
    '--require', './tests/meliMockFetch.cjs', '--import', 'tsx', 'server/local.ts',
  ], {
    env: { ...env, PORT: String(unavailablePort), DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/postgres' },
    stdio: 'ignore',
  })
  try {
    await ready(unavailablePort)
    assert.equal((await request(unavailablePort, '/api/health')).status, 200)
    assert.equal((await request(unavailablePort, '/api/garimpo/status')).status, 200)
    const unavailableStatus = await request(unavailablePort, '/api/mercadolivre/status', cookie)
    assert.equal(unavailableStatus.status, 503)
    assert.equal((await unavailableStatus.json()).ok, false)
    const unavailableDiagnostic = await request(unavailablePort, diagnosticPath, cookie)
    assert.equal(unavailableDiagnostic.status, 503)
    assert.equal((await unavailableDiagnostic.json()).ok, false)
  } finally {
    unavailable.kill()
  }
  console.log('OAuth: callback/status/diagnostico, state, criptografia, persistência, renovação, falha Neon e health: OK')
} finally {
  for (const child of children) child.kill()
  await new Promise((resolve) => provider.close(resolve))
  await dbServer.stop()
  await db.close()
}
