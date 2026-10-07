import { extrairIdItem, validarLink } from '../src/lib/processarLinks.js'
import type { MercadoLivreItem } from './mercadoLivreApi.js'

const MAX_HTML_BYTES = 1_000_000

function decodeHtml(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? ''
    const code = entity[1]?.toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3])
  }
  return result
}

function safeImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

function safePermalink(value: string | undefined, itemId: string): string | null {
  if (!value || validarLink(value) || extrairIdItem(value) !== itemId) return null
  const url = new URL(value)
  if (url.protocol !== 'https:') return null
  url.search = ''
  url.hash = ''
  return extrairIdItem(url.href) === itemId ? url.href : null
}

function parsePage(html: string, pageUrl: string, itemId: string): MercadoLivreItem | null {
  const meta: Record<string, string> = {}
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag[0])
    const key = (attrs.property ?? attrs.name)?.toLowerCase()
    if (key && attrs.content) meta[key] = attrs.content
  }
  let canonical: string | undefined
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag[0])
    if (attrs.rel?.toLowerCase() === 'canonical') canonical = attrs.href
  }
  const permalink = safePermalink(meta['og:url'], itemId)
    ?? safePermalink(canonical, itemId)
    ?? safePermalink(pageUrl, itemId)
  if (!permalink) return null

  let product: Record<string, unknown> | null = null
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value: unknown = JSON.parse(script[1])
      const entries = Array.isArray(value) ? value : [value]
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue
        const row = entry as Record<string, unknown>
        const graph = Array.isArray(row['@graph']) ? row['@graph'] : [row]
        product = graph.find((node: unknown) => {
          if (typeof node !== 'object' || node === null) return false
          const type = (node as Record<string, unknown>)['@type']
          return type === 'Product' || (Array.isArray(type) && type.includes('Product'))
        }) as Record<string, unknown> | undefined ?? product
      }
    } catch { /* JSON-LD opcional */ }
  }
  const offers = product && typeof product.offers === 'object' && product.offers !== null
    ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) as Record<string, unknown> : null
  const rawPrice = meta['product:price:amount'] ?? meta['og:price:amount'] ?? offers?.price
  const preco = typeof rawPrice === 'number' ? rawPrice
    : typeof rawPrice === 'string' && /^\d+(?:[.,]\d{1,2})?$/.test(rawPrice)
      ? Number(rawPrice.replace(',', '.')) : NaN
  const titulo = meta['og:title'] ?? (typeof product?.name === 'string' ? product.name : '')
  if (!titulo.trim() || !Number.isFinite(preco) || preco < 0) return null
  const image = product?.image
  return {
    id: itemId,
    titulo: titulo.trim(),
    preco,
    moeda: meta['product:price:currency'] ?? meta['og:price:currency']
      ?? (typeof offers?.priceCurrency === 'string' ? offers.priceCurrency : null),
    imagemPrincipal: safeImage(meta['og:image']) ?? safeImage(Array.isArray(image) ? image[0] : image),
    permalink,
    status: null,
    quantidadeDisponivel: null,
  }
}

export async function getMercadoLivrePublico(link: string, itemId: string): Promise<MercadoLivreItem | null> {
  const original = safePermalink(link, itemId)
  const fallback = `https://produto.mercadolivre.com.br/MLB-${itemId.slice(3)}`
  let target = original ?? fallback
  try {
    for (let redirect = 0; redirect < 4; redirect++) {
      const response = await fetch(target, {
        headers: { accept: 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return null
        const next = new URL(location, target).href
        if (validarLink(next) || new URL(next).protocol !== 'https:') return null
        target = next
        continue
      }
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
      if (Number(response.headers.get('content-length')) > MAX_HTML_BYTES) return null
      const reader = response.body?.getReader()
      if (!reader) return null
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_HTML_BYTES) { await reader.cancel(); return null }
        chunks.push(value)
      }
      const html = new TextDecoder().decode(Buffer.concat(chunks))
      return parsePage(html, target, itemId)
    }
  } catch { /* página pública indisponível */ }
  return null
}
