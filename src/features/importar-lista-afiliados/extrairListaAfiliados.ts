import { extrairProdutosAfiliados } from '../../lib/extrairProdutosAfiliados'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'

export type ProdutoListaAfiliados = {
  ordem: number
  itemId: string
  titulo: string | null
  userProductId: string | null
  productId: string | null
  pid: string | null
  pidExtended: string | null
  urlOriginal: string | null
  urlParams: string | null
  urlFragments: string | null
  urlNormalizada: string | null
  dadosPublicacao?: ProdutoAfiliado
}

export type ResultadoListaAfiliados = {
  encontrados: number
  unicos: number
  ignorados: number
  duplicados: number
  produtos: ProdutoListaAfiliados[]
  urlsParaGerador: string
  lotes?: ProdutoListaAfiliados[][]
}

export function dividirProdutosEmLotes(produtos: readonly ProdutoListaAfiliados[], tamanho = 30): ProdutoListaAfiliados[][] {
  if (!Number.isInteger(tamanho) || tamanho <= 0) throw new Error('O tamanho do lote deve ser um inteiro positivo.')
  const lotes: ProdutoListaAfiliados[][] = []
  for (let inicio = 0; inicio < produtos.length; inicio += tamanho) lotes.push(produtos.slice(inicio, inicio + tamanho))
  return lotes
}

type Registro = Record<string, unknown>

function contextoImagens(fonte: string): Registro {
  const contexto: Registro = {}
  for (const chave of ['picture_template', 'picture_square_default', 'picture_size_default']) {
    const padrao = new RegExp(`"${chave}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'g')
    let encontrado: RegExpExecArray | null
    while ((encontrado = padrao.exec(fonte)) !== null) {
      try { contexto[chave] = JSON.parse(encontrado[1]) as unknown } catch { /* valor inválido */ }
    }
  }
  return contexto
}

const registro = (valor: unknown): Registro | null =>
  valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : null

function tituloDoCard(card: Registro): string | null {
  const direto = texto(card.title) ?? texto(registro(card.title)?.text)
    ?? texto(card.name) ?? texto(registro(card.name)?.text)
  if (direto) return direto
  if (!Array.isArray(card.components)) return null
  for (const componente of card.components) {
    const bloco = registro(componente)
    if (!bloco) continue
    const titulo = texto(bloco.title) ?? texto(registro(bloco.title)?.text)
      ?? texto(bloco.name) ?? texto(registro(bloco.name)?.text)
    if (titulo) return titulo
  }
  return null
}

export function normalizarUrlProdutoLista(valor: unknown): string | null {
  const original = texto(valor)
  if (!original) return null
  const candidata = /^https?:\/\//i.test(original) ? original : `https://${original}`
  try {
    const url = new URL(candidata)
    if (!['www.mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(url.hostname.toLowerCase())) return null
    if (url.username || url.password || !url.pathname || url.pathname === '/') return null
    url.protocol = 'https:'
    return url.href
  } catch { return null }
}

function fimDoArray(fonte: string, inicio: number): number {
  let nivel = 0
  let emString = false
  let escapado = false
  for (let indice = inicio; indice < fonte.length; indice++) {
    const caractere = fonte[indice]
    if (emString) {
      if (escapado) escapado = false
      else if (caractere === '\\') escapado = true
      else if (caractere === '"') emString = false
      continue
    }
    if (caractere === '"') emString = true
    else if (caractere === '[') nivel++
    else if (caractere === ']' && --nivel === 0) return indice + 1
  }
  return -1
}

export function extrairListaAfiliados(html: string): ResultadoListaAfiliados {
  if (!html.trim()) throw new Error('Cole o HTML/Response da lista de afiliados.')

  const marcador = /"polycards"\s*:\s*\[/g
  const produtos: ProdutoListaAfiliados[] = []
  const ids = new Set<string>()
  let encontrouBloco = false
  let leuBloco = false
  let encontrados = 0
  let ignorados = 0
  let duplicados = 0
  let correspondencia: RegExpExecArray | null

  while ((correspondencia = marcador.exec(html)) !== null) {
    encontrouBloco = true
    const inicio = correspondencia.index + correspondencia[0].length - 1
    const fim = fimDoArray(html, inicio)
    if (fim < 0) continue
    let cards: unknown
    try { cards = JSON.parse(html.slice(inicio, fim)) }
    catch { continue }
    if (!Array.isArray(cards)) continue
    leuBloco = true
    marcador.lastIndex = fim
    const inicioScript = html.lastIndexOf('<script', correspondencia.index)
    const contexto = contextoImagens(html.slice(inicioScript < 0 ? 0 : inicioScript, correspondencia.index))

    for (const valor of cards) {
      encontrados++
      const card = registro(valor)
      const metadata = registro(card?.metadata)
      const itemId = texto(metadata?.id)?.toUpperCase() ?? null
      if (!itemId || !/^MLB\d+$/.test(itemId)) { ignorados++; continue }
      if (ids.has(itemId)) { duplicados++; continue }
      ids.add(itemId)
      const extraido = card && 'unique_id' in card && 'pictures' in card && 'components' in card
        ? extrairProdutosAfiliados({ polycard_context: contexto, polycards: [card] })[0] : null
      produtos.push({
        ordem: encontrados,
        itemId,
        titulo: card ? tituloDoCard(card) : null,
        userProductId: texto(metadata?.user_product_id),
        productId: texto(metadata?.product_id),
        pid: texto(metadata?.pid),
        pidExtended: texto(metadata?.pid_extended),
        urlOriginal: texto(metadata?.url),
        urlParams: texto(metadata?.url_params),
        urlFragments: texto(metadata?.url_fragments),
        urlNormalizada: normalizarUrlProdutoLista(metadata?.url),
        ...(extraido ? { dadosPublicacao: { ...extraido, itemId, titulo: extraido.titulo ?? tituloDoCard(card!) } } : {}),
      })
    }
  }

  if (!encontrouBloco) throw new Error('Nenhum bloco de polycards foi encontrado no HTML.')
  if (!leuBloco) throw new Error('Não foi possível ler os polycards. Confira se o HTML está completo.')
  if (!produtos.length) throw new Error('Nenhum metadata.id válido foi encontrado nos polycards.')
  return {
    encontrados,
    unicos: produtos.length,
    ignorados,
    duplicados,
    produtos,
    urlsParaGerador: produtos.flatMap((produto) => produto.urlNormalizada ? [produto.urlNormalizada] : []).join('\n'),
    lotes: dividirProdutosEmLotes(produtos.filter((produto) => produto.urlNormalizada !== null)),
  }
}
