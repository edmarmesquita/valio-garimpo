import type { OfertaExtraida } from './extrairOfertas'

export function normalizarUrlIndividual(valor: unknown, itemId: string | null, origem = ''): string | null {
  if (typeof valor !== 'string' || !itemId) return null
  const texto = valor.trim().replace(/&amp;/g, '&')
  if (!texto || /\s/.test(texto)) return null
  try {
    const candidata = texto.startsWith('//') ? `https:${texto}`
      : texto.startsWith('/') ? new URL(texto, origem).href
        : /^https?:\/\//i.test(texto) ? texto : `https://${texto}`
    const url = new URL(candidata)
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['www.mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(url.hostname.toLowerCase())
      || /^\/ofertas(?:\/|$)/i.test(url.pathname)) return null
    const caminho = decodeURIComponent(url.pathname)
    if (/^\/ofertas(?:\/|$)/i.test(caminho)) return null
    const ids = [...caminho.matchAll(/\bMLB-?(\d+)\b/gi)].map((m) => `MLB${m[1]}`)
    const seletores: string[] = []
    const anunciosWid: string[] = []
    for (const params of [url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))]) {
      for (const [chave, valor] of params) {
        if (chave === 'wid' || chave === 'item_id') seletores.push(valor.toUpperCase())
        if (chave === 'wid') anunciosWid.push(valor.toUpperCase())
        if (chave === 'pdp_filters') {
          for (const match of valor.matchAll(/item_id:(MLB\d+)/gi)) seletores.push(match[1].toUpperCase())
        }
      }
    }
    if (seletores.some((id) => id !== itemId)) return null
    const catalogo = /\/p\/MLB\d+\/?$/i.test(caminho)
    // Formato real de user product: o MLBU identifica o produto; o wid
    // fornecido pelo HTML precisa identificar exatamente o anúncio selecionado.
    const produtoUsuario = /\/up\/MLBU\d+\/?$/i.test(caminho)
    const anuncio = /^\/MLB-?\d+(?:-|\/?$)/i.test(caminho)
    if (produtoUsuario) return anunciosWid.includes(itemId) && ids.every((id) => id === itemId) ? url.href : null
    if (!catalogo && !anuncio) return null
    if (!ids.length || (!catalogo && ids.some((id) => id !== itemId))) return null
    if (catalogo && ids.some((id) => id !== itemId) && !seletores.includes(itemId)) return null
    return url.href
  } catch { return null }
}

export function resolverUrlGerador(oferta: Pick<OfertaExtraida, 'urlOriginal' | 'itemId'>) {
  return { url: normalizarUrlIndividual(oferta.urlOriginal, oferta.itemId), fallback: false }
}
