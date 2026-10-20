import { extrairProdutosAfiliados, type ProdutoAfiliado } from './extrairProdutosAfiliados'
import { dadosNordic } from '../features/ofertas-relampago/extrairOfertas'

type Registro = Record<string, unknown>
const objeto = (valor: unknown): Registro | null => valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
const preco = (valor: unknown): number | null => typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null
const idValido = (valor: unknown): valor is string => typeof valor === 'string' && /^MLB\d+$/.test(valor)

export type ExtracaoPrecosHtml = {
  encontrados: number
  produtos: ProdutoAfiliado[]
  problemas: Map<string, string>
  urls: Map<string, string>
  semId: number
}

function componentes(card: Registro, nome: string): Registro[] {
  return Array.isArray(card.components) ? card.components.map(objeto).filter((item): item is Registro => item?.id === nome) : []
}

function valoresAnteriores(price: Registro): number[] {
  const valores = [preco(objeto(price.previous_price)?.value)]
  if (Array.isArray(price.price_labels)) for (const label of price.price_labels) {
    const itens = objeto(label)?.values
    if (Array.isArray(itens)) for (const item of itens) {
      const dado = objeto(item)
      if (dado?.key === 'previous_price') valores.push(preco(objeto(dado.price)?.value))
    }
  }
  return valores.filter((valor): valor is number => valor !== null)
}

function descontoInformado(price: Registro): string | null {
  const direto = objeto(price.discount_label)?.text
  if (typeof direto === 'string' && /\d+(?:[.,]\d+)?\s*%/.test(direto)) return direto
  const valores = objeto(price.discount_polylabel)?.values
  if (Array.isArray(valores)) for (const item of valores) {
    const texto = objeto(objeto(item)?.pill)?.text
    if (typeof texto === 'string' && /\d+(?:[.,]\d+)?\s*%/.test(texto)) return texto
  }
  return null
}

function idsDeApoio(valores: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const valor of valores) {
    if (typeof valor !== 'string') continue
    let texto = valor
    try { texto = decodeURIComponent(valor) } catch { /* usa o valor original */ }
    for (const match of texto.matchAll(/(?:item_id[:=]|wid=)(MLB\d+)/gi)) ids.add(match[1].toUpperCase())
    for (const match of texto.matchAll(/\/MLB-(\d+)(?:-|\/|\b)/gi)) ids.add(`MLB${match[1]}`)
  }
  return ids
}

function dadosJsonLd(html: string): Registro {
  const items: Registro[] = []
  for (const script of html.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let parsed: unknown
    try { parsed = JSON.parse(script[1]) } catch { continue }
    const pilha: unknown[] = [parsed]
    while (pilha.length) {
      const valor = pilha.pop()
      if (Array.isArray(valor)) { pilha.push(...valor); continue }
      const produto = objeto(valor)
      if (!produto) continue
      if (produto['@graph']) pilha.push(produto['@graph'])
      if (produto.itemListElement) pilha.push(produto.itemListElement)
      if (produto.item) pilha.push(produto.item)
      if (produto['@type'] !== 'Product' || !idValido(produto.sku)) continue
      const ofertas = Array.isArray(produto.offers) ? produto.offers : [produto.offers]
      const components = ofertas.map(objeto).filter((item): item is Registro => item !== null).map((oferta) => {
        const valor = typeof oferta.price === 'string' && /^\d+(?:\.\d{1,2})?$/.test(oferta.price)
          ? Number(oferta.price) : oferta.price
        return { id: 'price_v2', price: { current_price: { value: oferta.priceCurrency === 'BRL' ? valor : null } } }
      })
      items.push({ card: { unique_id: produto.sku, metadata: { id: produto.sku, url: produto.url },
        pictures: { pictures: [] }, components: [{ id: 'title', title: { text: produto.name } }, ...components] } })
    }
  }
  if (!items.length) throw new Error('O HTML não contém cards Nordic nem produtos JSON-LD com ITEM_ID explícito.')
  return { items, polycardContext: {} }
}

export function extrairPrecosHtml(html: string, origem = ''): ExtracaoPrecosHtml {
  if (!html.trim() || html.length > 10_000_000) throw new Error('Cole um HTML de até 10 MB.')
  const dados = /<script\b(?=[^>]*\bid=["']__NORDIC_RENDERING_CTX__["'])/i.test(html) ? dadosNordic(html) : dadosJsonLd(html)
  const produtos = new Map<string, ProdutoAfiliado>()
  const problemas = new Map<string, string>()
  const urls = new Map<string, string>()
  let encontrados = 0, semId = 0
  for (const item of dados.items as unknown[]) {
    const registro = objeto(item)
    const card = objeto(registro?.card)
    if (!card) continue
    encontrados++
    const metadata = objeto(card.metadata)
    const id = metadata?.id
    if (!idValido(id)) { semId++; continue }
    const urlBruta = [metadata?.url, metadata?.permalink, card.href, card.url, registro?.href, registro?.url]
      .find((valor): valor is string => typeof valor === 'string' && valor.trim().length > 0)
    if (urlBruta) {
      try {
        const url = new URL(urlBruta, origem || 'https://www.mercadolivre.com.br/')
        if (url.protocol === 'https:' && /(^|\.)mercadolivre\.com\.br$/.test(url.hostname)) urls.set(id, url.href)
      } catch { /* URL apenas diagnóstica */ }
    }
    const base = extrairProdutosAfiliados({ polycard_context: dados.polycardContext, items: [item] })[0]
    const atuais: number[] = []
    const anteriores: number[] = []
    const descontos: string[] = []
    let camposAtuais = 0
    for (const componente of [...componentes(card, 'price_v2'), ...componentes(card, 'price')]) {
      const price = objeto(componente.price) ?? componente
      if ('current_price' in price) {
        camposAtuais++
        const valor = preco(objeto(price.current_price)?.value)
        if (valor !== null) atuais.push(valor)
      }
      anteriores.push(...valoresAnteriores(price))
      const desconto = descontoInformado(price)
      if (desconto) descontos.push(desconto)
    }
    const auxiliares = idsDeApoio([metadata?.url_params, metadata?.url_fragments, metadata?.url,
      metadata?.permalink, card.href, card.url, registro?.href, registro?.url])
    let motivo: string | null = null
    if ([...auxiliares].some((outro) => outro !== id)) motivo = 'ITEM_ID conflitante entre metadata e URL do card.'
    else if (!camposAtuais || !atuais.length) motivo = 'PREÇO NÃO CONFIÁVEL: preço atual estruturado ausente.'
    else if (atuais.length !== camposAtuais || new Set(atuais.map((valor) => Math.round(valor * 100))).size !== 1)
      motivo = 'PREÇO NÃO CONFIÁVEL: valores atuais ambíguos no mesmo card.'
    else if (new Set(anteriores.map((valor) => Math.round(valor * 100))).size > 1)
      motivo = 'PREÇO NÃO CONFIÁVEL: preços anteriores conflitantes.'
    else if (new Set(descontos).size > 1) motivo = 'PREÇO NÃO CONFIÁVEL: descontos informados conflitantes.'
    const extraido: ProdutoAfiliado = { ...base,
      itemId: id, productId: base?.productId ?? null, userProductId: base?.userProductId ?? null,
      variationId: base?.variationId ?? null, titulo: base?.titulo ?? null,
      precoAtual: motivo ? null : atuais[0], precoAnterior: anteriores[0] ?? null,
      moeda: base?.moeda ?? null, desconto: descontos[0] ?? base?.desconto ?? null,
      parcelas: base?.parcelas ?? null, valorParcela: base?.valorParcela ?? null,
      semJuros: base?.semJuros ?? null, avaliacao: null, vendidosTexto: null,
      comissaoTexto: null, comissaoPercentual: null, destaque: null,
      imagemId: null, imagemUrl: null, linkOriginal: null,
      extraCommission: null, brandCommission: null, tipoOrigem: null,
    }
    const anterior = produtos.get(id)
    if (anterior && (anterior.precoAtual !== extraido.precoAtual || problemas.has(id) || motivo))
      motivo = 'PREÇO NÃO CONFIÁVEL: ITEM_ID repetido com preços ou dados conflitantes no mesmo HTML.'
    if (motivo) { extraido.precoAtual = null; problemas.set(id, motivo) }
    produtos.set(id, extraido)
  }
  return { encontrados, produtos: [...produtos.values()], problemas, urls, semId }
}
