import { extrairIdItem } from '../src/lib/processarLinks.js'

export type ResolverDestino = (link: string) => Promise<string | null>
export type ValidarDestino = (itemId: string, link: string, origem: string) => Promise<void>

export class ErroDestinoAfiliado extends Error {
  readonly status = 422
}

function urlPermitida(valor: string): URL {
  const url = new URL(valor)
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['meli.la', 'www.mercadolivre.com.br', 'mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(url.hostname)) {
    throw new Error('Destino não permitido')
  }
  return url
}

function decodificar(valor: string): string {
  return valor.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([a-f0-9]+));/gi, (m, decimal, hex) => {
    if (decimal || hex) {
      const codigo = parseInt(decimal || hex, decimal ? 10 : 16)
      return codigo <= 0x10ffff ? String.fromCodePoint(codigo) : ''
    }
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' } as Record<string, string>)[m.toLowerCase()] ?? m
  })
}

function atributo(tag: string, nome: string): string | null {
  return new RegExp(`(?:\\s|^)${nome}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
}

function idsUrl(url: URL): Set<string> {
  const ids = new Set<string>()
  const caminho = new URL(url.href)
  caminho.search = ''; caminho.hash = ''
  const idCaminho = extrairIdItem(caminho.href)
  if (idCaminho) ids.add(idCaminho)
  for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) {
    for (const [chave, valor] of params) {
      if (['wid', 'item_id', 'itemid'].includes(chave.toLowerCase()) && /^MLB-?\d+$/i.test(valor)) ids.add(valor.replace('-', '').toUpperCase())
      if (chave === 'pdp_filters') {
        for (const m of valor.matchAll(/(?:^|[,;|])item_id:(MLB\d+)(?=$|[,;|])/gi)) ids.add(m[1].toUpperCase())
      }
    }
  }
  return ids
}

function secaoEmDestaque(html: string): string | null {
  const aberturas = [...html.matchAll(/<section\b[^>]*>/gi)]
    .filter(([tag]) => /(?:\s|^)class\s*=\s*(["'])[^"']*\brl-card-featured\b[^"']*\1/i.test(tag))
  if (aberturas.length !== 1) return null
  const inicio = aberturas[0].index!
  const tags = /<\/?section\b[^>]*>/gi
  tags.lastIndex = inicio
  let nivel = 0
  let tag: RegExpExecArray | null
  while ((tag = tags.exec(html)) !== null) {
    nivel += /^<\/section/i.test(tag[0]) ? -1 : 1
    if (nivel === 0) return html.slice(inicio, tags.lastIndex)
  }
  return null
}

function idsEstruturados(bloco: string): Set<string> {
  const ids = new Set<string>()
  for (const match of bloco.matchAll(/\bdata-(?:item-id|mercado-livre-id|wid)\s*=\s*(["'])(MLB-?\d+)\1/gi)) {
    ids.add(match[2].replace('-', '').toUpperCase())
  }
  for (const match of bloco.matchAll(/["']metadata["']\s*:\s*\{[^{}]{0,2000}?["']id["']\s*:\s*["'](MLB-?\d+)["']/gi)) {
    ids.add(match[1].replace('-', '').toUpperCase())
  }
  for (const match of bloco.matchAll(/["'](?:itemId|item_id|mercado_livre_id|wid)["']\s*:\s*["'](MLB-?\d+)["']/gi)) {
    ids.add(match[1].replace('-', '').toUpperCase())
  }
  return ids
}

// O anúncio principal fica na seção destacada. IDs das recomendações fora dela não são prova.
export function extrairItemPrincipal(html: string, pagina: string): string | null {
  const url = urlPermitida(pagina)
  if (url.pathname.startsWith('/social/')) {
    const destaque = secaoEmDestaque(html)
    if (!destaque) return null
    const ids = idsEstruturados(destaque)
    const userProducts = new Set<string>()
    for (const [tag] of destaque.matchAll(/<a\b[^>]*>/gi)) {
      const href = atributo(tag, 'href')
      if (!href) continue
      try {
        const destino = urlPermitida(new URL(decodificar(href), url).href)
        const idsLink = idsUrl(destino)
        for (const id of idsLink) ids.add(id)
        const userProduct = /\/up\/(MLBU\d+)(?:\/|$)/i.exec(destino.pathname)?.[1]
        if (userProduct && idsLink.size) userProducts.add(userProduct.toUpperCase())
      } catch { /* link auxiliar não identifica produto */ }
    }
    for (const match of destaque.matchAll(/["'](?:userProductId|user_product_id|productId|product_id)["']\s*:\s*["'](MLBU\d+)["']/gi)) {
      userProducts.add(match[1].toUpperCase())
    }
    return ids.size === 1 && userProducts.size <= 1 ? [...ids][0] : null
  }
  const idsPagina = idsUrl(url)
  if (idsPagina.size > 1) return null
  const canonicos = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag)
    .filter((tag) => atributo(tag, 'rel') === 'canonical')
  if (canonicos.length > 1) return null
  if (!canonicos.length) return idsPagina.size === 1 ? [...idsPagina][0] : null
  try {
    const href = atributo(canonicos[0], 'href')
    if (!href) return null
    const canonico = urlPermitida(new URL(decodificar(href), url).href)
    const idsCanonicos = idsUrl(canonico)
    if (idsCanonicos.size > 1) return null
    const ids = new Set([...idsPagina, ...idsCanonicos])
    return ids.size === 1 ? [...ids][0] : null
  } catch { return null }
}

export async function resolverItemId(link: string, enviar: typeof fetch = fetch): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    let url = urlPermitida(link)
    for (let salto = 0; salto < 6; salto++) {
      const resposta = await enviar(url.href, { redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'ValioMaintenance/1.0', Accept: 'text/html' } })
      if ([301, 302, 303, 307, 308].includes(resposta.status)) {
        const destino = resposta.headers.get('location')
        await resposta.body?.cancel()
        if (!destino) return null
        url = urlPermitida(new URL(destino, url).href)
        continue
      }
      if (!resposta.ok || !resposta.headers.get('content-type')?.includes('text/html')) {
        await resposta.body?.cancel(); return null
      }
      const reader = resposta.body?.getReader()
      if (!reader) return null
      const partes: Uint8Array[] = []
      let tamanho = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        tamanho += value.byteLength
        if (tamanho > 2_000_000) { await reader.cancel(); return null }
        partes.push(value)
      }
      return extrairItemPrincipal(Buffer.concat(partes).toString('utf8'), url.href)
    }
    return null
  } catch { return null }
  finally { clearTimeout(timer) }
}

export async function validarDestinoAfiliado(itemId: string, link: string, origem: string,
  resolver: ResolverDestino = resolverItemId,
  registrar: (evento: Record<string, unknown>) => void = (evento) => console.info('[afiliado-validacao]', evento)): Promise<void> {
  let resolvido: string | null = null
  try { resolvido = await resolver(link) } catch { /* falha fechada */ }
  if (resolvido && !/^MLB\d+$/.test(resolvido)) resolvido = null
  const resultado = !resolvido ? 'NAO_VALIDADO' : resolvido === itemId ? 'COMPATIVEL' : 'INCOMPATIVEL'
  // ref/query/hash podem conter tokens. Apenas meli.la simples é registrado integralmente.
  let linkSeguro = '[URL inválida]'
  try {
    const url = urlPermitida(link)
    linkSeguro = url.origin + url.pathname
  } catch { /* não registrar credenciais ou entrada arbitrária */ }
  registrar({ itemId, linkAfiliadoRecebido: linkSeguro, origem, itemIdResolvido: resolvido, resultado,
    timestamp: new Date().toISOString() })
  if (resultado === 'INCOMPATIVEL') throw new ErroDestinoAfiliado(`Link afiliado incompatível: este link pertence ao ITEM_ID ${resolvido}, mas o produto atual é ${itemId}.`)
  if (resultado === 'NAO_VALIDADO') throw new ErroDestinoAfiliado('Link afiliado não validado: não foi possível comprovar o ITEM_ID do destino. Confira o link e solicite nova validação antes de publicar.')
}
