import { Router } from 'express'
import { extrairIdItem, motivoLinkSemAnuncio } from '../src/lib/processarLinks.js'
import { getMercadoLivreConfig } from './mercadoLivreConfig.js'
import { assertEncryptionConfigured, hashOpaque } from './mercadoLivreCrypto.js'
import { getMercadoLivreItem, MercadoLivreApiError } from './mercadoLivreApi.js'
import { getBackendAccessToken } from './mercadoLivreTokenService.js'
import { getMercadoLivrePublico } from './mercadoLivrePublico.js'

const router = Router()

router.post('/produto', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const link = req.body?.link
  const itemId = typeof link === 'string' ? extrairIdItem(link.trim()) : null
  if (!itemId) {
    const motivo = typeof link === 'string' ? motivoLinkSemAnuncio(link.trim()) : 'Informe um link de anúncio do Mercado Livre.'
    res.status(400).json({ ok: false, error: `Link inválido: ${motivo}` })
    return
  }

  const sessionId = req.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('meli_oauth_session='))?.slice('meli_oauth_session='.length)
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
    res.status(401).json({ ok: false, error: 'Conecte sua conta do Mercado Livre para consultar o produto.' })
    return
  }

  try {
    const config = getMercadoLivreConfig()
    if (!config) throw new Error('Configuração OAuth ausente')
    assertEncryptionConfigured()
    const sessionHash = hashOpaque(sessionId)
    let accessToken = await getBackendAccessToken(sessionHash, config)
    if (!accessToken) {
      res.status(401).json({ ok: false, error: 'Conexão com o Mercado Livre ausente ou expirada. Reconecte sua conta.' })
      return
    }

    let produto
    try {
      produto = await getMercadoLivreItem(accessToken, itemId)
    } catch (error) {
      if (!(error instanceof MercadoLivreApiError) || error.kind !== 'unauthorized' || error.itemFailure?.providerStatus === 403) throw error
      accessToken = await getBackendAccessToken(sessionHash, config, accessToken)
      if (!accessToken) {
        res.status(401).json({ ok: false, error: 'Conexão expirada. Reconecte sua conta do Mercado Livre.' })
        return
      }
      produto = await getMercadoLivreItem(accessToken, itemId)
    }
    res.json({ ok: true, source: 'api', produto })
  } catch (error) {
    if (error instanceof MercadoLivreApiError && error.itemFailure?.providerStatus === 403) {
      const { produto, fallback } = await getMercadoLivrePublico(link.trim(), itemId)
      if (produto) {
        res.json({ ok: true, source: 'public-page-fallback', produto })
        return
      }
      res.status(502).json({ ok: false, error: 'A API do Mercado Livre bloqueou a consulta e não foi possível ler a página pública deste anúncio.', fallback })
      return
    }
    if (error instanceof MercadoLivreApiError && error.itemFailure) {
      res.status(error.kind === 'not_found' ? 404 : 502).json({
        ok: false,
        error: 'Mercado Livre indisponível.',
        ...error.itemFailure,
      })
      return
    }
    if (error instanceof MercadoLivreApiError) {
      res.status(error.kind === 'not_found' ? 404 : 502).json({
        ok: false,
        error: error.kind === 'not_found' ? 'Produto não encontrado no Mercado Livre.' : 'Mercado Livre indisponível. Tente novamente.',
      })
      return
    }
    res.status(503).json({ ok: false, error: 'Não foi possível acessar a conexão com o Mercado Livre.' })
  }
})

export default router
