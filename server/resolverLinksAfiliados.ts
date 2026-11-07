import { extrairProdutoHtml } from '../src/lib/extrairProdutoHtml.js'
import { extrairItemPrincipal, secaoEmDestaque, validarDestinoAfiliado } from './validarDestinoAfiliado.js'
import { extrairCardSocial } from './extrairCardSocial.js'

export type ResultadoLink = {
  linkOriginal: string; itemId: string | null; titulo: string | null; preco: number | null;
  moeda: string | null; imagem: string | null; urlProduto: string | null;
  productId: string | null; userProductId: string | null;
  status: 'novo' | 'ja_existe' | 'erro' | 'link_nao_validado'; erro: string | null
}

function urlSegura(valor: string): URL {
  const url = new URL(valor)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['meli.la', 'mercadolivre.com.br', 'www.mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(url.hostname)) {
    throw new Error('Destino não permitido.')
  }
  return url
}

export function validarMeliLa(link: string): void {
  if (link.length > 4096 || /\s/.test(link) || urlSegura(link).hostname !== 'meli.la' || !urlSegura(link).pathname.slice(1)) {
    throw new Error('Informe um link oficial https://meli.la/... válido.')
  }
}

export async function obterPaginaDestino(link: string, enviar: typeof fetch = fetch): Promise<{ html: string; url: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    let url = urlSegura(link)
    for (let salto = 0; salto < 6; salto++) {
      const resposta = await enviar(url.href, { redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'ValioGarimpo/1.0', Accept: 'text/html' } })
      if ([301, 302, 303, 307, 308].includes(resposta.status)) {
        const destino = resposta.headers.get('location')
        await resposta.body?.cancel()
        if (!destino) throw new Error('Link afiliado quebrado.')
        url = urlSegura(new URL(destino, url).href)
        continue
      }
      if (!resposta.ok || !resposta.headers.get('content-type')?.includes('text/html')) {
        await resposta.body?.cancel(); throw new Error('Link afiliado quebrado ou destino indisponível.')
      }
      const reader = resposta.body?.getReader()
      if (!reader) throw new Error('Página de destino vazia.')
      const partes: Uint8Array[] = []
      let tamanho = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        tamanho += value.byteLength
        if (tamanho > 2_000_000) { await reader.cancel(); throw new Error('Página de destino grande demais.') }
        partes.push(value)
      }
      const html = Buffer.concat(partes).toString('utf8')
      return { html, url: url.href }
    }
    throw new Error('Redirecionamentos demais no link afiliado.')
  } finally { clearTimeout(timer) }
}

function idAuxiliar(html: string, chave: string, prefixo: string): string | null {
  const encontrados = [...html.matchAll(new RegExp(`"${chave}"\\s*:\\s*"(${prefixo}\\d+)"`, 'gi'))].map((m) => m[1].toUpperCase())
  const unicos = [...new Set(encontrados)]
  return unicos.length === 1 ? unicos[0] : null
}

function urlNormal(html: string, pagina: string, itemId: string): string {
  const canonico = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /\brel\s*=\s*["']canonical["']/i.test(tag))
  const href = canonico && /\bhref\s*=\s*["']([^"']+)["']/i.exec(canonico)?.[1]
  if (href) {
    try {
      const url = urlSegura(new URL(href.replace(/&amp;/g, '&'), pagina).href)
      if (url.hostname !== 'meli.la' && new RegExp(`MLB-?${itemId.slice(3)}(?:\\D|$)`, 'i').test(url.href)) return url.href
    } catch { /* manter URL de destino validada */ }
  }
  return pagina
}

export async function resolverLinkAfiliado(linkOriginal: string, enviar: typeof fetch = fetch): Promise<ResultadoLink> {
  const base: ResultadoLink = { linkOriginal, itemId: null, titulo: null, preco: null, moeda: null,
    imagem: null, urlProduto: null, productId: null, userProductId: null, status: 'erro', erro: null }
  let origemId = 'não identificado'
  let fontesTentadas = 'URL, canonical e card destacado'
  let fontesPresentes: string[] = []
  try {
    validarMeliLa(linkOriginal)
    const pagina = await obterPaginaDestino(linkOriginal, enviar)
    fontesPresentes = [
      /<script\b[^>]*type=["']application\/ld\+json["']/i.test(pagina.html) ? 'JSON-LD' : '',
      /id=["']__NEXT_DATA__["']/i.test(pagina.html) ? '__NEXT_DATA__' : '',
      /id=["']__NORDIC_RENDERING_CTX__["']/i.test(pagina.html) ? 'Nordic' : '',
      /\brl-card-featured\b/.test(pagina.html) ? 'card destacado' : '',
    ].filter(Boolean)
    const itemId = extrairItemPrincipal(pagina.html, pagina.url)
    if (!itemId) return { ...base, status: 'link_nao_validado', erro: 'Destino sem ITEM_ID confiável ou com IDs divergentes.' }
    base.itemId = itemId
    base.urlProduto = pagina.url
    const social = new URL(pagina.url).pathname.startsWith('/social/')
    origemId = social ? 'card destacado: URL do link do anúncio' : 'URL de destino/canonical'
    await validarDestinoAfiliado(itemId, linkOriginal, 'importacao:meli-la', async () => itemId, () => {})
    if (social) {
      fontesTentadas = 'card destacado: link do título, preço atual Andes e imagem principal; JSON-LD/Next/Nordic inspecionados'
      const produto = extrairCardSocial(pagina.html, pagina.url, itemId)
      const bloco = secaoEmDestaque(pagina.html) ?? ''
      return { ...base, titulo: produto.titulo, preco: produto.preco, moeda: 'BRL', imagem: produto.imagem,
        urlProduto: produto.urlProduto, productId: idAuxiliar(bloco, 'productId', 'MLB'),
        userProductId: idAuxiliar(bloco, 'userProductId', 'MLBU'), status: 'novo' }
    }
    fontesTentadas = 'JSON-LD, __NEXT_DATA__, estado Nordic, scripts JSON e metadata estruturada'
    const urlTecnica = new URL(pagina.url)
    urlTecnica.searchParams.set('wid', itemId)
    const produto = extrairProdutoHtml(pagina.html, linkOriginal, urlTecnica.href, true)
    if (produto.itemId !== itemId) throw new Error('ITEM_ID divergente entre destino e dados do produto.')
    const moedas = [...pagina.html.matchAll(/"(?:priceCurrency|currency_id|currencyId)"\s*:\s*"([A-Z]{3})"/g)].map((m) => m[1])
    if (moedas.some((moeda) => moeda !== 'BRL')) throw new Error('Preço sem confirmação em BRL.')
    return { ...base, itemId, titulo: produto.titulo, preco: produto.precoAtual,
      moeda: produto.moeda, imagem: produto.imagemUrl, urlProduto: urlNormal(pagina.html, pagina.url, itemId),
      productId: idAuxiliar(pagina.html, 'productId', 'MLB'),
      userProductId: idAuxiliar(pagina.html, 'userProductId', 'MLBU'), status: 'novo' }
  } catch (erro) {
    if (base.itemId) console.info('[afiliado-extracao]', { itemId: base.itemId, origemId, fontesTentadas,
      fontesPresentes, resultado: 'ERRO_DADOS_PRODUTO' })
    return { ...base, erro: erro instanceof Error ? erro.message : 'Não foi possível resolver o link.' }
  }
}

export async function resolverLoteAfiliado(links: string[], consultar: (ids: string[]) => Promise<{ mercadoLivreId: string }[]>,
  enviar: typeof fetch = fetch): Promise<ResultadoLink[]> {
  const resultados: ResultadoLink[] = []
  for (let inicio = 0; inicio < links.length; inicio += 5) {
    resultados.push(...await Promise.all(links.slice(inicio, inicio + 5).map((link) => resolverLinkAfiliado(link, enviar))))
  }
  const ids = [...new Set(resultados.flatMap((r) => r.status === 'novo' && r.itemId ? [r.itemId] : []))]
  if (ids.length) {
    const existentes = new Set((await consultar(ids)).map((p) => p.mercadoLivreId))
    const vistos = new Set<string>()
    for (const resultado of resultados) {
      if (resultado.status !== 'novo' || !resultado.itemId) continue
      if (existentes.has(resultado.itemId) || vistos.has(resultado.itemId)) {
        resultado.status = 'ja_existe'
        resultado.erro = existentes.has(resultado.itemId) ? 'JÁ EXISTE no Valiô.' : 'ITEM_ID repetido neste lote.'
      }
      vistos.add(resultado.itemId)
    }
  }
  return resultados
}
