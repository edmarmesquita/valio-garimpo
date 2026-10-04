import type { PoolClient, QueryResultRow } from 'pg'
import { query, withTransaction } from './mercadoLivreDb.js'

export type ConnectionRow = QueryResultRow & {
  meli_user_id: string
  nickname: string | null
  scope: string | null
  access_token_ciphertext: string
  refresh_token_ciphertext: string
  access_expires_at: Date
  refresh_issued_at: Date
  status: 'connected' | 'reauth_required'
  token_version: string
}

export type ConnectionSummary = {
  meli_user_id: string
  nickname: string | null
  access_expires_at: Date
  refresh_issued_at: Date
  status: 'connected' | 'reauth_required'
}

export async function createAuthorizationAttempt(
  sessionHash: string,
  stateHash: string,
  verifierCiphertext: string,
  sessionExpiresAt: Date,
  attemptExpiresAt: Date,
) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM oauth_attempts WHERE expires_at <= now()')
    await client.query('DELETE FROM oauth_sessions WHERE expires_at <= now()')
    await client.query(
      'INSERT INTO oauth_sessions (session_hash, expires_at) VALUES ($1, $2)',
      [sessionHash, sessionExpiresAt],
    )
    await client.query(
      'INSERT INTO oauth_attempts (state_hash, session_hash, verifier_ciphertext, expires_at) VALUES ($1, $2, $3, $4)',
      [stateHash, sessionHash, verifierCiphertext, attemptExpiresAt],
    )
  })
}

export async function consumeAuthorizationAttempt(stateHash: string, sessionHash: string) {
  const result = await query<{ verifier_ciphertext: string }>(
    `DELETE FROM oauth_attempts AS attempt USING oauth_sessions AS session
     WHERE attempt.state_hash = $1 AND attempt.session_hash = $2
       AND attempt.session_hash = session.session_hash
       AND attempt.expires_at > now() AND session.expires_at > now()
     RETURNING attempt.verifier_ciphertext`,
    [stateHash, sessionHash],
  )
  return result.rows[0]?.verifier_ciphertext ?? null
}

export async function saveConnection(input: {
  sessionHash: string
  userId: string
  nickname: string | null
  scope: string | null
  accessTokenCiphertext: string
  refreshTokenCiphertext: string
  accessExpiresAt: Date
}) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO meli_connections (
         meli_user_id, nickname, scope, access_token_ciphertext,
         refresh_token_ciphertext, access_expires_at, refresh_issued_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (meli_user_id) DO UPDATE SET
         nickname = EXCLUDED.nickname,
         scope = EXCLUDED.scope,
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         access_expires_at = EXCLUDED.access_expires_at,
         refresh_issued_at = now(),
         status = 'connected',
         token_version = meli_connections.token_version + 1,
         connected_at = now(),
         updated_at = now()`,
      [
        input.userId, input.nickname, input.scope, input.accessTokenCiphertext,
        input.refreshTokenCiphertext, input.accessExpiresAt,
      ],
    )

    const session = await client.query(
      `UPDATE oauth_sessions SET meli_user_id = $2
       WHERE session_hash = $1 AND expires_at > now()
       RETURNING session_hash`,
      [input.sessionHash, input.userId],
    )
    if (session.rowCount !== 1) throw new Error('Sessão OAuth expirada')
  })
}

export async function getConnectionSummary(sessionHash: string): Promise<ConnectionSummary | null> {
  const result = await query<ConnectionSummary & QueryResultRow>(
    `SELECT connection.meli_user_id, connection.nickname,
            connection.access_expires_at, connection.refresh_issued_at, connection.status
     FROM oauth_sessions AS session
     JOIN meli_connections AS connection ON connection.meli_user_id = session.meli_user_id
     WHERE session.session_hash = $1 AND session.expires_at > now()`,
    [sessionHash],
  )
  return result.rows[0] ?? null
}

export async function withLockedConnection<T>(
  sessionHash: string,
  work: (client: PoolClient, connection: ConnectionRow) => Promise<T>,
): Promise<T | null> {
  return withTransaction(async (client) => {
    const result = await client.query<ConnectionRow>(
      `SELECT connection.* FROM oauth_sessions AS session
       JOIN meli_connections AS connection ON connection.meli_user_id = session.meli_user_id
       WHERE session.session_hash = $1 AND session.expires_at > now()
       FOR UPDATE OF connection`,
      [sessionHash],
    )
    const connection = result.rows[0]
    return connection ? work(client, connection) : null
  })
}

export async function replaceRefreshedTokens(client: PoolClient, input: {
  userId: string
  accessTokenCiphertext: string
  refreshTokenCiphertext: string
  accessExpiresAt: Date
  scope: string | null
}) {
  await client.query(
    `UPDATE meli_connections SET
       access_token_ciphertext = $2, refresh_token_ciphertext = $3,
       access_expires_at = $4, refresh_issued_at = now(), scope = $5,
       token_version = token_version + 1, updated_at = now()
     WHERE meli_user_id = $1`,
    [
      input.userId, input.accessTokenCiphertext, input.refreshTokenCiphertext,
      input.accessExpiresAt, input.scope,
    ],
  )
}

export async function markReauthorizationRequired(client: PoolClient, userId: string) {
  await client.query(
    `UPDATE meli_connections SET status = 'reauth_required', updated_at = now()
     WHERE meli_user_id = $1`,
    [userId],
  )
}
