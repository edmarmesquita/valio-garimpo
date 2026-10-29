import { lerEstadoNordic } from './lerEstadoNordic'

type Registro = Record<string, unknown>
export type ProdutoPaginaOfertas = {
  itemId: string
  titulo: string
  preco: number
  moeda: string
  productId: string | null
  userProductId: string | null
  url: string | null
  origem: string
}
export type ExtracaoPaginaOfertas = {
  produtos: ProdutoPaginaOfertas[]
  cardsBrutos: number
  semItemId: number
  semTitulo: number
  semPreco: number
  widDivergente: number
  pagina: { page: number | null; offset: number | null; limit: number | null; total: number | null }
}

const objeto = (valor: unknown): Registro | null => valor !== null && typeof valor === 'object' && !Array.isArray(valor)
  ? valor as Registro : null
const texto = (valor: unknown): string | null => typeof valor === 'string' && valor.trim() ? valor.trim() : null
const idItem = (valor: unknown): string | null => typeof valor === 'string' && /^MLB\d+$/.test(valor) ? valor : null
const idProduct = (valor: unknown): string | null => typeof valor === 'string' && /^MLB\d+$/.test(valor) ? valor : null
const idUserProduct = (valor: unknown): string | null => typeof valor === 'string' && /^MLBU\d+$/.test(valor) ? valor : null
const numeroPositivo = (valor: unknown): number | null => typeof valor === 'number' && Number.isFinite(valor)
  && valor > 0 && Number.isSafeInteger(Math.round(valor * 100)) ? valor : null

function componente(card: Registro, id: string): Registro[] {
  return Array.isArray(card.components) ? card.components.map(objeto).filter((item): item is Registro => item?.id === id) : []
}

function idsWid(valores: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const valor of valores) {
    if (typeof valor !== 'string') continue
    let descodificado = valor
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try { descodificado = decodeURIComponent(descodificado) } catch { break }
    }
    for (const match of descodificado.matchAll(/(?:^|[?&#])wid=(MLB\d+)(?=$|[&#])/gi)) ids.add(match[1].toUpperCase())
  }
  return ids
}

function urlProduto(valores: unknown[]): string | null {
  for (const valor of valores) {
    const entrada = texto(valor)
    if (!entrada) continue
    try {
      const url = new URL(entrada.startsWith('//') ? `https:${entrada}`
        : /^https?:\/\//i.test(entrada) ? entrada : `https://${entrada}`)
      if (url.protocol !== 'https:' || !/(^|\.)mercadolivre\.com\.br$/i.test(url.hostname)
        || url.username || url.password || url.port) continue
      return `${url.origin}${url.pathname}`
    } catch { /* tenta a próxima URL técnica */ }
  }
  return null
}

function pagina(data: Registro): ExtracaoPaginaOfertas['pagina'] {
  const paging = objeto(data.paging)
  const inteiro = (valor: unknown) => typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0 ? valor : null
  return { page: inteiro(data.page), offset: inteiro(paging?.offset), limit: inteiro(data.limit ?? paging?.limit),
    total: inteiro(paging?.total) }
}

/** Extrai vitrines públicas, incluindo Outlet, pela estrutura Nordic e não pelo nome da página. */
export function extrairProdutosPaginaOfertas(html: string, origem: string): ExtracaoPaginaOfertas {
  const estado = lerEstadoNordic(html)
  const appProps = objeto(estado.appProps)
  const pageProps = objeto(appProps?.pageProps)
  const data = objeto(pageProps?.data)
  if (!data || !Array.isArray(data.items)) throw new Error('O estado Nordic não contém data.items de uma página de produtos.')

  const resultado: ExtracaoPaginaOfertas = {
    produtos: [], cardsBrutos: 0, semItemId: 0, semTitulo: 0, semPreco: 0, widDivergente: 0,
    pagina: pagina(data),
  }
  for (const itemValor of data.items) {
    const item = objeto(itemValor)
    const card = objeto(item?.card)
    if (!card) continue
    resultado.cardsBrutos++
    const metadata = objeto(card.metadata)
    const id = idItem(metadata?.id)
    if (!id) { resultado.semItemId++; continue }

    const wid = idsWid([metadata?.url_params, metadata?.url_fragments, metadata?.url, metadata?.permalink,
      card.href, card.url, item?.href, item?.url])
    if ([...wid].some((outro) => outro !== id)) { resultado.widDivergente++; continue }

    const titulos = componente(card, 'title').map((part) => texto(objeto(part.title)?.text)).filter((value): value is string => value !== null)
    if (!titulos.length || new Set(titulos).size !== 1) { resultado.semTitulo++; continue }

    const componentesPreco = [...componente(card, 'price_v2'), ...componente(card, 'price')]
    const precos: number[] = []
    const moedas: string[] = []
    let currentFields = 0
    for (const part of componentesPreco) {
      const price = objeto(part.price) ?? part
      if (!('current_price' in price)) continue
      currentFields++
      const atual = objeto(price.current_price)
      const valor = numeroPositivo(atual?.value)
      if (valor !== null) precos.push(valor)
      if (typeof atual?.currency === 'string') moedas.push(atual.currency.toUpperCase())
    }
    if (!currentFields || precos.length !== currentFields || moedas.length !== currentFields
      || moedas.some((moeda) => moeda !== 'BRL')
      || new Set(precos.map((valor) => Math.round(valor * 100))).size !== 1) {
      resultado.semPreco++
      continue
    }

    resultado.produtos.push({ itemId: id, titulo: titulos[0], preco: precos[0], moeda: 'BRL',
      productId: idProduct(metadata?.product_id), userProductId: idUserProduct(metadata?.user_product_id),
      url: urlProduto([metadata?.url, metadata?.permalink, card.href, card.url, item?.url, item?.href]), origem })
  }
  return resultado
}
