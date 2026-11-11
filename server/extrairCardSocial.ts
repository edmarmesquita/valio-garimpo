import { extrairIdUrlPagina } from '../src/lib/extrairProdutoHtml.js'
import { secaoEmDestaque } from './validarDestinoAfiliado.js'

export type DadosCardSocial = { titulo: string; preco: number | null; imagem: string; urlProduto: string }

function atributo(tag: string, nome: string): string | null {
  return new RegExp(`(?:\\s|^)${nome}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
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
  if (distintos.length > 1) throw new Error(`Card destacado cont\u00e9m ${campo} conflitantes.`)
  return distintos[0] ?? null
}

function imagemPrincipal(bloco: string): string | null {
  const urls = [...bloco.matchAll(/<img\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass\s*=\s*(['"])[^'"]*\bpoly-component__picture\b[^'"]*\1/i.test(tag))
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
  // The listing ITEM_ID can be in #...&wid=; /p/MLB... is a catalog ID.
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
  if (!destaque) throw new Error('ITEM_ID ok; card destacado \u00fanico n\u00e3o encontrado na p\u00e1gina social.')
  const links = [...destaque.matchAll(/<a\b[^>]*>[^<]*<\/a>/gi)]
    .filter(([tag]) => /\bclass\s*=\s*(['"])[^'"]*\bpoly-component__title\b[^'"]*\1/i.test(tag))
  const candidatos = links.map(([tag]) => {
    const href = atributo(tag, 'href')
    const titulo = decodificar(tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '')).trim()
    if (!href || !titulo) return null
    try {
      const url = new URL(decodificar(href), pagina)
      if (itemIdLinkTitulo(url) !== itemId) throw new Error('divergent')
      const urlProduto = new URL(`${url.origin}${url.pathname}`)
      urlProduto.searchParams.set('wid', itemId)
      return { titulo, urlProduto: urlProduto.href }
    } catch { return null }
  }).filter((item): item is { titulo: string; urlProduto: string } => Boolean(item))
  if (links.length && candidatos.length !== links.length) throw new Error('ITEM_ID divergente no t\u00edtulo do card destacado.')
  const titulo = unico(candidatos.map((item) => item.titulo), 't\u00edtulos')
  const urlProduto = unico(candidatos.map((item) => item.urlProduto), 'URLs de produto')
  if (!titulo || !urlProduto) throw new Error('ITEM_ID ok; t\u00edtulo n\u00e3o encontrado no card destacado.')

  const precoAtual = /<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bpoly-price__current\b[^'"]*\1[^>]*>([\s\S]*?)<\/div>/i.exec(destaque)?.[2]
  const blocoPreco = precoAtual ?? ''
  const fracao = /<span\b[^>]*\bdata-andes-money-amount-fraction="true"[^>]*>(\d+)<\/span>/i.exec(blocoPreco)?.[1]
  const centavos = /<span\b[^>]*\bdata-andes-money-amount-cents="true"[^>]*>(\d{1,2})<\/span>/i.exec(blocoPreco)?.[1]
  const temCentavos = /\bdata-andes-money-amount-cents\b/i.test(blocoPreco)
  const moeda = /<span\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bandes-money-amount__currency-symbol\b[^'"]*\1[^>]*>([^<]+)<\/span>/i.exec(blocoPreco)?.[2]
  if (precoAtual && (!fracao || (temCentavos && !centavos) || moeda?.trim() !== 'R$')) {
    throw new Error('Pre\u00e7o atual estruturado em BRL inv\u00e1lido no card destacado.')
  }
  let preco: number | null = null
  if (fracao) preco = Number(fracao) + Number((centavos ?? '0').padEnd(2, '0')) / 100
  if (preco !== null && (!Number.isSafeInteger(Number(fracao)) || !Number.isFinite(preco) || preco <= 0)) {
    throw new Error('Pre\u00e7o atual inv\u00e1lido no card destacado.')
  }
  const imagem = imagemPrincipal(destaque)
  if (!imagem) throw new Error('ITEM_ID/t\u00edtulo/pre\u00e7o ok; imagem principal estruturada ausente no card destacado.')
  return { titulo, preco, imagem, urlProduto }
}
