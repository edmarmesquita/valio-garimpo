import type { MercadoLivreConfig } from './mercadoLivreConfig.js'
import { decryptSecret, encryptSecret } from './mercadoLivreCrypto.js'
import { MercadoLivreApiError, refreshTokens } from './mercadoLivreApi.js'
import {
  getConnectionSummary, markReauthorizationRequired, replaceRefreshedTokens,
  withLockedConnection,
} from './mercadoLivreRepository.js'

const REFRESH_BEFORE_MS = 60_000

export type SafeConnectionStatus = {
  connected: boolean
  requiresReconnect?: boolean
  account?: { id: string; nickname: string | null }
}

export async function connectionStatus(sessionHash: string, config: MercadoLivreConfig): Promise<SafeConnectionStatus> {
  const summary = await getConnectionSummary(sessionHash)
  if (!summary) return { connected: false }
  if (summary.status === 'reauth_required') return { connected: false, requiresReconnect: true }

  if (new Date(summary.access_expires_at).getTime() > Date.now() + REFRESH_BEFORE_MS) {
    return { connected: true, account: { id: summary.meli_user_id, nickname: summary.nickname } }
  }

  const refreshed = await withLockedConnection(sessionHash, async (client, connection): Promise<SafeConnectionStatus> => {
    if (connection.status === 'reauth_required') return { connected: false, requiresReconnect: true }
    if (new Date(connection.access_expires_at).getTime() > Date.now() + REFRESH_BEFORE_MS) {
      return { connected: true, account: { id: connection.meli_user_id, nickname: connection.nickname } }
    }

    const oldRefreshToken = decryptSecret(connection.refresh_token_ciphertext, `refresh:${connection.meli_user_id}`)
    let tokens
    try {
      tokens = await refreshTokens(config, oldRefreshToken)
    } catch (error) {
      if (error instanceof MercadoLivreApiError && error.kind === 'invalid_grant') {
        await markReauthorizationRequired(client, connection.meli_user_id)
        return { connected: false, requiresReconnect: true }
      }
      throw error
    }

    if (tokens.userId && tokens.userId !== connection.meli_user_id) {
      await markReauthorizationRequired(client, connection.meli_user_id)
      return { connected: false, requiresReconnect: true }
    }

    await replaceRefreshedTokens(client, {
      userId: connection.meli_user_id,
      accessTokenCiphertext: encryptSecret(tokens.accessToken, `access:${connection.meli_user_id}`),
      refreshTokenCiphertext: encryptSecret(tokens.refreshToken, `refresh:${connection.meli_user_id}`),
      accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      scope: tokens.scope ?? connection.scope,
    })
    return { connected: true, account: { id: connection.meli_user_id, nickname: connection.nickname } }
  })

  return refreshed ?? { connected: false }
}
