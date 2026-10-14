import { ehLinkMonetizado } from './linksAfiliados.ts'

export type ProdutoAfiliado = {
  itemId: string | null
  productId: string | null
  userProductId: string | null
  variationId: string | null
  titulo: string | null
  precoAtual: number | null
  precoAnterior: number | null
  moeda: string | null
  desconto: string | null
  parcelas: number | null
  valorParcela: number | null
  semJuros: boolean | null
  avaliacao: number | null
  vendidosTexto: string | null
  comissaoTexto: string | null
  comissaoPercentual: number | null
  destaque: string | null
  imagemId: string | null
  imagemUrl: string | null
  linkOriginal: string | null
  extraCommission: boolean | null
  brandCommission: boolean | null
  tipoOrigem: 'item' | 'product' | null
}

type Registro = Record<string, unknown>

function objeto(valor: unknown): Registro | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Registro : null
}

function campo(valor: unknown, ...chaves: string[]): unknown {
  let atual = valor
  for (const chave of chaves) atual = objeto(atual)?.[chave]
  return atual
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.trim() || null
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor)
  return null
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

function booleano(valor: unknown): boolean | null {
  if (typeof valor === 'boolean') return valor
  if (valor === 'true') return true
  if (valor === 'false') return false
  return null
}

function textos(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor]
  if (Array.isArray(valor)) return valor.flatMap(textos)
  const registro = objeto(valor)
  if (!registro) return []
  return Object.entries(registro)
    .filter(([chave]) => ['text', 'value', 'label', 'alt_text', 'values'].includes(chave))
    .flatMap(([, item]) => textos(item))
}

function componentes(card: Registro, nome: string): Registro | null {
  const lista = card.components
  if (!Array.isArray(lista)) return null
  return lista.map(objeto).find((item) => item && (item.id === nome || item.type === nome)) ?? null
}

function montarLink(metadata: Registro): string | null {
  // O link oficial, quando fornecido, é independente da URL do anúncio usada no card.
  const afiliado = [metadata.affiliate_url, metadata.affiliateUrl, metadata.link_afiliado]
    .find((valor): valor is string => typeof valor === 'string' && valor.trim().length > 0)
  if (afiliado) return afiliado
  const url = texto(metadata.url)
  if (!url) return null
  if (ehLinkMonetizado(url)) return url
  const base = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/\//, '')}`
  return `${base}${texto(metadata.url_params) ?? ''}${texto(metadata.url_fragments) ?? ''}`
}

function comissaoFlag(metadata: Registro, chave: string): boolean | null {
  const direto = booleano(metadata[chave === 'extra_comm' ? 'extra_commission' : 'brand_commission'])
  if (direto !== null) return direto
  const parametros = texto(metadata.url_params)
  if (!parametros) return null
  return booleano(new URLSearchParams(parametros.replace(/^\?/, '')).get(chave))
}

function montarImagem(id: string | null, contexto: Registro, pictures: Registro | null): string | null {
  const modelo = texto(contexto.picture_template)
  if (!id || !modelo || !/^https:\/\//i.test(modelo)) return null
  if (!/\{(?:id|picture_id|pictureId)\}/.test(modelo)) return null
  const valores: Record<string, string> = {
    id,
    picture_id: id,
    pictureId: id,
    square: texto(pictures?.square) ?? texto(contexto.picture_square_default) ?? '',
    size: texto(contexto.picture_size_default) ?? '',
    '2x': '_2X',
    sanitized_title: texto(pictures?.sanitized_title) ?? '',
  }
  const url = modelo.replace(/\{([^{}]+)\}/g, (marcador, chave: string) => valores[chave] ?? marcador)
  if (/\{[^{}]+\}/.test(url)) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function normalizar(card: Registro, contexto: Registro): ProdutoAfiliado {
  const metadata = objeto(card.metadata) ?? {}
  const pictures = objeto(card.pictures)
  const listaImagens = Array.isArray(card.pictures) ? card.pictures : pictures?.pictures
  const imagem = Array.isArray(listaImagens) ? objeto(listaImagens[0]) : null
  const preco = componentes(card, 'price')
  const dadosPreco = objeto(preco?.price) ?? preco
  const parcelas = objeto(campo(dadosPreco, 'installments'))
    ?? objeto(componentes(card, 'installments')?.installments)
    ?? componentes(card, 'installments')
  const avaliacao = componentes(card, 'review_compacted')
  const dadosAvaliacao = objeto(avaliacao?.review_compacted) ?? avaliacao
  const textoAvaliacao = textos(dadosAvaliacao?.alt_text ?? dadosAvaliacao?.values ?? dadosAvaliacao).join(' ')
  const nota = /(?:classifica(?:ç|c)[aã]o|avalia(?:ç|c)[aã]o|nota)\s*(\d(?:[.,]\d+)?)/i.exec(textoAvaliacao)
    ?? /\b(\d(?:[.,]\d+)?)\s*de\s*5\s*estrelas/i.exec(textoAvaliacao)
  const vendidos = /(?:mais de\s*|\+\s*)?(\d+(?:[.,]\d+)?\s*(?:mil|milh(?:ão|ões|oes))?)\s*(?:produtos?\s*)?vendidos?/i.exec(textoAvaliacao)
  const comissao = componentes(card, 'affiliates_commission_chip')
  const chip = objeto(comissao?.chip)
  const pill = objeto(chip?.pill)
  const textoPill = texto(pill?.text)
  const valoresPill = Array.isArray(pill?.values) ? pill.values : []
  const comissaoTexto = (textoPill?.replace(/\{([^{}]+)\}/g, (marcador, chave: string) =>
    texto(campo(valoresPill.find((valor) => campo(valor, 'key') === chave), 'label', 'text')) ?? marcador)
    ?? texto(comissao?.text) ?? '')
    .concat(texto(campo(chip, 'label', 'text')) ? ` ${texto(campo(chip, 'label', 'text'))}` : '') || null
  const percentual = comissaoTexto?.match(/(\d+(?:[.,]\d+)?)\s*%/)
  const destaque = componentes(card, 'highlight')
  const tipo = texto(metadata.type)
  const textoParcelas = texto(parcelas?.text)
  const numeroParcelas = textoParcelas?.match(/\b(\d+)\s*x\b/i)
  const valores = Array.isArray(parcelas?.values) ? parcelas.values : []
  const valorParcela = numero(campo(valores.find((item) => campo(item, 'key') === 'price'), 'price', 'value'))
    ?? valores.map((item) => numero(campo(item, 'price', 'value'))).find((item) => item !== null) ?? null
  const imagemId = texto(imagem?.id)

  return {
    itemId: texto(metadata.id),
    productId: texto(metadata.product_id),
    userProductId: texto(metadata.user_product_id),
    variationId: texto(metadata.variation_id) ?? texto(pictures?.variation_id) ?? texto(imagem?.variation_id),
    titulo: texto(campo(componentes(card, 'title'), 'title', 'text')),
    precoAtual: numero(campo(dadosPreco, 'current_price', 'value')),
    precoAnterior: numero(campo(dadosPreco, 'previous_price', 'value')),
    moeda: texto(campo(dadosPreco, 'current_price', 'currency')) ?? texto(campo(dadosPreco, 'previous_price', 'currency')),
    desconto: texto(campo(dadosPreco, 'discount_label', 'text')),
    parcelas: numeroParcelas ? Number(numeroParcelas[1]) : null,
    valorParcela,
    semJuros: booleano(parcelas?.no_interest),
    avaliacao: nota ? Number(nota[1].replace(',', '.')) : null,
    vendidosTexto: vendidos ? `+${vendidos[1].replace(/\s+/g, '')} vendidos` : null,
    comissaoTexto,
    comissaoPercentual: percentual ? Number(percentual[1].replace(',', '.')) : null,
    destaque: texto(campo(destaque, 'highlight', 'text')) ?? texto(destaque?.text),
    imagemId,
    imagemUrl: montarImagem(imagemId, contexto, pictures),
    linkOriginal: montarLink(metadata),
    extraCommission: comissaoFlag(metadata, 'extra_comm'),
    brandCommission: comissaoFlag(metadata, 'brand_comm'),
    tipoOrigem: tipo === 'item' || tipo === 'product' ? tipo : null,
  }
}

export function extrairProdutosAfiliados(json: unknown): ProdutoAfiliado[] {
  const resultado: ProdutoAfiliado[] = []
  const vistos = new WeakSet<object>()
  const idsVistos = new Set<string>()
  const pilha: { valor: unknown; contexto: Registro }[] = [{ valor: json, contexto: {} }]

  while (pilha.length) {
    const { valor, contexto } = pilha.pop()!
    if (Array.isArray(valor)) {
      if (vistos.has(valor)) continue
      vistos.add(valor)
      for (let i = valor.length - 1; i >= 0; i--) pilha.push({ valor: valor[i], contexto })
      continue
    }
    const registro = objeto(valor)
    if (!registro || vistos.has(registro)) continue
    vistos.add(registro)
    const contextoAtual = objeto(registro.polycard_context) ?? contexto

    if ('unique_id' in registro && 'metadata' in registro && 'pictures' in registro && 'components' in registro) {
      const id = texto(registro.unique_id) ?? texto(campo(registro.metadata, 'id'))
      if (id === null || !idsVistos.has(id)) {
        if (id !== null) idsVistos.add(id)
        resultado.push(normalizar(registro, contextoAtual))
      }
    }
    for (const filho of Object.values(registro).reverse()) pilha.push({ valor: filho, contexto: contextoAtual })
  }
  return resultado
}
