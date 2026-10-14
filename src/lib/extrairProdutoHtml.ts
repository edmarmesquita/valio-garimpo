import type { ProdutoAfiliado } from './extrairProdutosAfiliados'

export const LIMITE_HTML_PRODUTO = 10_000_000
type Registro = Record<string, unknown>
type Candidato = { id: string | null; titulo: string | null; preco: number | null; imagem: string | null; rating: number | null; schema: boolean; principal: boolean; secundario: boolean }
const secundarias = /recommend|related|bookmark|suggest|carousel|polycard|similar|vitrine|sponsor/i
const chavesPdp = /^(?:product|pdp|productData|pdpData|pdpState)$/i

function objeto(valor: unknown): Registro | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
}
function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}
function id(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const direto = /^MLB-?(\d+)$/i.exec(valor.trim())
  if (direto) return `MLB${direto[1]}`
  try {
    const url = new URL(valor)
    const parametro = url.searchParams.get('item_id') ?? url.searchParams.get('wid')
    if (parametro) return id(parametro)
    const caminho = /(?:^|[/-])MLB-?(\d+)(?:[-/?#]|$)/i.exec(url.pathname)
    return caminho ? `MLB${caminho[1]}` : null
  } catch { return null }
}
function imagemHttps(valor: unknown): string | null {
  if (Array.isArray(valor)) return valor.map(imagemHttps).find(Boolean) ?? null
  const candidato = texto(valor) ?? texto(objeto(valor)?.secure_url) ?? texto(objeto(valor)?.url)
  if (!candidato) return null
  try {
    const url = new URL(candidato)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}
function preco(valor: unknown): number | null {
  const dado = objeto(valor)
  if (dado) {
    const composto = objeto(objeto(dado.current_value)?.value) ?? objeto(dado.value)
    if (composto && /^\d+$/.test(String(composto.fraction)) && /^\d{1,2}$/.test(String(composto.cents))) {
      const inteiro = Number(composto.fraction)
      const centavos = Number(composto.cents)
      if (Number.isSafeInteger(inteiro) && centavos < 100) return inteiro + centavos / 100
    }
    for (const chave of ['current_value', 'value', 'amount', 'price']) {
      const extraido = preco(dado[chave])
      if (extraido !== null) return extraido
    }
    return null
  }
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null
  if (typeof valor === 'string' && /^\d+(?:[.,]\d{1,2})?$/.test(valor.trim())) {
    const numero = Number(valor.replace(',', '.'))
    return Number.isFinite(numero) && numero > 0 ? numero : null
  }
  return null
}
function avaliacao(valor: unknown): number | null {
  const bruto = objeto(valor)?.ratingValue ?? valor
  const numero = typeof bruto === 'number' ? bruto : typeof bruto === 'string' ? Number(bruto) : NaN
  return Number.isFinite(numero) && numero >= 0 && numero <= 5 ? numero : null
}
function candidato(registro: Registro, secundario: boolean, principal: boolean): Candidato | null {
  const schema = registro['@type'] === 'Product' || Array.isArray(registro['@type']) && registro['@type'].includes('Product')
  const nome = objeto(registro.name)
  const titulo = texto(nome?.text) ?? texto(registro.title) ?? texto(registro.name)
  const imagem = imagemHttps(registro.image) ?? imagemHttps(registro.picture) ?? imagemHttps(registro.thumbnail)
    ?? imagemHttps(registro.pictures && Array.isArray(registro.pictures) ? registro.pictures[0] : null)
  const oferta = objeto(registro.offers)
  const valor = preco(registro.price) ?? preco(oferta?.price)
  const itemId = id(registro.item_id) ?? id(registro.itemId) ?? id(registro.wid) ?? id(registro.id)
    ?? (schema ? id(registro.sku) ?? id(registro.productID) ?? id(registro.url) ?? id(registro['@id']) : null)
  if ((!schema && !itemId && !principal) || (!titulo && valor === null && !imagem)) return null
  return { id: itemId, titulo, preco: valor, imagem,
    rating: avaliacao(registro.aggregateRating) ?? avaliacao(registro.rating), schema, principal, secundario }
}
function lerAtributos(tag: string): Map<string, string> {
  const atributos = new Map<string, string>()
  for (const achado of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    atributos.set(achado[1].toLowerCase(), achado[2] ?? achado[3] ?? achado[4])
  }
  return atributos
}
function jsonBalanceado(script: string, inicio: number): string | null {
  let nivel = 0
  let aspas = false
  let escape = false
  for (let i = inicio; i < script.length; i++) {
    const c = script[i]
    if (aspas) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') aspas = false
    } else if (c === '"') aspas = true
    else if (c === '{') nivel++
    else if (c === '}' && --nivel === 0) return script.slice(inicio, i + 1)
  }
  return null
}
function documentosJson(html: string): unknown[] {
  const documentos: unknown[] = []
  for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const atributos = lerAtributos(tag[1])
    const corpo = tag[2].trim()
    if (!corpo || corpo.length > 1_000_000) continue
    const tipo = atributos.get('type')?.toLowerCase() ?? ''
    if (tipo.includes('json')) {
      try { documentos.push(JSON.parse(corpo)) } catch { /* JSON inválido não é executado. */ }
      continue
    }
    // O estado da PDP pode ser um literal JSON atribuído a uma variável JavaScript.
    // Ler o literal inteiro evita interpretar fragmentos de produtos relacionados como páginas independentes.
    const atribuicao = /^[_$\w.]+\s*=\s*(\{)/.exec(corpo)
    if (atribuicao) {
      const literal = jsonBalanceado(corpo, atribuicao[0].length - 1)
      if (literal) {
        try { documentos.push(JSON.parse(literal)); continue } catch { /* Apenas JSON válido é aceito. */ }
      }
    }
    // Apenas literais JSON válidos em scripts são interpretados; JavaScript nunca é avaliado.
    let tentativas = 0
    for (const achado of corpo.matchAll(/\{\s*"(?:@context|@type|id|item_id|itemId|name|title|price|product|item|initialState)"\s*:/g)) {
      if (++tentativas > 30 || documentos.length >= 100) break
      const trecho = jsonBalanceado(corpo, achado.index)
      if (!trecho) continue
      try { documentos.push(JSON.parse(trecho)) } catch { /* Ignorar objetos JavaScript que não sejam JSON. */ }
    }
  }
  return documentos
}
function candidatos(documentos: unknown[]): Candidato[] {
  const encontrados: Candidato[] = []
  let visitados = 0
  function visitar(valor: unknown, secundario: boolean, principal: boolean, profundidade: number) {
    if (profundidade > 12 || ++visitados > 5000) return
    if (Array.isArray(valor)) { valor.slice(0, 100).forEach((item) => visitar(item, secundario, principal, profundidade + 1)); return }
    const registro = objeto(valor)
    if (!registro) return
    const achado = candidato(registro, secundario, principal)
    if (achado) encontrados.push(achado)
    for (const [chave, filho] of Object.entries(registro)) {
      if (filho && typeof filho === 'object') visitar(filho, secundario || secundarias.test(chave), principal || chavesPdp.test(chave), profundidade + 1)
    }
  }
  documentos.forEach((documento) => visitar(documento, false, false, 0))
  return encontrados
}
function metadados(html: string, propriedade: string): string[] {
  const valores: string[] = []
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = lerAtributos(tag[0])
    if ((attrs.get('property') ?? attrs.get('name'))?.toLowerCase() === propriedade) {
      const valor = attrs.get('content')
      if (valor) valores.push(valor)
    }
  }
  return valores
}
function unico<T>(valores: T[], campo: string): T | null {
  const distintos = [...new Set(valores)]
  if (distintos.length > 1) throw new Error(`Dados conflitantes/ambíguos do produto principal: ${campo}.`)
  return distintos[0] ?? null
}
function idCanonico(html: string): string | null {
  const ids = new Set<string>()
  for (const tag of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const attrs = lerAtributos(tag[0])
    const rel = attrs.get('rel')?.toLowerCase()
    const property = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase()
    if (rel === 'canonical' || property === 'og:url' || property === 'product:item_id') {
      const encontrado = id(attrs.get('href') ?? attrs.get('content'))
      if (encontrado) ids.add(encontrado)
    }
  }
  if (ids.size > 1) throw new Error('Não foi possível identificar com segurança o produto principal.')
  return [...ids][0] ?? null
}
export function extrairIdUrlPagina(pagina: string): string {
  if (!pagina || pagina.length > 4096 || /\s/.test(pagina)) throw new Error('Informe a URL da página do produto.')
  let url: URL
  try { url = new URL(pagina) } catch { throw new Error('Informe uma URL válida da página do produto.') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br'))) {
    throw new Error('A URL da página deve ser do Mercado Livre e usar HTTPS.')
  }
  const ids = new Set<string>()
  for (const chave of ['item_id', 'wid']) {
    for (const valor of url.searchParams.getAll(chave)) {
      const encontrado = id(valor)
      if (encontrado) ids.add(encontrado)
    }
  }
  for (const filtro of url.searchParams.getAll('pdp_filters')) {
    for (const achado of filtro.matchAll(/(?:^|[,;|])item_id:MLB-?(\d+)(?=$|[,;|])/gi)) ids.add(`MLB${achado[1]}`)
  }
  // /p/MLB... identifica catálogo; somente o ID do anúncio em posição de item é aceito.
  if (!/(?:^|\/)p\/MLB\d+(?:\/|$)/i.test(url.pathname)) {
    const caminho = /(?:^|\/)MLB-?(\d+)(?:-[^/]*)?\/?$/i.exec(url.pathname)
    if (caminho) ids.add(`MLB${caminho[1]}`)
  }
  if (ids.size !== 1) throw new Error(ids.size ? 'URL da página contém ITEM_IDs conflitantes.' : 'URL da página não revelou ITEM_ID.')
  return [...ids][0]
}
export function validarLinkHtml(link: string): void {
  if (!link || link.length > 4096 || /\s/.test(link)) throw new Error('Informe um link afiliado válido.')
  let url: URL
  try { url = new URL(link) } catch { throw new Error('Informe um link afiliado válido.') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(host === 'meli.la' || host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br'))) {
    throw new Error('Domínio do link afiliado não permitido.')
  }
}
export function extrairProdutoHtml(html: string, linkAfiliado: string, urlPagina: string): ProdutoAfiliado {
  validarLinkHtml(linkAfiliado)
  const itemId = extrairIdUrlPagina(urlPagina)
  if (!html.trim()) throw new Error('Cole o HTML da página do produto.')
  if (html.length > LIMITE_HTML_PRODUTO || new TextEncoder().encode(html).byteLength > LIMITE_HTML_PRODUTO) {
    throw new Error('HTML grande demais. Limite de 10 MB.')
  }
  const canonico = idCanonico(html)
  if (canonico && canonico !== itemId) throw new Error('URL da página e HTML indicam produtos principais diferentes.')
  const lista = candidatos(documentosJson(html)).filter((c) => !c.secundario)
  const validos = lista.filter((c) => !c.id || c.id === itemId)
  const ligados = validos.filter((c) => c.id === itemId || c.schema || c.principal)
  const tituloEstruturado = unico(ligados.map((c) => c.titulo).filter((v): v is string => !!v), 'título')
  const titulo = tituloEstruturado ?? (canonico === itemId ? unico(metadados(html, 'og:title').map(texto).filter((v): v is string => !!v), 'título') : null)
  if (!titulo) throw new Error('ITEM_ID ok, título não encontrado no bloco principal do HTML.')
  const nucleos = ligados.filter((c) => c.titulo === titulo && c.preco !== null)
  const precos = nucleos.length ? nucleos.map((c) => c.preco!) : !tituloEstruturado && canonico === itemId
    ? ligados.filter((c) => c.principal && !c.titulo && c.preco !== null).map((c) => c.preco!) : []
  const valor = unico(precos, 'preço')
  if (valor === null) throw new Error('ITEM_ID ok, título ok, preço não encontrado no bloco principal do HTML.')
  const imagensSchema = ligados.filter((c) => c.schema && (c.titulo === titulo || c.id === itemId || canonico === itemId && !c.titulo)).map((c) => c.imagem).filter((v): v is string => !!v)
  const imagensOg = metadados(html, 'og:image').map(imagemHttps).filter((v): v is string => !!v)
  const imagensPdp = ligados.filter((c) => c.imagem && (c.titulo === titulo || c.id === itemId || c.principal && !c.titulo)).map((c) => c.imagem).filter((v): v is string => !!v)
  const imagem = unico(imagensSchema, 'imagem') ?? unico(imagensOg, 'imagem') ?? unico(imagensPdp, 'imagem')
  if (!imagem) throw new Error('ITEM_ID ok, título/preço ok, imagem principal não encontrada no HTML.')
  const ratings = ligados.filter((c) => c.titulo === titulo && c.preco === valor).map((c) => c.rating).filter((v): v is number => v !== null)
  const rating = ratings[0] ?? null
  return {
    itemId, productId: null, userProductId: null, variationId: null,
    titulo, precoAtual: valor, precoAnterior: null, moeda: 'BRL',
    desconto: null, parcelas: null, valorParcela: null, semJuros: null, avaliacao: rating,
    vendidosTexto: null, comissaoTexto: null, comissaoPercentual: null, destaque: null,
    imagemId: null, imagemUrl: imagem, linkOriginal: linkAfiliado,
    extraCommission: null, brandCommission: null, tipoOrigem: 'item',
  }
}
