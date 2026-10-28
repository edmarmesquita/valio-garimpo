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

function identidadeUrl(url: URL): string | null {
  const ids = idsUrl(url)
  return ids.size === 1 ? [...ids][0] : null
}

// Nunca procurar o primeiro MLB no documento: recomendações contêm outros anúncios.
export function extrairItemPrincipal(html: string, pagina: string): string | null {
  const url = urlPermitida(pagina)
  if (url.pathname.startsWith('/social/')) {
    const titulos = [...html.matchAll(/<meta\b[^>]*>/gi)].flatMap(([tag]) =>
      atributo(tag, 'property') === 'og:title' ? [decodificar(atributo(tag, 'content') ?? '')] : [])
    if (titulos.length !== 1 || !titulos[0]) return null
    const normalizar = (s: string) => decodificar(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
    const ids = new Set<string>()
    for (const [tag, conteudo] of [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[0].slice(0, m[0].indexOf('>') + 1), m[1]])) {
      if (normalizar(conteudo) !== normalizar(titulos[0])) continue
      const href = atributo(tag, 'href')
      if (!href) continue
      try {
        const destino = urlPermitida(new URL(decodificar(href), url).href)
        const id = identidadeUrl(destino)
        if (!id) return null
        ids.add(id)
      } catch { return null }
    }
    return ids.size === 1 ? [...ids][0] : null
  }
  const canonicos = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag)
    .filter((tag) => atributo(tag, 'rel') === 'canonical')
  if (canonicos.length !== 1) return null
  try {
    const href = atributo(canonicos[0], 'href')
    if (!href) return null
    const canonico = urlPermitida(new URL(decodificar(href), url).href)
    const id = identidadeUrl(canonico)
    const idsPagina = idsUrl(url)
    return id && (!idsPagina.size || idsPagina.size === 1 && idsPagina.has(id)) ? id : null
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
