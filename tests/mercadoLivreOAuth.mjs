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
let itemFailureMode = null
let itemCalls = 0
let bulkCalls = 0
let bulkMode = 'success'
let grantMode = 'normal'
let grantCalls = 0
let applicationStatusCalls = 0
let userStatusCalls = 0
let statusDiagnosticMode = 'ok'
const usedRefreshTokens = new Set()
const provider = createServer(async (req, res) => {
  if (req.url === '/items/bulk?ids=MLB4045941169') {
    bulkCalls++
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.accept, 'application/json')
    assert.equal(req.headers.authorization, 'Bearer access-1')
    if (bulkMode === 'html') {
      res.writeHead(503, { 'content-type': 'text/html' }).end('<html>access-1 refresh-1 secret-teste</html>')
      return
    }
    const status = bulkMode === 'forbidden' ? 403 : 200
    const body = (bulkMode === 'success' || bulkMode === 'pictures') ? [{
      id: 'MLB4045941169', status_code: 200,
      body: { id: 'MLB4045941169', title: 'Produto bulk', price: 89.9,
        currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB4045941169',
        status: 'active', available_quantity: 2,
        ...(bulkMode === 'pictures'
          ? { pictures: [{ id: 'foto-1', url: 'http://http2.mlstatic.com/bulk.jpg',
            secure_url: 'https://http2.mlstatic.com/bulk.jpg', access_token: 'nunca-retornar' }] }
          : { thumbnail: 'https://http2.mlstatic.com/bulk.jpg' }),
        access_token: 'nunca-retornar' },
      Authorization: 'Bearer access-1',
    }] : (bulkMode === 'item-error' || bulkMode === 'item-error-200') ? [{
      id: 'MLB4045941169', status_code: bulkMode === 'item-error-200' ? 200 : 403,
      body: { error: 'forbidden', code: 'PA_BLOCKED', message: 'Bearer access-1; refresh-1',
        status: 403, blocked_by: 'policy_agent', access_token: 'nunca-retornar' },
    }] : { error: 'access_denied', code: 'PA_BLOCKED', message: 'Bearer access-1; secret-teste',
      status: 403, blocked_by: 'policy_agent', refresh_token: 'nunca-retornar' }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
    return
  }
  if (req.url === '/applications/6332151948097527' || req.url === '/users/3334862827?attributes=status') {
    const application = req.url.startsWith('/applications/')
    if (application) applicationStatusCalls++
    else userStatusCalls++
    assert.match(req.headers.authorization || '', /^Bearer access-/)
    if (statusDiagnosticMode === 'unexpected') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('<html>nunca-retornar</html>')
      return
    }
    const status = statusDiagnosticMode === 'ok' ? 200 : Number(statusDiagnosticMode)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 200
      ? application
        ? { id: 6332151948097527, site_id: 'MLB', active: true, certification_status: 'certified',
            scopes: ['read', 'urn:mp:payments'], access_token: 'nunca-retornar', client_secret: 'secret-teste' }
        : { id: 3334862827, nickname: 'conta-teste', status: { site_status: 'active', block_code: 'none', access_token: 'nunca-retornar' },
            tags: ['validated'], validation_status: 'approved', refresh_token: 'refresh-1' }
      : { error: 'forbidden', code: 'PA_BLOCKED', message: `Bloqueado para ${req.headers.authorization}; secret-teste`,
          status, blocked_by: 'policy_agent', access_token: 'nunca-retornar', Authorization: 'nunca-retornar' }))
    return
  }
  if (req.url === '/applications/6332151948097527/grants') {
    grantCalls++
    if (!req.headers.authorization?.startsWith('Bearer access-') ||
        req.headers.authorization === `Bearer ${rejectedAccessToken}`) {
      res.writeHead(401).end()
      return
    }
    if (grantMode === 'unavailable') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'nunca-retornar', refresh_token: 'refresh-1', message: 'cookie-secreto' }))
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ paging: { total: 2 }, grants: [
      { user_id: 999, app_id: 6332151948097527, date_created: '2020-01-01', scopes: ['write'], access_token: 'nunca-retornar' },
      ...(grantMode === 'missing' ? [] : [{
        user_id: 123456789, app_id: 6332151948097527,
        date_created: '2026-10-04T10:00:00.000-03:00', scopes: ['read', 'offline_access'],
        access_token: 'nunca-retornar', refresh_token: 'refresh-1', cookie: 'cookie-secreto', client_secret: 'secret-teste',
      }]),
    ] }))
    return
  }
  if (req.url?.startsWith('/items/')) {
    itemCalls++
    if (req.url === '/items/MLB4045941169' && itemFailureMode === 'diagnostic-json') {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        error: 'forbidden', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
        message: `Bloqueado para ${req.headers.authorization}`,
        status: 403, blocked_by: 'policy_agent',
        access_token: 'nunca-retornar', refresh_token: 'nunca-retornar',
        Authorization: 'nunca-retornar', DATABASE_URL: 'nunca-retornar', client_secret: 'nunca-retornar',
      }))
      return
    }
    if (itemFailureMode === 'forbidden') {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        error: 'forbidden', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
        message: 'access-4 refresh-4 secret-teste cookie-secreto',
        blocked_by: 'policy_agent', status: 403,
        access_token: 'nunca-retornar', refresh_token: 'refresh-4',
        Authorization: 'Bearer access-4', client_secret: 'secret-teste', DATABASE_URL: 'postgres://secret',
      }))
      return
    }
    if (itemFailureMode === 'html') {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>access-1 refresh-1 secret-teste cookie-secreto nunca-retornar</html>')
      return
    }
    if (itemFailureMode === 'json') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'provider_unavailable', message: 'access-1 refresh-1 secret-teste cookie-secreto', access_token: 'nunca-retornar', refresh_token: 'refresh-1' }))
      return
    }
    if (req.headers.authorization === `Bearer ${rejectedAccessToken}`) {
      res.writeHead(401).end()
      return
    }
    if (req.url !== '/items/MLB1234567890') {
      res.writeHead(404).end()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      id: 'MLB1234567890', title: 'Produto de teste', price: 129.9,
      currency_id: 'BRL', thumbnail: 'https://http2.mlstatic.com/teste.jpg',
      permalink: 'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
      status: 'active', available_quantity: 5, access_token: 'nunca-retornar',
    }))
    return
  }
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
  MELI_CLIENT_ID: '6332151948097527',
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

async function requestItem(port, link, cookie) {
  return fetch(`http://127.0.0.1:${port}/api/mercadolivre/produto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ link }),
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

  const grantsPath = '/api/mercadolivre/diagnostico/grants'
  assert.equal((await request(apiPorts[0], grantsPath)).status, 401)
  assert.equal((await request(apiPorts[0], grantsPath, `meli_oauth_session=${'z'.repeat(43)}`)).status, 401)
  assert.equal(grantCalls, 0)
  const grantResponse = await request(apiPorts[1], grantsPath, cookie)
  assert.equal(grantResponse.status, 200)
  const grantBody = await grantResponse.json()
  assert.deepEqual(grantBody, {
    user_id: '123456789', app_id: '6332151948097527',
    date_created: '2026-10-04T10:00:00.000-03:00', scopes: ['read', 'offline_access'],
  })
  for (const secret of ['nunca-retornar', 'refresh-1', 'cookie-secreto', 'secret-teste']) {
    assert.ok(!JSON.stringify(grantBody).includes(secret))
  }
  grantMode = 'missing'
  assert.equal((await request(apiPorts[0], grantsPath, cookie)).status, 404)
  grantMode = 'unavailable'
  const failedGrants = await request(apiPorts[0], grantsPath, cookie)
  assert.equal(failedGrants.status, 502)
  assert.ok(!JSON.stringify(await failedGrants.json()).includes('nunca-retornar'))
  grantMode = 'normal'

  const validLink = 'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM?utm_source=afiliado'
  const validItem = await requestItem(apiPorts[1], validLink, cookie)
  assert.equal(validItem.status, 200)
  const validBody = await validItem.json()
  assert.deepEqual(validBody, { ok: true, produto: {
    id: 'MLB1234567890', titulo: 'Produto de teste', preco: 129.9, moeda: 'BRL',
    imagemPrincipal: 'https://http2.mlstatic.com/teste.jpg',
    permalink: 'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
    status: 'active', quantidadeDisponivel: 5,
  } })
  assert.ok(!JSON.stringify(validBody).includes('nunca-retornar'))
  assert.equal((await requestItem(apiPorts[0], validLink)).status, 401)
  const callsBeforeInvalid = itemCalls
  for (const link of ['https://example.com/MLB-1234567890', 'https://meli.la/abc', 'https://www.mercadolivre.com.br/p/MLB1234567890']) {
    const invalid = await requestItem(apiPorts[0], link, cookie)
    assert.equal(invalid.status, 400)
    assert.match((await invalid.json()).error, /Link inválido/)
  }
  assert.equal(itemCalls, callsBeforeInvalid)
  const missing = await requestItem(apiPorts[0], 'https://produto.mercadolivre.com.br/MLB-9999999999-produto-_JM', cookie)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), {
    ok: false, error: 'Mercado Livre indisponível.',
    providerStatus: 404, providerCode: null, providerMessage: null,
  })
  itemFailureMode = 'json'
  const providerDown = await requestItem(apiPorts[0], validLink, cookie)
  assert.equal(providerDown.status, 502)
  assert.deepEqual(await providerDown.json(), {
    ok: false, error: 'Mercado Livre indisponível.',
    providerStatus: 503, providerCode: 'provider_unavailable', providerMessage: null,
  })
  assert.match(childErrors[0], /stage: 'items'/)
  assert.match(childErrors[0], /itemId: 'MLB1234567890'/)
  assert.match(childErrors[0], /providerStatus: 503/)
  assert.ok(!childErrors[0].includes('nunca-retornar'))
  assert.ok(!childErrors[0].includes('access-1'))
  for (const secret of ['refresh-1', 'secret-teste', 'cookie-secreto']) {
    assert.ok(!childErrors[0].includes(secret))
  }
  itemFailureMode = 'html'
  const logsBeforeHtml = childErrors[0].length
  const htmlFailure = await requestItem(apiPorts[0], validLink, cookie)
  assert.equal(htmlFailure.status, 502)
  assert.deepEqual(await htmlFailure.json(), {
    ok: false, error: 'Mercado Livre indisponível.',
    providerStatus: 503, providerCode: null, providerMessage: null,
  })
  const htmlLog = childErrors[0].slice(logsBeforeHtml)
  assert.match(htmlLog, /providerContentType: 'text\/html'/)
  assert.match(htmlLog, /bodyLength: 74/)
  assert.ok(!htmlLog.includes('itemId:'))
  for (const secret of ['access-1', 'refresh-1', 'secret-teste', 'cookie-secreto', 'nunca-retornar', '<html>']) {
    assert.ok(!htmlLog.includes(secret))
  }
  itemFailureMode = null

  const itemDiagnosticPath = '/api/mercadolivre/diagnostico/item'
  const statusDiagnosticPath = '/api/mercadolivre/diagnostico/status'
  assert.equal((await request(apiPorts[0], statusDiagnosticPath)).status, 401)
  assert.equal((await request(apiPorts[0], statusDiagnosticPath, `meli_oauth_session=${'z'.repeat(43)}`)).status, 401)
  assert.equal(applicationStatusCalls, 0)
  assert.equal(userStatusCalls, 0)
  const assertStatusCall = async (mode, expectedStatus) => {
    statusDiagnosticMode = mode
    const beforeApplication = applicationStatusCalls
    const beforeUser = userStatusCalls
    const beforeRefresh = refreshCalls
    const response = await request(apiPorts[0], statusDiagnosticPath, cookie)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(applicationStatusCalls, beforeApplication + 1)
    assert.equal(userStatusCalls, beforeUser + 1)
    assert.equal(refreshCalls, beforeRefresh)
    assert.equal(body.application.httpStatus, expectedStatus)
    assert.equal(body.user.httpStatus, expectedStatus)
    for (const secret of ['access-1', 'nunca-retornar', 'refresh-1', 'secret-teste', 'postgres://', 'Authorization', 'client_secret']) {
      assert.ok(!JSON.stringify(body).includes(secret))
    }
    return body
  }
  assert.deepEqual(await assertStatusCall('ok', 200), {
    application: { httpStatus: 200, id: 6332151948097527, site_id: 'MLB', active: true,
      certification_status: 'certified', scopes: ['read', 'urn:mp:payments'], hasMercadoPagoScope: true },
    user: { httpStatus: 200, id: 3334862827, nickname: 'conta-teste', validation_status: 'approved',
      tags: ['validated'], status: { site_status: 'active', block_code: 'none' } },
  })
  for (const statusCode of [401, 403]) {
    const body = await assertStatusCall(String(statusCode), statusCode)
    for (const part of [body.application, body.user]) {
      assert.deepEqual(part, { httpStatus: statusCode, error: 'forbidden', code: 'PA_BLOCKED',
        message: 'Bloqueado para Bearer [REDACTED]; [REDACTED]', status: statusCode, blocked_by: 'policy_agent' })
    }
  }
  assert.deepEqual(await assertStatusCall('unexpected', 200), {
    application: { httpStatus: 200 }, user: { httpStatus: 200 },
  })
  statusDiagnosticMode = 'ok'
  const callsBeforeUnauthenticatedDiagnostic = itemCalls
  assert.equal((await request(apiPorts[0], itemDiagnosticPath)).status, 401)
  assert.equal((await request(apiPorts[0], itemDiagnosticPath, `meli_oauth_session=${'z'.repeat(43)}`)).status, 401)
  assert.equal(itemCalls, callsBeforeUnauthenticatedDiagnostic)
  itemFailureMode = 'diagnostic-json'
  const callsBeforeJsonDiagnostic = itemCalls
  const refreshBeforeJsonDiagnostic = refreshCalls
  const jsonDiagnostic = await request(apiPorts[0], itemDiagnosticPath, cookie)
  assert.equal(jsonDiagnostic.status, 200)
  assert.equal(itemCalls, callsBeforeJsonDiagnostic + 1)
  assert.equal(refreshCalls, refreshBeforeJsonDiagnostic)
  const jsonDiagnosticBody = await jsonDiagnostic.json()
  const diagnosticProviderBody = {
    error: 'forbidden', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
    message: 'Bloqueado para Bearer [REDACTED]', status: 403, blocked_by: 'policy_agent',
  }
  const originalJsonBody = JSON.stringify({
    error: 'forbidden', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
    message: 'Bloqueado para Bearer access-1', status: 403, blocked_by: 'policy_agent',
    access_token: 'nunca-retornar', refresh_token: 'nunca-retornar',
    Authorization: 'nunca-retornar', DATABASE_URL: 'nunca-retornar', client_secret: 'nunca-retornar',
  })
  assert.deepEqual(jsonDiagnosticBody, {
    providerStatus: 403, contentType: 'application/json; charset=utf-8',
    bodySize: Buffer.byteLength(originalJsonBody), body: diagnosticProviderBody,
  })
  for (const secret of ['access-1', 'nunca-retornar', 'refresh-1', 'secret-teste', 'postgres://']) {
    assert.ok(!JSON.stringify(jsonDiagnosticBody).includes(secret))
  }

  itemFailureMode = 'html'
  const callsBeforeHtmlDiagnostic = itemCalls
  const htmlDiagnostic = await request(apiPorts[0], itemDiagnosticPath, cookie)
  assert.equal(htmlDiagnostic.status, 200)
  assert.equal(itemCalls, callsBeforeHtmlDiagnostic + 1)
  assert.deepEqual(await htmlDiagnostic.json(), {
    providerStatus: 503, contentType: 'text/html; charset=utf-8',
    bodySize: Buffer.byteLength('<html>access-1 refresh-1 secret-teste cookie-secreto nunca-retornar</html>'),
  })
  itemFailureMode = null

  rejectedAccessToken = 'access-1'
  const callsBeforeRejectedDiagnostic = itemCalls
  const refreshBeforeRejectedDiagnostic = refreshCalls
  const rejectedDiagnostic = await request(apiPorts[0], itemDiagnosticPath, cookie)
  assert.equal(rejectedDiagnostic.status, 200)
  assert.equal(itemCalls, callsBeforeRejectedDiagnostic + 1)
  assert.equal(refreshCalls, refreshBeforeRejectedDiagnostic)
  assert.deepEqual(await rejectedDiagnostic.json(), { providerStatus: 401, contentType: null, bodySize: 0 })
  rejectedAccessToken = null

  const bulkPath = '/api/mercadolivre/diagnostico/item-bulk'
  assert.equal((await request(apiPorts[0], bulkPath)).status, 401)
  assert.equal((await request(apiPorts[0], bulkPath, `meli_oauth_session=${'z'.repeat(43)}`)).status, 401)
  assert.equal(bulkCalls, 0)
  const assertBulkCall = async (mode, expectedStatus, expectedBody) => {
    bulkMode = mode
    const beforeBulk = bulkCalls
    const beforeItems = itemCalls
    const beforeRefresh = refreshCalls
    const response = await request(apiPorts[0], bulkPath, cookie)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(bulkCalls, beforeBulk + 1)
    assert.equal(itemCalls, beforeItems)
    assert.equal(refreshCalls, beforeRefresh)
    assert.equal(body.providerStatus, expectedStatus)
    assert.equal(body.contentType, mode === 'html' ? 'text/html' : 'application/json; charset=utf-8')
    assert.ok(body.bodySize > 0)
    assert.deepEqual(body.body, expectedBody)
    for (const secret of ['access-1', 'refresh-1', 'nunca-retornar', 'secret-teste',
      'postgres://', 'Authorization', 'access_token', 'refresh_token', 'DATABASE_URL', 'client_secret']) {
      assert.ok(!JSON.stringify(body).includes(secret))
    }
  }
  await assertBulkCall('success', 200, {
    id: 'MLB4045941169', status_code: 200,
    body: { id: 'MLB4045941169', title: 'Produto bulk', price: 89.9,
      currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB4045941169',
      status: 'active', available_quantity: 2, thumbnail: 'https://http2.mlstatic.com/bulk.jpg' },
  })
  await assertBulkCall('pictures', 200, {
    id: 'MLB4045941169', status_code: 200,
    body: { id: 'MLB4045941169', title: 'Produto bulk', price: 89.9,
      currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB4045941169',
      status: 'active', available_quantity: 2 },
  })
  await assertBulkCall('item-error', 200, { error: 'forbidden', code: 'PA_BLOCKED',
    message: 'Bearer [REDACTED]; [REDACTED]', status: 403, blocked_by: 'policy_agent' })
  await assertBulkCall('item-error-200', 200, { error: 'forbidden', code: 'PA_BLOCKED',
    message: 'Bearer [REDACTED]; [REDACTED]', status: 403, blocked_by: 'policy_agent' })
  await assertBulkCall('forbidden', 403, { error: 'access_denied', code: 'PA_BLOCKED',
    message: 'Bearer [REDACTED]; [REDACTED]', status: 403, blocked_by: 'policy_agent' })
  await assertBulkCall('html', 503, undefined)
  bulkMode = 'success'

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
    const refreshedGrant = await request(apiPorts[1], grantsPath, cookie)
    assert.equal(refreshedGrant.status, 200)
    assert.deepEqual((await refreshedGrant.json()).scopes, ['read', 'offline_access'])
    const refreshedItem = await requestItem(apiPorts[1], validLink, cookie)
    assert.equal(refreshedItem.status, 200)
    const newRow = (await client.query('SELECT * FROM meli_connections')).rows[0]
    assert.equal(newRow.token_version, '2')
    assert.ok(!JSON.stringify(newRow).includes('refresh-2'))

    rejectedAccessToken = 'access-2'
    const renewedDiagnostic = await request(apiPorts[0], diagnosticPath, cookie)
    assert.equal(renewedDiagnostic.status, 200)
    assert.deepEqual(await renewedDiagnostic.json(), { connected: true, id: '123456789', nickname: 'conta-teste' })
    assert.equal(refreshCalls, 2)
    rejectedAccessToken = 'access-3'
    const rejectedItem = await requestItem(apiPorts[0], validLink, cookie)
    assert.equal(rejectedItem.status, 200)
    assert.equal(refreshCalls, 3)
    assert.equal((await client.query('SELECT token_version FROM meli_connections')).rows[0].token_version, '4')

    itemFailureMode = 'forbidden'
    const forbiddenItem = await requestItem(apiPorts[0], validLink, cookie)
    assert.equal(forbiddenItem.status, 502)
    const forbiddenBody = await forbiddenItem.json()
    assert.deepEqual(forbiddenBody, {
      ok: false, error: 'Mercado Livre indisponível.',
      providerStatus: 403, providerCode: 'forbidden', providerMessage: null,
    })
    assert.match(childErrors[0], /providerError: 'forbidden'/)
    assert.match(childErrors[0], /providerBodyCode: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES'/)
    assert.match(childErrors[0], /providerBlockedBy: 'policy_agent'/)
    assert.match(childErrors[0], /providerBodyStatus: 403/)
    assert.match(childErrors[0], /providerContentType: 'application\/json'/)
    for (const secret of ['nunca-retornar', 'access-4', 'refresh-4', 'secret-teste', 'cookie-secreto', 'postgres://secret', '<html>']) {
      assert.ok(!childErrors[0].includes(secret))
      assert.ok(!JSON.stringify(forbiddenBody).includes(secret))
    }
    itemFailureMode = null

    rejectedAccessToken = 'access-5'
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
    const unavailableItem = await requestItem(unavailablePort, validLink, cookie)
    assert.equal(unavailableItem.status, 503)
  } finally {
    unavailable.kill()
  }
  console.log('OAuth e produto: link válido/inválido, inexistente, renovação, falha Mercado Livre/Neon: OK')
} finally {
  for (const child of children) child.kill()
  await new Promise((resolve) => provider.close(resolve))
  await dbServer.stop()
  await db.close()
}
