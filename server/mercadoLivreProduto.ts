import { Router } from 'express'
import { extrairIdItem, extrairIdProdutoCatalogo, motivoLinkSemAnuncio } from '../src/lib/processarLinks.js'
import { getMercadoLivreConfig } from './mercadoLivreConfig.js'
import { assertEncryptionConfigured, hashOpaque } from './mercadoLivreCrypto.js'
import { getMercadoLivreCatalogProduct, getMercadoLivreItem, MercadoLivreApiError } from './mercadoLivreApi.js'
import { getBackendAccessToken } from './mercadoLivreTokenService.js'

const router = Router()

router.post('/produto', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const link = req.body?.link
  const itemId = typeof link === 'string' ? extrairIdItem(link.trim()) : null
  const catalogProductId = typeof link === 'string' ? extrairIdProdutoCatalogo(link.trim()) : null
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

  let accessToken: string | null = null
  try {
    const config = getMercadoLivreConfig()
    if (!config) throw new Error('Configuração OAuth ausente')
    assertEncryptionConfigured()
    const sessionHash = hashOpaque(sessionId)
    accessToken = await getBackendAccessToken(sessionHash, config)
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
    res.json({ ok: true, source: 'api-item', produto: { ...produto, permalink: link.trim(), originalUrl: link.trim() } })
  } catch (error) {
    if (error instanceof MercadoLivreApiError && error.itemFailure?.providerStatus === 403) {
      if (catalogProductId) {
        try {
          if (!accessToken) {
            res.status(401).json({ ok: false, error: 'Conexão expirada. Reconecte sua conta do Mercado Livre.' })
            return
          }
          const produto = await getMercadoLivreCatalogProduct(accessToken, catalogProductId, itemId, link.trim())
          res.json({ ok: true, source: 'api-catalog', catalogProductId, itemId, originalUrl: link.trim(), produto })
          return
        } catch {
          res.status(502).json({ ok: false, error: 'Não foi possível consultar o produto no catálogo do Mercado Livre.' })
          return
        }
      }
      res.status(502).json({ ok: false, error: 'O Mercado Livre bloqueou a consulta do anúncio e o link não contém ID de catálogo.' })
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
