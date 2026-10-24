import { CATEGORIAS_VALIO } from '../../lib/produtosGarimpados'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import type { ProdutoListaAfiliados, ResultadoListaAfiliados } from './extrairListaAfiliados'
import { processarRetornoGerador } from './processarRetornoGerador'

export const CHAVE_SNAPSHOT_LOTE = 'valio-garimpa:affiliate-batch-snapshot:v1'
export const MAX_PRODUTOS_GERADOR = 30
export type StatusSnapshot = 'AGUARDANDO RETORNO' | 'RETORNO PROCESSADO' | 'FINALIZADO'
export type ProdutoSnapshot = ProdutoListaAfiliados & { posicaoGerador: number; urlNormalizada: string }
export type SnapshotLote = {
  snapshotId: string
  createdAt: string
  origemLista: string | null
  quantidade: number
  identificacao: string
  urlsParaGerador: string
  produtos: ProdutoSnapshot[]
}
export type RegistroSnapshot = {
  schemaVersion: 1
  snapshot: SnapshotLote
  status: StatusSnapshot
  retornoTexto: string | null
  linksConcluidos: string[]
  novosConcluidos: string[]
  categorias: Record<string, CategoriaValio>
}

export type RegistrosSnapshot = { schemaVersion: 2; lotes: RegistroSnapshot[] }

const objeto = (valor: unknown): Record<string, unknown> | null =>
  valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : null

function urlValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['www.mercadolivre.com.br', 'produto.mercadolivre.com.br'].includes(url.hostname.toLowerCase())
      && url.pathname !== '/'
  } catch { return false }
}

export function identificacaoLote(produtos: readonly Pick<ProdutoSnapshot, 'posicaoGerador' | 'itemId' | 'urlNormalizada'>[]): string {
  let hash = 2166136261
  for (const produto of produtos) {
    for (const caractere of `${produto.posicaoGerador}|${produto.itemId}|${produto.urlNormalizada}\n`) {
      hash ^= caractere.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase()
}

function congelar<T>(valor: T): T {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.values(valor).forEach(congelar)
    Object.freeze(valor)
  }
  return valor
}

export function criarRegistroSnapshot(lista: ResultadoListaAfiliados, origemLista = '', agora = new Date()): RegistroSnapshot {
  const produtos = lista.produtos.filter((produto): produto is ProdutoListaAfiliados & { urlNormalizada: string } =>
    produto.urlNormalizada !== null).map((produto, indice) => ({ ...produto,
    ...(produto.dadosPublicacao ? { dadosPublicacao: JSON.parse(JSON.stringify(produto.dadosPublicacao)) as ProdutoSnapshot['dadosPublicacao'] } : {}),
    posicaoGerador: indice + 1 }))
  if (!produtos.length) throw new Error('Nenhuma URL válida para preparar o lote do Gerador.')
  const identificacao = identificacaoLote(produtos)
  const snapshot: SnapshotLote = {
    snapshotId: `${agora.getTime().toString(36)}-${identificacao}`,
    createdAt: agora.toISOString(), origemLista: origemLista.trim() || null,
    quantidade: produtos.length, identificacao,
    urlsParaGerador: produtos.map((produto) => produto.urlNormalizada).join('\n'),
    produtos,
  }
  const registro: RegistroSnapshot = { schemaVersion: 1, snapshot, status: 'AGUARDANDO RETORNO',
    retornoTexto: null, linksConcluidos: [], novosConcluidos: [], categorias: {} }
  if (!validarRegistroSnapshot(registro)) throw new Error('A lista não pôde formar um snapshot válido.')
  return congelar(registro)
}

export function criarRegistrosSnapshot(lista: ResultadoListaAfiliados, origemLista = '', agora = new Date()): RegistroSnapshot[] {
  const produtos = lista.produtos.filter((produto) => produto.urlNormalizada !== null)
  if (!produtos.length) throw new Error('Nenhuma URL válida para preparar o lote do Gerador.')
  const lotes: RegistroSnapshot[] = []
  for (let inicio = 0; inicio < produtos.length; inicio += MAX_PRODUTOS_GERADOR) {
    const parte = produtos.slice(inicio, inicio + MAX_PRODUTOS_GERADOR)
    lotes.push(criarRegistroSnapshot({ ...lista, produtos: parte, urlsParaGerador: parte.map((produto) => produto.urlNormalizada!).join('\n') }, origemLista, agora))
  }
  return lotes
}

export function validarRegistrosSnapshot(valor: unknown): valor is RegistrosSnapshot {
  const registro = objeto(valor)
  if (registro?.schemaVersion !== 2 || !Array.isArray(registro.lotes) || registro.lotes.length <= 1
    || !registro.lotes.every((lote) => validarRegistroSnapshot(lote))) return false
  const ids = registro.lotes.flatMap((lote) => lote.snapshot.produtos.map((produto) => produto.itemId))
  return new Set(ids).size === ids.length
}

export function lerRegistrosSnapshot(armazenamento: Pick<Storage, 'getItem'>): { registros: RegistroSnapshot[]; invalido: boolean } {
  let bruto: string | null
  try { bruto = armazenamento.getItem(CHAVE_SNAPSHOT_LOTE) } catch { return { registros: [], invalido: true } }
  if (bruto === null) return { registros: [], invalido: false }
  try {
    const valor: unknown = JSON.parse(bruto)
    if (validarRegistroSnapshot(valor)) return { registros: [congelar(valor)], invalido: false }
    if (validarRegistrosSnapshot(valor)) return { registros: valor.lotes.map(congelar), invalido: false }
    return { registros: [], invalido: true }
  } catch { return { registros: [], invalido: true } }
}

export function salvarRegistrosSnapshot(armazenamento: Pick<Storage, 'setItem'>, registros: readonly RegistroSnapshot[]): RegistroSnapshot[] {
  if (!registros.length || registros.some((registro) => !validarRegistroSnapshot(registro))) throw new Error('Snapshot inválido; nenhuma alteração foi salva.')
  const valor: unknown = registros.length === 1 ? registros[0] : { schemaVersion: 2, lotes: registros }
  armazenamento.setItem(CHAVE_SNAPSHOT_LOTE, JSON.stringify(valor))
  return registros.map(congelar)
}

export function validarRegistroSnapshot(valor: unknown): valor is RegistroSnapshot {
  const registro = objeto(valor)
  const snapshot = objeto(registro?.snapshot)
  if (!registro || !snapshot || registro.schemaVersion !== 1
    || !['AGUARDANDO RETORNO', 'RETORNO PROCESSADO', 'FINALIZADO'].includes(String(registro.status))
    || typeof snapshot.snapshotId !== 'string' || !snapshot.snapshotId
    || typeof snapshot.createdAt !== 'string' || Number.isNaN(Date.parse(snapshot.createdAt))
    || snapshot.origemLista !== null && typeof snapshot.origemLista !== 'string'
    || !Array.isArray(snapshot.produtos) || snapshot.produtos.length === 0
    || snapshot.quantidade !== snapshot.produtos.length
    || typeof snapshot.identificacao !== 'string' || typeof snapshot.urlsParaGerador !== 'string'
    || registro.retornoTexto !== null && typeof registro.retornoTexto !== 'string'
    || registro.status === 'AGUARDANDO RETORNO' && registro.retornoTexto !== null
    || registro.status !== 'AGUARDANDO RETORNO' && typeof registro.retornoTexto !== 'string'
    || !Array.isArray(registro.linksConcluidos) || !Array.isArray(registro.novosConcluidos)
    || !objeto(registro.categorias)) return false
  const ids = new Set<string>()
  let ordemAnterior = 0
  for (let indice = 0; indice < snapshot.produtos.length; indice++) {
    const produto = objeto(snapshot.produtos[indice])
    if (!produto || produto.posicaoGerador !== indice + 1 || !Number.isSafeInteger(produto.ordem)
      || (produto.ordem as number) <= ordemAnterior || typeof produto.itemId !== 'string'
      || !/^MLB\d+$/.test(produto.itemId) || ids.has(produto.itemId)
      || !urlValida(produto.urlNormalizada)
      || produto.titulo !== null && typeof produto.titulo !== 'string') return false
    ids.add(produto.itemId)
    ordemAnterior = produto.ordem as number
    if (produto.dadosPublicacao !== undefined) {
      const dados = objeto(produto.dadosPublicacao)
      if (!dados || dados.itemId !== produto.itemId
        || dados.titulo !== null && typeof dados.titulo !== 'string'
        || dados.precoAtual !== null && typeof dados.precoAtual !== 'number'
        || dados.imagemUrl !== null && typeof dados.imagemUrl !== 'string') return false
    }
  }
  const produtos = snapshot.produtos as ProdutoSnapshot[]
  if (snapshot.identificacao !== identificacaoLote(produtos)
    || snapshot.urlsParaGerador !== produtos.map((produto) => produto.urlNormalizada).join('\n')) return false
  if ([...registro.linksConcluidos, ...registro.novosConcluidos].some((id) => typeof id !== 'string' || !ids.has(id))) return false
  const categorias = registro.categorias as Record<string, unknown>
  if (Object.entries(categorias).some(([id, categoria]) => !ids.has(id) || !CATEGORIAS_VALIO.includes(categoria as CategoriaValio))) return false
  if (registro.status === 'FINALIZADO') {
    if (typeof registro.retornoTexto !== 'string') return false
    const retorno = processarRetornoGerador(produtos, registro.retornoTexto)
    const concluidos = new Set([...registro.linksConcluidos, ...registro.novosConcluidos])
    if (!retorno.consistente || retorno.pareamentos.some((item) => item.retorno?.tipo === 'LINK' && !concluidos.has(item.produto.itemId))) return false
  }
  return true
}

export function lerRegistroSnapshot(armazenamento: Pick<Storage, 'getItem'>): { registro: RegistroSnapshot | null; invalido: boolean } {
  let bruto: string | null
  try { bruto = armazenamento.getItem(CHAVE_SNAPSHOT_LOTE) } catch { return { registro: null, invalido: true } }
  if (bruto === null) return { registro: null, invalido: false }
  try {
    const valor: unknown = JSON.parse(bruto)
    return validarRegistroSnapshot(valor) ? { registro: congelar(valor), invalido: false } : { registro: null, invalido: true }
  } catch { return { registro: null, invalido: true } }
}

export function salvarRegistroSnapshot(armazenamento: Pick<Storage, 'setItem'>, registro: RegistroSnapshot): RegistroSnapshot {
  if (!validarRegistroSnapshot(registro)) throw new Error('Snapshot inválido; nenhuma alteração foi salva.')
  armazenamento.setItem(CHAVE_SNAPSHOT_LOTE, JSON.stringify(registro))
  return congelar(registro)
}

export function removerRegistroSnapshot(armazenamento: Pick<Storage, 'removeItem'>): void {
  armazenamento.removeItem(CHAVE_SNAPSHOT_LOTE)
}

export function atualizarStatusSnapshot(registro: RegistroSnapshot, alteracoes: Partial<Omit<RegistroSnapshot, 'schemaVersion' | 'snapshot'>>): RegistroSnapshot {
  const proximo = { ...registro, ...alteracoes }
  if (proximo.status !== 'AGUARDANDO RETORNO' && typeof proximo.retornoTexto === 'string') {
    const retorno = processarRetornoGerador(proximo.snapshot.produtos, proximo.retornoTexto)
    const concluidos = new Set([...proximo.linksConcluidos, ...proximo.novosConcluidos])
    if (retorno.consistente && retorno.pareamentos.every((item) => item.retorno?.tipo !== 'LINK' || concluidos.has(item.produto.itemId))) {
      proximo.status = 'FINALIZADO'
    } else proximo.status = 'RETORNO PROCESSADO'
  }
  if (!validarRegistroSnapshot(proximo)) throw new Error('Não foi possível atualizar o snapshot.')
  return congelar(proximo)
}
