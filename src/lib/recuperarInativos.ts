import type { ProdutoCatalogo } from './manutencaoVitrine'
import { extrairPrecosHtml } from './extrairPrecosHtml'
import { analisarDocumentoLista, analisarHar } from './harAfiliadosParser'

export type CapturaInativo = {
  itemId: string; titulo: string; preco: number; productId: string | null
  userProductId: string | null; origem: string
}
export type CandidatoInativo = { produto: CapturaInativo; confianca: 'ALTA' | 'MÉDIA'; motivo: string }
export type DiagnosticoInativo = {
  inativo: ProdutoCatalogo; tipo: 'EXATO' | 'CANDIDATO' | 'SEM CORRESPONDÊNCIA'
  exato: CapturaInativo | null; candidatos: CandidatoInativo[]
}

const idValido = (id: string) => /^MLB\d+$/.test(id)
const precoValido = (preco: number | null) => preco !== null && Number.isFinite(preco) && preco > 0
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const comuns = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'uma', 'um', 'kit', 'novo', 'nova', 'original', 'cor', 'preto', 'branco'])
const palavras = (titulo: string) => new Set(normalizar(titulo).split(' ').filter((item) => item.length > 2 && !comuns.has(item)))

export function extrairArquivoInativos(conteudo: string, nome: string): CapturaInativo[] {
  if (/\.har$/i.test(nome)) {
    const resultado = analisarHar(conteudo, nome)
    return resultado.produtos.flatMap((item) => item.valido && precoValido(item.precoAtual)
      ? [{ itemId: item.itemId, titulo: item.capturas[0]?.titulo ?? '', preco: item.precoAtual!,
        productId: item.capturas[0]?.productId ?? null, userProductId: item.capturas[0]?.userProductId ?? null, origem: nome }] : [])
  }
  if (/\.(html?|html?\.txt)$/i.test(nome)) {
    try {
      const resultado = extrairPrecosHtml(conteudo, nome)
      return resultado.produtos.flatMap((item) => item.itemId && idValido(item.itemId) && precoValido(item.precoAtual)
        ? [{ itemId: item.itemId, titulo: item.titulo ?? '', preco: item.precoAtual!,
          productId: item.productId, userProductId: item.userProductId, origem: nome }] : [])
    } catch { /* documentos de lista estruturados seguem pelo parser de listas */ }
  }
  const resultado = analisarDocumentoLista(conteudo, nome)
  return resultado.produtos.flatMap((item) => item.valido && precoValido(item.precoAtual)
    ? [{ itemId: item.itemId, titulo: item.capturas[0]?.titulo ?? '', preco: item.precoAtual!,
      productId: item.capturas[0]?.productId ?? null, userProductId: item.capturas[0]?.userProductId ?? null, origem: nome }] : [])
}

export function classificarInativos(catalogo: ProdutoCatalogo[], capturas: CapturaInativo[]): DiagnosticoInativo[] {
  const porId = new Map<string, CapturaInativo>()
  const conflitantes = new Set<string>()
  for (const item of capturas) {
    if (!idValido(item.itemId) || !precoValido(item.preco) || !item.titulo.trim()) continue
    const anterior = porId.get(item.itemId)
    if (anterior && (Math.round(anterior.preco * 100) !== Math.round(item.preco * 100)
      || normalizar(anterior.titulo) !== normalizar(item.titulo))) conflitantes.add(item.itemId)
    if (!anterior) porId.set(item.itemId, item)
  }
  for (const id of conflitantes) porId.delete(id)
  const capturasSeguras = [...porId.values()]
  return catalogo.filter((item) => !item.ativo).map((inativo) => {
    const exato = porId.get(inativo.mercadoLivreId) ?? null
    if (exato) return { inativo, tipo: 'EXATO' as const, exato, candidatos: [] }
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
      exato: null, candidatos }
  })
}
