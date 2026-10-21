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
  listaId: string | null; listaNome: string | null; evidenciasCondicao: string[]
  classificacao: ClassificacaoPrecoAfiliado
}
export type ConflitoHar = { itemId: string; precos: number[]; arquivos: string[] }
export type ProdutoUnicoHar = {
  itemId: string; capturas: ProdutoExtraidoHar[]; conflito: ConflitoHar | null
  classificacao: ClassificacaoPrecoAfiliado; precoAtual: number | null; valido: boolean; listasOrigem: { id: string; nome: string }[]
}
export type ListaHar = { id: string; nome: string; titulo: string | null; tipo: string; totalEsperado: number | null
  extraidos: number; ocorrencias: number; status: 'COMPLETA' | 'INCOMPLETA' | 'TOTAL_DESCONHECIDO'; itemIds: string[]; arquivos: string[] }
export type ResultadoParsingHar = {
  arquivos: string[]; produtos: ProdutoUnicoHar[]; listas: ListaHar[]; chamadasSearch: number; documentosLista: number; ocorrencias: number
  semItemId: number; precosInvalidos: number; moedasInvalidas: number
  semCorpo: number; respostasInvalidas: number; duplicados: number
}
export function resultadoHarVazio(): ResultadoParsingHar {
  return { arquivos: [], produtos: [], listas: [], chamadasSearch: 0, documentosLista: 0, ocorrencias: 0, semItemId: 0,
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
    const listasOrigem = [...new Map(itens.filter((p) => p.listaId).map((p) => [p.listaId!, { id: p.listaId!, nome: p.listaNome ?? p.listaId! }])).values()]
    return { itemId, capturas: itens, conflito, classificacao, precoAtual: conflito ? null : precos[0] ?? null, listasOrigem,
      valido: !conflito && itens.every((p) => p.precoAtual !== null && p.moeda === 'BRL') }
  })
}
const listaVazia = (id: string, nome: string, titulo: string | null, totalEsperado: number | null): ListaHar =>
  ({ id, nome, titulo, tipo: 'affiliate', totalEsperado, extraidos: 0, ocorrencias: 0,
    status: 'TOTAL_DESCONHECIDO', itemIds: [], arquivos: [] })

function consolidarListas(listas: ListaHar[]): ListaHar[] {
  const agrupadas = new Map<string, ListaHar>()
  for (const lista of listas) {
    const anterior = agrupadas.get(lista.id) ?? listaVazia(lista.id, lista.nome, lista.titulo, lista.totalEsperado)
    anterior.totalEsperado = lista.totalEsperado === null ? anterior.totalEsperado
      : Math.max(anterior.totalEsperado ?? 0, lista.totalEsperado)
    anterior.ocorrencias += lista.ocorrencias
    anterior.itemIds = [...new Set([...anterior.itemIds, ...lista.itemIds])]
    anterior.arquivos = [...new Set([...anterior.arquivos, ...lista.arquivos])]
    anterior.extraidos = anterior.itemIds.length
    anterior.status = anterior.totalEsperado === null ? 'TOTAL_DESCONHECIDO'
      : anterior.extraidos === anterior.totalEsperado ? 'COMPLETA' : 'INCOMPLETA'
    agrupadas.set(lista.id, anterior)
  }
  return [...agrupadas.values()]
}

function evidenciasPromocoes(valor: unknown): string[] {
  const encontrados = new Set<string>()
  function visitar(v: unknown, profundidade: number) {
    if (profundidade > 6) return
    if (Array.isArray(v)) { for (const item of v) visitar(item, profundidade + 1); return }
    if (typeof v !== 'object' || v === null) return
    for (const [chave, item] of Object.entries(v)) {
      if (typeof item === 'string' && /^(type|name|label|title|description|payment_method|campaign_type)$/i.test(chave)) {
        if (/pix/i.test(item)) encontrados.add('PIX')
        if (/cupom|coupon/i.test(item)) encontrados.add('CUPOM')
        if (/saldo|mercado\s*pago/i.test(item)) encontrados.add('SALDO')
      } else if (typeof item === 'object') visitar(item, profundidade + 1)
    }
  }
  visitar(valor, 0)
  return [...encontrados]
}

function extrairCard(valor: unknown, arquivoOrigem: string, lista: ListaHar | null, resultado: ResultadoParsingHar): ProdutoExtraidoHar | null {
  resultado.ocorrencias++
  if (lista) lista.ocorrencias++
  const p = objeto(valor); const m = objeto(p.metadata)
  const itemId = id(m.id, /^MLB\d+$/)
  if (!itemId) { resultado.semItemId++; return null }
  if (lista) lista.itemIds.push(itemId)
  const components = Array.isArray(p.components) ? p.components.map(objeto) : []
  const componente = (tipo: string) => components.find((c) => c.type === tipo || c.id === tipo) ?? {}
  const price = objeto(componente('price').price)
  const current = objeto(price.current_price)
  const precoAtual = preco(current.value); const precoAnterior = preco(objeto(price.previous_price).value)
  const moeda = texto(current.currency); const discountLabel = texto(objeto(price.discount_label).text)
  const evidenciasCondicao = evidenciasPromocoes(objeto(objeto(m.tracks).price).promotions)
  if (precoAtual === null) resultado.precosInvalidos++
  if (moeda !== 'BRL') resultado.moedasInvalidas++
  const condicao = [discountLabel, ...evidenciasCondicao].filter(Boolean).join(' ')
  return { itemId, productId: id(m.product_id, /^MLB\d+$/), userProductId: id(m.user_product_id, /^MLBU\d+$/),
    titulo: texto(objeto(componente('title').title).text), precoAtual, precoAnterior, moeda, discountLabel,
    url: urlProduto(m.url), urlParams: parametrosSeguros(m.url_params), urlFragments: parametrosSeguros(m.url_fragments, true),
    extraCommission: flag(m.extra_commission), brandCommission: flag(m.brand_commission), arquivoOrigem,
    listaId: lista?.id ?? null, listaNome: lista?.nome ?? null, evidenciasCondicao,
    classificacao: classificarPrecoAfiliado(condicao || null, precoAtual, precoAnterior) }
}

function listaEmObjeto(valor: unknown): Objeto | null {
  const pendentes: { valor: Objeto; profundidade: number }[] = [{ valor: objeto(valor), profundidade: 0 }]
  for (let i = 0; i < pendentes.length; i++) {
    const { valor: atual, profundidade } = pendentes[i]
    const lista = objeto(objeto(atual.initialState).list)
    if (lista.type === 'affiliate') return lista
    if (profundidade >= 6) continue
    for (const chave of ['props', 'appProps', 'pageProps', 'data']) {
      const proximo = objeto(atual[chave])
      if (Object.keys(proximo).length) pendentes.push({ valor: proximo, profundidade: profundidade + 1 })
    }
  }
  return null
}

function listaNoCorpo(corpo: string): Objeto | null {
  try { const lista = listaEmObjeto(JSON.parse(corpo)); if (lista) return lista } catch { /* documento HTML */ }
  for (const match of corpo.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { const lista = listaEmObjeto(JSON.parse(match[1])); if (lista) return lista } catch { /* outro script */ }
    // Nordic insere JSON vÃ¡lido em uma atribuiÃ§Ã£o JS. Delimitamos somente o objeto;
    // nunca avaliamos o restante do script nem aceitamos expressÃµes JavaScript.
    if (!/^<script\b[^>]*\bid=["']__NORDIC_RENDERING_CTX__["']/i.test(match[0])) continue
    const atribuicao = /\b_n\.ctx\.r\s*=\s*\{/.exec(match[1])
    if (!atribuicao) continue
    const inicio = atribuicao.index + atribuicao[0].lastIndexOf('{')
    let profundidade = 0; let aspas = false; let escape = false
    for (let i = inicio; i < match[1].length; i++) {
      const ch = match[1][i]
      if (aspas) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') aspas = false
      } else if (ch === '"') aspas = true
      else if (ch === '{') profundidade++
      else if (ch === '}' && --profundidade === 0) {
        try { const lista = listaEmObjeto(JSON.parse(match[1].slice(inicio, i + 1))); if (lista) return lista }
        catch { /* objeto incompleto ou invÃ¡lido */ }
        break
      }
    }
  }
  return null
}

function cardsDaLista(lista: Objeto): unknown[] {
  const cards: unknown[] = []
  function visitar(valor: unknown, profundidade: number) {
    if (profundidade > 16 || valor === null || typeof valor !== 'object') return
    if (Array.isArray(valor)) { for (const item of valor) visitar(item, profundidade + 1); return }
    const p = objeto(valor)
    if (Object.hasOwn(objeto(p.metadata), 'id') && Array.isArray(p.components)) { cards.push(p); return }
    for (const [chave, item] of Object.entries(p)) {
      if (!['metadata', 'tracking', 'tracks', 'analytics'].includes(chave)) visitar(item, profundidade + 1)
    }
  }
  visitar(lista, 0)
  return cards
}

function incorporarLista(corpo: string, arquivoOrigem: string, resultado: ResultadoParsingHar, capturas: ProdutoExtraidoHar[]): boolean {
  const list = listaNoCorpo(corpo)
  if (!list) return false
  const listId = typeof list.id === 'string' && /^[\w-]{1,100}$/.test(list.id) ? list.id : null
  if (!listId) return false
  const totalEsperado = Number.isSafeInteger(list.total_items) && (list.total_items as number) >= 0 ? list.total_items as number : null
  const nome = texto(list.name)?.slice(0, 200) || texto(list.title)?.slice(0, 200) || listId
  const lista = listaVazia(listId, nome, texto(list.title)?.slice(0, 200) ?? null, totalEsperado)
  lista.arquivos = [arquivoOrigem]
  for (const card of cardsDaLista(list)) {
    const produto = extrairCard(card, arquivoOrigem, lista, resultado)
    if (produto) capturas.push(produto)
  }
  resultado.documentosLista++
  resultado.listas.push(lista)
  return true
}

function corpoResposta(content: Objeto): string | null {
  if (typeof content.text !== 'string' || !content.text.trim()) return null
  if (content.encoding && content.encoding !== 'base64') return null
  return content.encoding === 'base64'
    ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.text), (c) => c.charCodeAt(0))) : content.text
}

export function analisarDocumentoLista(conteudo: string, arquivoOrigem: string): ResultadoParsingHar {
  const resultado = resultadoHarVazio(); resultado.arquivos = [arquivoOrigem]
  const capturas: ProdutoExtraidoHar[] = []
  if (!incorporarLista(conteudo, arquivoOrigem, resultado, capturas)) throw new Error('Documento sem lista de afiliados estruturada.')
  resultado.listas = consolidarListas(resultado.listas)
  resultado.produtos = agrupar(capturas); resultado.duplicados = capturas.length - resultado.produtos.length
  return resultado
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
    const requisicao = objeto(entry.request)
    const search = chamadaSearch(requisicao.url)
    let fonteOficial = false
    try {
      const u = new URL(String(requisicao.url))
      fonteOficial = u.protocol === 'https:' && (u.hostname === 'mercadolivre.com.br' || u.hostname.endsWith('.mercadolivre.com.br'))
    } catch { /* URL invÃ¡lida */ }
    if (!search && !fonteOficial) continue
    const resposta = objeto(entry.response)
    if (resposta.status !== 200) continue
    if (search) resultado.chamadasSearch++
    const content = objeto(resposta.content)
    if (!search && typeof content.mimeType === 'string' && !/(json|html|javascript|text\/plain)/i.test(content.mimeType)) continue
    if (search && (typeof content.text !== 'string' || !content.text.trim())) { resultado.semCorpo++; continue }
    if (typeof content.text !== 'string' || !content.text.trim()) continue
    let body: string
    try { body = corpoResposta(content) ?? '' } catch { if (search) resultado.respostasInvalidas++; continue }
    if (!body) { if (search) resultado.respostasInvalidas++; continue }
    if (!search) { incorporarLista(body, arquivoOrigem, resultado, capturas); continue }
    let corpo: Objeto
    try {
      corpo = objeto(JSON.parse(body))
    } catch { resultado.respostasInvalidas++; continue }
    const cards = objeto(corpo.polycard_client_model).polycards
    if (!Array.isArray(cards)) { resultado.respostasInvalidas++; continue }
    for (const card of cards) { const produto = extrairCard(card, arquivoOrigem, null, resultado); if (produto) capturas.push(produto) }
  }
  resultado.listas = consolidarListas(resultado.listas)
  resultado.produtos = agrupar(capturas)
  resultado.duplicados = capturas.length - resultado.produtos.length
  return resultado
}
export function combinarHars(resultados: ResultadoParsingHar[]): ResultadoParsingHar {
  const r = resultadoHarVazio()
  for (const parcial of resultados) {
    r.arquivos.push(...parcial.arquivos)
    r.listas.push(...parcial.listas)
    for (const chave of ['chamadasSearch', 'documentosLista', 'ocorrencias', 'semItemId', 'precosInvalidos', 'moedasInvalidas', 'semCorpo', 'respostasInvalidas'] as const) r[chave] += parcial[chave]
  }
  r.listas = consolidarListas(r.listas)
  const capturas = resultados.flatMap((p) => p.produtos.flatMap((p) => p.capturas))
  r.produtos = agrupar(capturas)
  r.duplicados = capturas.length - r.produtos.length
  return r
}
