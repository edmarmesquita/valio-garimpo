import { extrairIdUrlPagina } from '../src/lib/extrairProdutoHtml.js'
import { secaoEmDestaque } from './validarDestinoAfiliado.js'

export type DadosCardSocial = { titulo: string; preco: number; imagem: string; urlProduto: string }

function atributo(tag: string, nome: string): string | null {
  return new RegExp(`(?:\\s|^)${nome}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
}

function decodificar(texto: string): string {
  return texto.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([a-f0-9]+));/gi, (valor, decimal, hex) => {
    if (decimal || hex) {
      const codigo = parseInt(decimal || hex, decimal ? 10 : 16)
      return codigo <= 0x10ffff ? String.fromCodePoint(codigo) : ''
    }
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' } as Record<string, string>)[valor.toLowerCase()] ?? valor
  })
}

function unico<T>(valores: T[], campo: string): T | null {
  const distintos = [...new Set(valores)]
  if (distintos.length > 1) throw new Error(`Card destacado contém ${campo} conflitantes.`)
  return distintos[0] ?? null
}

function imagemPrincipal(bloco: string): string | null {
  const urls = [...bloco.matchAll(/<img\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass\s*=\s*(["'])[^"']*\bpoly-component__picture\b[^"']*\1/i.test(tag))
    .map(([tag]) => atributo(tag, 'src'))
    .filter((url): url is string => Boolean(url))
    .map((url) => { try {
      const parsed = new URL(decodificar(url))
      return parsed.protocol === 'https:' && parsed.hostname === 'http2.mlstatic.com' ? parsed.href : null
    } catch { return null } })
    .filter((url): url is string => Boolean(url))
  return unico(urls, 'imagens principais')
}

function itemIdLinkTitulo(url: URL): string {
  // O Mercado Livre pode colocar o ITEM_ID do anúncio em #...&wid=,
  // enquanto /p/MLB... identifica apenas o produto do catálogo.
  const fragmento = new URLSearchParams(url.hash.slice(1))
  const urlComIds = new URL(url.href)
  for (const [chave, valor] of fragmento) {
    if (['wid', 'item_id', 'itemid'].includes(chave.toLowerCase())) urlComIds.searchParams.append('wid', valor)
  }
  urlComIds.hash = ''
  return extrairIdUrlPagina(urlComIds.href)
}

export function extrairCardSocial(html: string, pagina: string, itemId: string): DadosCardSocial {
  const destaque = secaoEmDestaque(html)
  if (!destaque) throw new Error('ITEM_ID ok; card destacado único não encontrado na página social.')
  const links = [...destaque.matchAll(/<a\b[^>]*>[^<]*<\/a>/gi)]
    .filter(([tag]) => /\bclass\s*=\s*(["'])[^"']*\bpoly-component__title\b[^"']*\1/i.test(tag))
  const candidatos = links.map(([tag]) => {
    const href = atributo(tag, 'href')
    const titulo = decodificar(tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '')).trim()
    if (!href || !titulo) return null
    try {
      const url = new URL(decodificar(href), pagina)
      if (itemIdLinkTitulo(url) !== itemId) throw new Error('divergente')
      return { titulo, urlProduto: `${url.origin}${url.pathname}` }
    } catch { return null }
  }).filter((item): item is { titulo: string; urlProduto: string } => Boolean(item))
  if (links.length && candidatos.length !== links.length) throw new Error('ITEM_ID divergente no título do card destacado.')
  const titulo = unico(candidatos.map((item) => item.titulo), 'títulos')
  const urlProduto = unico(candidatos.map((item) => item.urlProduto), 'URLs de produto')
  if (!titulo || !urlProduto) throw new Error('ITEM_ID ok; título não encontrado no card destacado.')

  const precoAtual = /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bpoly-price__current\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i.exec(destaque)?.[2]
  // O bloco atual separa fração, centavos e símbolo de moeda em atributos específicos.
  const blocoPreco = precoAtual ?? ''
  const fracao = /<span\b[^>]*\bdata-andes-money-amount-fraction="true"[^>]*>(\d+)<\/span>/i.exec(blocoPreco)?.[1]
  const centavos = /<span\b[^>]*\bdata-andes-money-amount-cents="true"[^>]*>(\d{1,2})<\/span>/i.exec(blocoPreco)?.[1]
  const moeda = /<span\b[^>]*\bclass\s*=\s*(["'])[^"']*\bandes-money-amount__currency-symbol\b[^"']*\1[^>]*>([^<]+)<\/span>/i.exec(blocoPreco)?.[2]
  if (!fracao || !centavos || moeda?.trim() !== 'R$') throw new Error('ITEM_ID/título ok; preço atual estruturado em BRL ausente no card destacado.')
  const preco = Number(fracao) + Number(centavos.padEnd(2, '0')) / 100
  if (!Number.isSafeInteger(Number(fracao)) || !Number.isFinite(preco) || preco <= 0) throw new Error('Preço atual inválido no card destacado.')
  const imagem = imagemPrincipal(destaque)
  if (!imagem) throw new Error('ITEM_ID/título/preço ok; imagem principal estruturada ausente no card destacado.')
  return { titulo, preco, imagem, urlProduto }
}
