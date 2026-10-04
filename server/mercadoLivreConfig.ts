export type MercadoLivreConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  secureCookie: boolean
}

export function getMercadoLivreConfig(): MercadoLivreConfig | null {
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
      url.search || url.hash || url.username || url.password
    ) return null

    return { clientId, clientSecret, redirectUri, secureCookie: url.protocol === 'https:' }
  } catch {
    return null
  }
}
