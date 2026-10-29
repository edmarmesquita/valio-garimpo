import type { ProdutoCatalogo } from './manutencaoVitrine'
import { extrairPrecosHtml } from './extrairPrecosHtml'
import { extrairProdutosPaginaOfertas } from './extrairProdutosPaginaOfertas'
import { analisarDocumentoLista, analisarHar } from './harAfiliadosParser'

export type CapturaInativo = {
  itemId: string; titulo: string; preco: number; productId: string | null
  userProductId: string | null; origem: string; origens?: string[]; moeda?: string | null; url?: string | null
}
export type CandidatoInativo = { produto: CapturaInativo; confianca: 'ALTA' | 'MÉDIA'; motivo: string }
export type ConflitoPrecoInativo = { precos: number[]; origens: string[] }
export type DiagnosticoInativo = {
  inativo: ProdutoCatalogo; tipo: 'EXATO' | 'CANDIDATO' | 'SEM CORRESPONDÊNCIA'
  exato: CapturaInativo | null; candidatos: CandidatoInativo[]; conflitoPreco?: ConflitoPrecoInativo | null
}
export type ResultadoArquivoInativos = {
  capturas: CapturaInativo[]; reconhecido: boolean; formato: 'HTML' | 'OFERTAS_NORDIC' | 'HAR' | 'LISTA' | null
  cardsBrutos: number; duplicados: number
  pagina?: { page: number | null; offset: number | null; limit: number | null; total: number | null }
}

const idValido = (id: string) => /^MLB\d+$/.test(id)
const precoValido = (preco: number | null) => preco !== null && Number.isFinite(preco) && preco > 0
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const comuns = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'uma', 'um', 'kit', 'novo', 'nova', 'original', 'cor', 'preto', 'branco'])
const palavras = (titulo: string) => new Set(normalizar(titulo).split(' ').filter((item) => item.length > 2 && !comuns.has(item)))

function capturarResultadoHar(conteudo: string, nome: string): ResultadoArquivoInativos {
  const resultado = analisarHar(conteudo, nome)
  const capturas = resultado.produtos.flatMap((item) => item.valido && precoValido(item.precoAtual)
    && item.capturas[0]?.moeda === 'BRL' && item.capturas[0]?.titulo?.trim()
    ? [{ itemId: item.itemId, titulo: item.capturas[0].titulo!, preco: item.precoAtual!,
      productId: item.capturas[0].productId, userProductId: item.capturas[0].userProductId,
      origem: nome, origens: [nome], moeda: 'BRL', url: item.capturas[0].url }] : [])
  return { capturas, reconhecido: true, formato: 'HAR', cardsBrutos: resultado.ocorrencias, duplicados: resultado.duplicados }
}

function capturarResultadoLista(conteudo: string, nome: string): ResultadoArquivoInativos {
  const resultado = analisarDocumentoLista(conteudo, nome)
  const capturas = resultado.produtos.flatMap((item) => item.valido && precoValido(item.precoAtual)
    && item.capturas[0]?.moeda === 'BRL' && item.capturas[0]?.titulo?.trim()
    ? [{ itemId: item.itemId, titulo: item.capturas[0].titulo!, preco: item.precoAtual!,
      productId: item.capturas[0].productId, userProductId: item.capturas[0].userProductId,
      origem: nome, origens: [nome], moeda: 'BRL', url: item.capturas[0].url }] : [])
  return { capturas, reconhecido: true, formato: 'LISTA', cardsBrutos: resultado.ocorrencias, duplicados: resultado.duplicados }
}

export function analisarArquivoInativos(conteudo: string, nome: string): ResultadoArquivoInativos {
  if (/\.har$/i.test(nome)) {
    try { return capturarResultadoHar(conteudo, nome) }
    catch { return { capturas: [], reconhecido: false, formato: null, cardsBrutos: 0, duplicados: 0 } }
  }
  if (/\.(html?|html?\.txt)$/i.test(nome)) {
    try {
      const resultado = extrairProdutosPaginaOfertas(conteudo, nome)
      const vistos = new Set<string>()
      let duplicados = 0
      const capturas = resultado.produtos.map((item) => {
        if (vistos.has(item.itemId)) duplicados++
        vistos.add(item.itemId)
        return { ...item, origens: [nome] }
      })
      return { capturas, reconhecido: true, formato: 'OFERTAS_NORDIC',
        cardsBrutos: resultado.cardsBrutos, duplicados, pagina: resultado.pagina }
    } catch { /* tenta o parser genérico de HTML e JSON-LD */ }

    let htmlReconhecidoSemCapturas: ResultadoArquivoInativos | null = null
    try {
      const resultado = extrairPrecosHtml(conteudo, nome)
      const capturas = resultado.produtos.flatMap((item) => item.itemId && idValido(item.itemId)
        && precoValido(item.precoAtual) && item.titulo?.trim()
        ? [{ itemId: item.itemId, titulo: item.titulo, preco: item.precoAtual!, productId: item.productId,
          userProductId: item.userProductId, origem: nome, origens: [nome], moeda: 'BRL',
          url: resultado.urls.get(item.itemId) ?? null }] : [])
      const leituraHtml: ResultadoArquivoInativos = { capturas, reconhecido: true, formato: 'HTML',
        cardsBrutos: resultado.encontrados,
        duplicados: Math.max(0, resultado.encontrados - resultado.semId - resultado.produtos.length) }
      if (capturas.length) return leituraHtml
      if (resultado.encontrados > 0) htmlReconhecidoSemCapturas = leituraHtml
    } catch { /* tenta os formatos legados de listas */ }

    try { return capturarResultadoLista(conteudo, nome) }
    catch { if (htmlReconhecidoSemCapturas) return htmlReconhecidoSemCapturas }
    return { capturas: [], reconhecido: false, formato: null, cardsBrutos: 0, duplicados: 0 }
  }
  try { return capturarResultadoLista(conteudo, nome) }
  catch { return { capturas: [], reconhecido: false, formato: null, cardsBrutos: 0, duplicados: 0 } }
}

export function extrairArquivoInativos(conteudo: string, nome: string): CapturaInativo[] {
  const resultado = analisarArquivoInativos(conteudo, nome)
  if (!resultado.reconhecido) throw new Error('Documento não reconhecido. Envie HTML de produtos do Mercado Livre, lista estruturada ou HAR válido.')
  return resultado.capturas
}

export function classificarInativos(catalogo: ProdutoCatalogo[], capturas: CapturaInativo[]): DiagnosticoInativo[] {
  const porId = new Map<string, CapturaInativo>()
  const conflitos = new Map<string, ConflitoPrecoInativo>()
  for (const item of capturas) {
    if (!idValido(item.itemId) || !precoValido(item.preco) || !item.titulo.trim()) continue
    if (item.moeda && item.moeda !== 'BRL') continue
    if (conflitos.has(item.itemId)) {
      const conflito = conflitos.get(item.itemId)!
      conflito.precos = [...new Set([...conflito.precos, item.preco])]
      conflito.origens = [...new Set([...conflito.origens, ...(item.origens ?? [item.origem])])]
      continue
    }
    const anterior = porId.get(item.itemId)
    if (anterior && Math.round(anterior.preco * 100) !== Math.round(item.preco * 100)) {
      conflitos.set(item.itemId, { precos: [...new Set([anterior.preco, item.preco])],
        origens: [...new Set([...(anterior.origens ?? [anterior.origem]), ...(item.origens ?? [item.origem])])] })
      porId.delete(item.itemId)
      continue
    }
    if (!anterior) porId.set(item.itemId, { ...item, origens: [...new Set(item.origens ?? [item.origem])] })
    else porId.set(item.itemId, { ...anterior,
      origens: [...new Set([...(anterior.origens ?? [anterior.origem]), ...(item.origens ?? [item.origem])])] })
  }
  const capturasSeguras = [...porId.values()]
  return catalogo.filter((item) => !item.ativo).map((inativo) => {
    const conflitoPreco = conflitos.get(inativo.mercadoLivreId) ?? null
    if (conflitoPreco) return { inativo, tipo: 'SEM CORRESPONDÊNCIA' as const, exato: null, candidatos: [], conflitoPreco }
    const exato = porId.get(inativo.mercadoLivreId) ?? null
    if (exato) return { inativo, tipo: 'EXATO' as const, exato, candidatos: [], conflitoPreco: null }
    const titulo = normalizar(inativo.titulo)
    const alvo = palavras(inativo.titulo)
    const candidatos = capturasSeguras.flatMap((produto): CandidatoInativo[] => {
      if (produto.itemId === inativo.mercadoLivreId) return []
      if (normalizar(produto.titulo) === titulo) return [{ produto, confianca: 'ALTA', motivo: 'Título normalizado idêntico; ITEM_ID diferente.' }]
      const outros = palavras(produto.titulo)
      const comuns = [...alvo].filter((palavra) => outros.has(palavra))
      const cobertura = comuns.length / Math.min(alvo.size, outros.size)
      if (comuns.length < 4 || cobertura < 0.75 || !comuns.some((palavra) => palavra.length >= 5)) return []
      return [{ produto, confianca: 'MÉDIA', motivo: `Termos específicos em comum: ${comuns.join(', ')}. Confira modelo e variante.` }]
    })
    return { inativo, tipo: candidatos.length ? 'CANDIDATO' as const : 'SEM CORRESPONDÊNCIA' as const,
      exato: null, candidatos, conflitoPreco: null }
  })
}
