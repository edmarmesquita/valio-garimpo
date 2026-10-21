import type { ProdutoCatalogo } from './manutencaoVitrine'

export type CatalogoCsv = {
  produtos: ProdutoCatalogo[]; registrosLidos: number; ativosValidos: number
  inativosIgnorados: number; statusInvalidos: number; idsInvalidos: number
  precosInvalidos: number; idsDuplicados: number; ofertasIncompletas: number
}
const normalizar = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]/g, '').toLowerCase()
const aliases = {
  id: ['mercadolivreid', 'itemid'], preco: ['preco', 'precoatual', 'price'], ativo: ['ativo', 'active'],
  titulo: ['titulo', 'nome', 'title', 'name'], oferta: ['ofertarelampago'], inicio: ['ofertainicio'], fim: ['ofertafim'],
} as const

// CSV com aspas escapadas, quebras de linha em campos e delimitador vírgula ou ponto e vírgula.
function linhasCsv(texto: string): string[][] {
  const primeira = texto.match(/^(?:[^"\r\n]|"(?:[^"]|"")*")*/)?.[0] ?? ''
  const semAspas = primeira.replace(/"(?:[^"]|"")*"/g, '')
  const separador = (semAspas.match(/;/g)?.length ?? 0) > (semAspas.match(/,/g)?.length ?? 0) ? ';' : ','
  const linhas: string[][] = []; let linha: string[] = []; let campo = ''; let aspas = false; let fechado = false
  const finalizar = () => { linha.push(campo); if (linha.some((v) => v.trim())) linhas.push(linha); linha = []; campo = ''; fechado = false }
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') { aspas = false; fechado = true }
      else campo += c
    } else if (c === '"') {
      if (campo || fechado) throw new Error('CSV inválido: aspas em posição inesperada.')
      aspas = true
    } else if (c === separador) { linha.push(campo); campo = ''; fechado = false }
    else if (c === '\r' || c === '\n') { finalizar(); if (c === '\r' && texto[i + 1] === '\n') i++ }
    else if (fechado && c.trim()) throw new Error('CSV inválido: conteúdo após fechamento de aspas.')
    else if (!fechado) campo += c
  }
  if (aspas) throw new Error('CSV inválido: campo entre aspas incompleto.')
  finalizar()
  return linhas
}
export function analisarCatalogoCsv(conteudo: string): CatalogoCsv {
  const linhas = linhasCsv(conteudo.replace(/^\uFEFF/, ''))
  if (!linhas.length) throw new Error('CSV vazio. Selecione um catálogo com cabeçalho.')
  const cabecalho = linhas[0].map((v) => normalizar(v.trim()))
  const colunas = {} as Record<keyof typeof aliases, number>
  for (const chave of Object.keys(aliases) as (keyof typeof aliases)[]) {
    const indices = cabecalho.flatMap((v, i) => (aliases[chave] as readonly string[]).includes(v) ? [i] : [])
    if (indices.length > 1) throw new Error('Cabeçalho CSV ambíguo: colunas equivalentes repetidas.')
    colunas[chave] = indices[0] ?? -1
  }
  if (['id', 'preco', 'ativo'].some((k) => colunas[k as keyof typeof aliases] < 0)) {
    throw new Error('Cabeçalho CSV inválido. São obrigatórias as colunas mercado_livre_id, preco e ativo (ou equivalentes).')
  }
  const r: CatalogoCsv = { produtos: [], registrosLidos: linhas.length - 1, ativosValidos: 0,
    inativosIgnorados: 0, statusInvalidos: 0, idsInvalidos: 0, precosInvalidos: 0, idsDuplicados: 0, ofertasIncompletas: 0 }
  for (const linha of linhas.slice(1)) {
    if (linha.length !== cabecalho.length) throw new Error('CSV inválido: quantidade de campos diferente do cabeçalho.')
    const campo = (k: keyof typeof aliases) => colunas[k] < 0 ? '' : linha[colunas[k]].trim()
    const ativo = campo('ativo').toLowerCase()
    if (ativo === 'false') { r.inativosIgnorados++; continue }
    if (ativo !== 'true') { r.statusInvalidos++; continue }
    const mercadoLivreId = campo('id')
    if (!/^MLB\d+$/.test(mercadoLivreId)) { r.idsInvalidos++; continue }
    const valor = campo('preco')
    const numero = /^\d+(?:[.,]\d{1,2})?$/.test(valor) ? Number(valor.replace(',', '.')) : NaN
    const preco = Number.isFinite(numero) && numero > 0 && Number.isSafeInteger(Math.round(numero * 100)) ? numero : NaN
    if (!Number.isFinite(preco)) r.precosInvalidos++
    const flag = campo('oferta').toLowerCase()
    const ofertaIncompleta = flag !== 'true' && flag !== 'false'
    if (ofertaIncompleta) r.ofertasIncompletas++
    r.produtos.push({ mercadoLivreId, titulo: campo('titulo') || mercadoLivreId, preco, ativo: true,
      ofertaRelampago: flag !== 'false', ofertaInicio: ofertaIncompleta ? 'não informado no CSV' : campo('inicio') || null,
      ofertaFim: campo('fim') || null, dataPreco: '', updatedAt: '', categoria: 'Achados para Casa',
      linkAfiliado: '', imagem: '', rating: null })
  }
  const contagem = new Map<string, number>()
  for (const p of r.produtos) contagem.set(p.mercadoLivreId, (contagem.get(p.mercadoLivreId) ?? 0) + 1)
  r.idsDuplicados = [...contagem.values()].filter((n) => n > 1).length
  r.ativosValidos = r.produtos.filter((p) => Number.isFinite(p.preco) && contagem.get(p.mercadoLivreId) === 1).length
  return r
}
