import { classificarPrecoAfiliado } from './classificarPrecoAfiliado'
import type { ClassificacaoPrecoAfiliado } from './classificarPrecoAfiliado'

type Objeto = Record<string, unknown>
const objeto = (v: unknown): Objeto => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Objeto : {}
const texto = (v: unknown): string | null => typeof v === 'string' ? v.slice(0, 2000) : null
const preco = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isSafeInteger(Math.round(v * 100)) ? v : null
const id = (v: unknown, padrao: RegExp): string | null => typeof v === 'string' && padrao.test(v) ? v : null

export type ProdutoExtraidoHar = {
  itemId: string; productId: string | null; userProductId: string | null; titulo: string | null
  precoAtual: number | null; precoAnterior: number | null; moeda: string | null; discountLabel: string | null
  url: string | null; urlFragments: string | null; urlParams: string | null
  extraCommission: boolean | null; brandCommission: boolean | null; arquivoOrigem: string
  classificacao: ClassificacaoPrecoAfiliado
}
export type ConflitoHar = { itemId: string; precos: number[]; arquivos: string[] }
export type ProdutoUnicoHar = {
  itemId: string; capturas: ProdutoExtraidoHar[]; conflito: ConflitoHar | null
  classificacao: ClassificacaoPrecoAfiliado; precoAtual: number | null; valido: boolean
}
export type ResultadoParsingHar = {
  arquivos: string[]; produtos: ProdutoUnicoHar[]; chamadasSearch: number; ocorrencias: number
  semItemId: number; precosInvalidos: number; moedasInvalidas: number
  semCorpo: number; respostasInvalidas: number; duplicados: number
}
export function resultadoHarVazio(): ResultadoParsingHar {
  return { arquivos: [], produtos: [], chamadasSearch: 0, ocorrencias: 0, semItemId: 0,
    precosInvalidos: 0, moedasInvalidas: 0, semCorpo: 0, respostasInvalidas: 0, duplicados: 0 }
}
const flag = (v: unknown): boolean | null => v === true || v === 'true' ? true : v === false || v === 'false' ? false : null

// Apenas seletores de produto e flags públicas. Nunca copiar parâmetros arbitrários.
function parametrosSeguros(valor: unknown, fragmento = false): string | null {
  if (typeof valor !== 'string') return null
  const entrada = new URLSearchParams(valor.replace(/^[?#]/, ''))
  const saida = new URLSearchParams()
  for (const [chave, v] of entrada) {
    if ((chave === 'pdp_filters' && /^item_id:MLB\d+$/.test(v))
      || (chave === 'wid' && /^MLB\d+$/.test(v))
      || (['extra_comm', 'brand_comm'].includes(chave) && /^(true|false)$/.test(v))
      || (['polycard_client', 'sid'].includes(chave) && v === 'affiliates')) saida.set(chave, v)
  }
  return saida.size ? `${fragmento ? '#' : '?'}${saida}` : null
}
function urlProduto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  try {
    const u = new URL(valor.startsWith('https://') ? valor : `https://${valor}`)
    if (!['www.mercadolivre.com.br', 'mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(u.hostname)
      || u.username || u.password || u.port || u.protocol !== 'https:') return null
    // Só endereços de anúncio/catálogo, sem query, fragmento ou identificadores de sessão.
    if (!/\/(?:p|up)\/MLBU?\d+\/?$/.test(u.pathname) && !/^\/MLB-\d+(?:-[\p{L}\p{N}_.-]+)?$/u.test(u.pathname)) return null
    return `${u.origin}${u.pathname}`
  } catch { return null }
}
function chamadaSearch(valor: unknown): boolean {
  if (typeof valor !== 'string') return false
  try {
    const u = new URL(valor)
    return u.protocol === 'https:' && ['www.mercadolivre.com.br', 'mercadolivre.com.br'].includes(u.hostname)
      && u.pathname === '/affiliate-program/api/hub/search'
      && u.searchParams.getAll('is_affiliate').length === 1 && u.searchParams.get('is_affiliate') === 'true'
  } catch { return false }
}
function agrupar(capturas: ProdutoExtraidoHar[]): ProdutoUnicoHar[] {
  const grupos = new Map<string, ProdutoExtraidoHar[]>()
  for (const captura of capturas) grupos.set(captura.itemId, [...(grupos.get(captura.itemId) ?? []), captura])
  return [...grupos].map(([itemId, itens]) => {
    const precos = [...new Set(itens.map((p) => p.precoAtual).filter((p): p is number => p !== null))]
    const conflito = precos.length > 1 ? { itemId, precos, arquivos: [...new Set(itens.map((p) => p.arquivoOrigem))] } : null
    const classes = new Set(itens.map((p) => p.classificacao))
    const classificacao = classes.size === 1 ? itens[0].classificacao : 'OUTRO_REVISAR'
    return { itemId, capturas: itens, conflito, classificacao, precoAtual: conflito ? null : precos[0] ?? null,
      valido: !conflito && itens.every((p) => p.precoAtual !== null && p.moeda === 'BRL') }
  })
}
export function analisarHar(conteudo: string, arquivoOrigem: string): ResultadoParsingHar {
  let har: Objeto
  try { har = objeto(JSON.parse(conteudo)) } catch { throw new Error('Arquivo inválido: não é um HAR JSON legível.') }
  const log = objeto(har.log)
  if (!Array.isArray(log.entries)) throw new Error('Arquivo inválido: estrutura log.entries ausente.')
  const resultado = resultadoHarVazio()
  resultado.arquivos = [arquivoOrigem]
  const capturas: ProdutoExtraidoHar[] = []
  for (const valor of log.entries) {
    const entry = objeto(valor)
    if (!chamadaSearch(objeto(entry.request).url)) continue
    const resposta = objeto(entry.response)
    if (resposta.status !== 200) continue
    resultado.chamadasSearch++
    const content = objeto(resposta.content)
    if (typeof content.text !== 'string' || !content.text.trim()) { resultado.semCorpo++; continue }
    let corpo: Objeto
    try {
      if (content.encoding && content.encoding !== 'base64') throw new Error()
      const body = content.encoding === 'base64'
        ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.text), (c) => c.charCodeAt(0))) : content.text
      corpo = objeto(JSON.parse(body))
    } catch { resultado.respostasInvalidas++; continue }
    const cards = objeto(corpo.polycard_client_model).polycards
    if (!Array.isArray(cards)) { resultado.respostasInvalidas++; continue }
    for (const card of cards) {
      resultado.ocorrencias++
      const p = objeto(card); const m = objeto(p.metadata)
      const itemId = id(m.id, /^MLB\d+$/)
      if (!itemId) { resultado.semItemId++; continue }
      const components = Array.isArray(p.components) ? p.components.map(objeto) : []
      const componente = (tipo: string) => components.find((c) => c.type === tipo || c.id === tipo) ?? {}
      const price = objeto(componente('price').price)
      const current = objeto(price.current_price)
      const precoAtual = preco(current.value); const precoAnterior = preco(objeto(price.previous_price).value)
      const moeda = texto(current.currency); const discountLabel = texto(objeto(price.discount_label).text)
      if (precoAtual === null) resultado.precosInvalidos++
      if (moeda !== 'BRL') resultado.moedasInvalidas++
      capturas.push({ itemId, productId: id(m.product_id, /^MLB\d+$/), userProductId: id(m.user_product_id, /^MLBU\d+$/),
        titulo: texto(objeto(componente('title').title).text), precoAtual, precoAnterior, moeda, discountLabel,
        url: urlProduto(m.url), urlParams: parametrosSeguros(m.url_params), urlFragments: parametrosSeguros(m.url_fragments, true),
        extraCommission: flag(m.extra_commission), brandCommission: flag(m.brand_commission), arquivoOrigem,
        classificacao: classificarPrecoAfiliado(discountLabel, precoAtual, precoAnterior) })
    }
  }
  resultado.produtos = agrupar(capturas)
  resultado.duplicados = capturas.length - resultado.produtos.length
  return resultado
}
export function combinarHars(resultados: ResultadoParsingHar[]): ResultadoParsingHar {
  const r = resultadoHarVazio()
  for (const parcial of resultados) {
    r.arquivos.push(...parcial.arquivos)
    for (const chave of ['chamadasSearch', 'ocorrencias', 'semItemId', 'precosInvalidos', 'moedasInvalidas', 'semCorpo', 'respostasInvalidas'] as const) r[chave] += parcial[chave]
  }
  const capturas = resultados.flatMap((p) => p.produtos.flatMap((p) => p.capturas))
  r.produtos = agrupar(capturas)
  r.duplicados = capturas.length - r.produtos.length
  return r
}
