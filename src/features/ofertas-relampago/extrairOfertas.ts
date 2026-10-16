import { extrairProdutosAfiliados, type ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados.ts'
import { normalizarUrlProdutoLista } from '../importar-lista-afiliados/extrairListaAfiliados.ts'

type Registro = Record<string, unknown>
export type OfertaExtraida = {
  chave: string
  posicao: number
  itemId: string | null
  userProductId: string | null
  productId: string | null
  titulo: string | null
  imagem: string | null
  urlOriginal: string | null
  precoAtual: number | null
  precoAnterior: number | null
  percentualDesconto: number | null
  fonteDesconto: 'MERCADO LIVRE' | 'CALCULADO' | null
  textoOferta: string | null
  ofertaInicio: string | null
  ofertaFim: string | null
  tempoRestanteOriginal: string | null
  fonteTempo: string | null
  situacao: 'PRONTO' | 'SEM ITEM_ID' | 'SEM PREÇO' | 'REVISAR'
  dadosProduto: ProdutoAfiliado | null
}

const objeto = (valor: unknown): Registro | null => valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
const texto = (valor: unknown): string | null => typeof valor === 'string' && valor.trim() ? valor.trim() : null
const numero = (valor: unknown): number | null => typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null
const itemId = (valor: unknown): string | null => typeof valor === 'string' && /^MLB\d+$/.test(valor) ? valor : null
const timestamp = (valor: unknown): string | null => {
  const value = texto(valor)
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null
}

function jsonBalanceado(html: string, inicio: number): string | null {
  if (html[inicio] !== '{') return null
  let nivel = 0, aspas = false, escape = false
  for (let i = inicio; i < html.length; i++) {
    const char = html[i]
    if (aspas) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') aspas = false
    } else if (char === '"') aspas = true
    else if (char === '{') nivel++
    else if (char === '}' && --nivel === 0) return html.slice(inicio, i + 1)
  }
  return null
}

function dadosNordic(html: string): Registro {
  if (!html.trim() || html.length > 10_000_000) throw new Error('Cole um HTML de até 10 MB.')
  const script = /<script\b(?=[^>]*\bid=["']__NORDIC_RENDERING_CTX__["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html)
  if (!script) throw new Error('O HTML não contém o JSON estruturado das ofertas (__NORDIC_RENDERING_CTX__).')
  const atribuicao = /_n\.ctx\.r\s*=\s*(\{)/.exec(script[1])
  if (!atribuicao) throw new Error('O bloco de ofertas não contém um objeto JSON reconhecido.')
  const json = jsonBalanceado(script[1], atribuicao.index + atribuicao[0].length - 1)
  if (!json) throw new Error('O JSON de ofertas está incompleto.')
  let contexto: unknown
  try { contexto = JSON.parse(json) } catch { throw new Error('O JSON de ofertas é inválido.') }
  const dados = objeto(objeto(objeto(contexto)?.appProps)?.pageProps)?.data
  const registro = objeto(dados)
  if (!registro || !Array.isArray(registro.items)) throw new Error('Nenhuma lista estruturada de ofertas foi encontrada.')
  return registro
}

function componente(card: Registro, id: string): Registro | null {
  return Array.isArray(card.components) ? card.components.map(objeto).find((item) => item?.id === id) ?? null : null
}

function precoAnterior(preco: Registro | null): number | null {
  const labels = preco?.price_labels
  if (!Array.isArray(labels)) return null
  for (const label of labels) {
    const values = objeto(label)?.values
    if (!Array.isArray(values)) continue
    for (const value of values) {
      const dado = objeto(value)
      if (dado?.key === 'previous_price') return numero(objeto(dado.price)?.value)
    }
  }
  return null
}

function descontoInformado(preco: Registro | null): number | null {
  const values = objeto(preco?.discount_polylabel)?.values
  if (!Array.isArray(values)) return null
  for (const value of values) {
    const pill = texto(objeto(objeto(value)?.pill)?.text)
    const match = pill && /^(\d{1,3}(?:[.,]\d+)?)\s*%\s*OFF$/i.exec(pill)
    if (match) {
      const percent = Number(match[1].replace(',', '.'))
      if (percent > 0 && percent <= 100) return percent
    }
  }
  return null
}

function fimDoCard(card: Registro): string | null {
  if (!Array.isArray(card.widget_components)) return null
  const finais = card.widget_components.map(objeto)
    .filter((widget) => widget?.id === 'highlight')
    .map((widget) => timestamp(objeto(objeto(widget?.poly_label_component)?.countdown)?.period_end))
    .filter((fim): fim is string => fim !== null)
  return new Set(finais).size === 1 ? finais[0] : null
}

function idConflitante(metadata: Registro | null, id: string | null): boolean {
  if (!id) return false
  const params = texto(metadata?.url_params)
  const fragment = texto(metadata?.url_fragments)
  const filtro = params && /(?:^|[?&])pdp_filters=item_id(?:%3A|:)MLB(\d+)/i.exec(params)
  const wid = fragment && /(?:^|[?#&])wid=MLB(\d+)/i.exec(fragment)
  return Boolean((filtro && `MLB${filtro[1]}` !== id) || (wid && `MLB${wid[1]}` !== id))
}

function urlOriginalDoCard(item: Registro, card: Registro, metadata: Registro | null): string | null {
  const candidatas = [metadata?.url, metadata?.permalink, metadata?.canonical,
    card.url, card.permalink, card.canonical, item.url, item.permalink, item.canonical]
  for (const candidata of candidatas) {
    const valor = texto(candidata)?.replace(/\s+/g, '')
    if (!valor) continue
    const normalizada = normalizarUrlProdutoLista(valor.startsWith('//') ? `https:${valor}` : valor)
    if (normalizada) return normalizada
  }
  return null
}

export function extrairOfertasRelampagoHtml(html: string): OfertaExtraida[] {
  const data = dadosNordic(html)
  const contexto = data.polycardContext
  const vistos = new Set<string>()
  const ofertas: OfertaExtraida[] = []
  for (const [indice, item] of (data.items as unknown[]).entries()) {
    const registro = objeto(item)
    const card = objeto(registro?.card)
    if (!card) continue
    const metadata = objeto(card.metadata)
    const id = itemId(metadata?.id)
    if (id && vistos.has(id)) continue
    if (id) vistos.add(id)
    const extraido = extrairProdutosAfiliados({ polycard_context: contexto, items: [item] })[0] ?? null
    const price = objeto(componente(card, 'price_v2')?.price)
    const atual = numero(objeto(price?.current_price)?.value)
    const anterior = precoAnterior(price)
    const informado = descontoInformado(price)
    const calculado = informado === null && anterior !== null && atual !== null && anterior > atual
      ? Math.round((anterior - atual) / anterior * 100) : null
    const fim = fimDoCard(card)
    const destaque = componente(card, 'highlight')
    const textoOferta = texto(objeto(destaque?.highlight)?.text) ?? texto(destaque?.text)
    const posicao = typeof registro?.position === 'number' && Number.isSafeInteger(registro.position)
      ? registro.position : indice + 1
    ofertas.push({
      chave: id ?? `sem-id-${indice}`,
      posicao, itemId: id,
      userProductId: texto(metadata?.user_product_id), productId: texto(metadata?.product_id),
      titulo: extraido?.titulo ?? null, imagem: extraido?.imagemUrl ?? null,
      urlOriginal: registro ? urlOriginalDoCard(registro, card, metadata) : null,
      precoAtual: atual, precoAnterior: anterior,
      percentualDesconto: informado ?? calculado,
      fonteDesconto: informado !== null ? 'MERCADO LIVRE' : calculado !== null ? 'CALCULADO' : null,
      textoOferta, ofertaInicio: null, ofertaFim: fim,
      tempoRestanteOriginal: null, fonteTempo: fim ? 'card.widget_components.highlight.countdown.period_end' : null,
      situacao: !id ? 'SEM ITEM_ID' : idConflitante(metadata, id) ? 'REVISAR' : atual === null ? 'SEM PREÇO' : 'PRONTO',
      dadosProduto: extraido,
    })
  }
  return ofertas.sort((a, b) => a.posicao - b.posicao)
}
