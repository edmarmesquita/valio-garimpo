import { CATEGORIAS_VALIO, type CategoriaValio } from '../../lib/produtosGarimpados'
import type { ProdutoExistente } from '../../lib/verificarProdutosValio'
import type { OfertaExtraida } from './extrairOfertas'
import type { ResultadoRetornoGerador } from '../importar-lista-afiliados/processarRetornoGerador'
import type { ResultadoConfirmacaoOfertas } from '../../lib/ofertasRelampagoApi'
import { processarRetornoGerador } from '../importar-lista-afiliados/processarRetornoGerador'
import { prepararOfertasSelecionadas } from './prepararOfertas'

export const CHAVE_LOTE_PREPARADO = 'valio-garimpa:flash-prepared-batch:v1'
export type StatusLotePreparado = 'PREPARADO' | 'REVALIDAÇÃO NECESSÁRIA' | 'REVALIDADO' | 'PARCIALMENTE BLOQUEADO' | 'FINALIZADO'
type EstadoValio = Pick<ProdutoExistente, 'titulo' | 'preco' | 'categoria' | 'imagem' | 'ativo'> & { linkMeli: string | null }
export type ItemPreparado = {
  itemId: string; titulo: string | null; imagem: string | null; categoria: CategoriaValio | null
  prioridade: number; precoAtual: number | null; precoAnterior: number | null; percentualDesconto: number | null
  ofertaInicio: string | null; ofertaFim: string | null; textoOferta: string | null; urlOriginal: string | null
  linkMeli: string | null; situacaoValio: 'EXISTENTE' | 'NOVO' | 'NÃO VERIFICADO'
  situacaoOferta: OfertaExtraida['situacao']
  estadoValio: EstadoValio | null; desativar: boolean; concluido: boolean
}
export type LotePreparado = { schemaVersion: 1; salvoEm: string; status: StatusLotePreparado; itens: ItemPreparado[] }
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export const meliValidoPreparado = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/meli\.la\/[a-z0-9_-]+\/?$/i.test(v)
const textoOuNull = (v: unknown) => v === null || typeof v === 'string'
const numeroOuNull = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v)
const dataOuNull = (v: unknown) => v === null || typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
const chaves = (v: Record<string, unknown>, permitidas: string[]) => Object.keys(v).length === permitidas.length && Object.keys(v).every((k) => permitidas.includes(k))
const camposItem = ['itemId', 'titulo', 'imagem', 'categoria', 'prioridade', 'precoAtual', 'precoAnterior', 'percentualDesconto', 'ofertaInicio', 'ofertaFim', 'textoOferta', 'urlOriginal', 'linkMeli', 'situacaoValio', 'situacaoOferta', 'estadoValio', 'desativar', 'concluido']
function estado(produto: ProdutoExistente): EstadoValio {
  return { titulo: produto.titulo ?? '', preco: produto.preco ?? 0, categoria: produto.categoria ?? '',
    imagem: produto.imagem ?? '', ativo: produto.ativo ?? true, linkMeli: meliValidoPreparado(produto.linkAfiliado) ? produto.linkAfiliado : null } as EstadoValio
}

export function validarLotePreparado(v: unknown): v is LotePreparado {
  if (!objeto(v) || !chaves(v, ['schemaVersion', 'salvoEm', 'status', 'itens']) || v.schemaVersion !== 1
    || typeof v.salvoEm !== 'string' || !Number.isFinite(Date.parse(v.salvoEm))
    || !['PREPARADO', 'REVALIDAÇÃO NECESSÁRIA', 'REVALIDADO', 'PARCIALMENTE BLOQUEADO', 'FINALIZADO'].includes(String(v.status))
    || !Array.isArray(v.itens) || !v.itens.length || v.itens.length > 500) return false
  const ids = new Set<string>()
  for (const item of v.itens) {
    if (!objeto(item) || !chaves(item, camposItem) || typeof item.itemId !== 'string' || !/^MLB\d+$/.test(item.itemId) || ids.has(item.itemId)
      || ![item.titulo, item.imagem, item.textoOferta, item.urlOriginal].every(textoOuNull)
      || ![item.precoAtual, item.precoAnterior, item.percentualDesconto].every(numeroOuNull)
      || ![item.ofertaInicio, item.ofertaFim].every(dataOuNull) || ![0, 50, 100].includes(Number(item.prioridade)) || typeof item.prioridade !== 'number'
      || item.categoria !== null && !CATEGORIAS_VALIO.includes(item.categoria as CategoriaValio)
      || item.linkMeli !== null && !meliValidoPreparado(item.linkMeli)
      || !['EXISTENTE', 'NOVO', 'NÃO VERIFICADO'].includes(String(item.situacaoValio))
      || !['PRONTO', 'SEM ITEM_ID', 'SEM PREÇO', 'REVISAR'].includes(String(item.situacaoOferta))
      || typeof item.desativar !== 'boolean' || typeof item.concluido !== 'boolean') return false
    if (item.estadoValio !== null) {
      const e = item.estadoValio
      if (!objeto(e) || !chaves(e, ['titulo', 'preco', 'categoria', 'imagem', 'ativo', 'linkMeli'])
        || typeof e.titulo !== 'string' || typeof e.preco !== 'number' || !Number.isFinite(e.preco)
        || typeof e.categoria !== 'string' || typeof e.imagem !== 'string' || typeof e.ativo !== 'boolean'
        || e.linkMeli !== null && !meliValidoPreparado(e.linkMeli)) return false
    }
    ids.add(item.itemId)
  }
  return v.status !== 'FINALIZADO' || v.itens.every((item: ItemPreparado) => item.concluido)
}

export function lerLotePreparado(storage: Pick<Storage, 'getItem'>): { lote: LotePreparado | null; invalido: boolean } {
  try {
    const bruto = storage.getItem(CHAVE_LOTE_PREPARADO)
    if (bruto === null) return { lote: null, invalido: false }
    const lote: unknown = JSON.parse(bruto)
    return validarLotePreparado(lote) ? { lote, invalido: false } : { lote: null, invalido: true }
  } catch { return { lote: null, invalido: true } }
}

export function salvarLotePreparado(storage: Pick<Storage, 'setItem'>, lote: LotePreparado) {
  if (!validarLotePreparado(lote)) throw new Error('Lote preparado inválido; nenhuma alteração foi salva.')
  storage.setItem(CHAVE_LOTE_PREPARADO, JSON.stringify(lote))
}

export function criarLotePreparado(ofertas: OfertaExtraida[], selecionados: ReadonlySet<string>, categorias: ReadonlyMap<string, CategoriaValio>,
  prioridades: ReadonlyMap<string, number>, existentes: ReadonlyMap<string, ProdutoExistente>, verificados: ReadonlySet<string>,
  retorno: ResultadoRetornoGerador | null, desativadas: ReadonlySet<string>, agora = new Date()): LotePreparado {
  const links = new Map(retorno?.consistente ? retorno.pareamentos.map((p) => [p.produto.itemId, p.retorno?.link]) : [])
  const itens = ofertas.filter((o) => selecionados.has(o.chave)).map((o): ItemPreparado => {
    if (!o.itemId) throw new Error('O lote preparado exige ITEM_ID em todos os itens selecionados.')
    const existente = existentes.get(o.itemId)
    const link = links.get(o.itemId) ?? existente?.linkAfiliado
    return { itemId: o.itemId, titulo: o.titulo, imagem: o.imagem, categoria: categorias.get(o.itemId) ?? existente?.categoria ?? null,
      prioridade: prioridades.get(o.chave) ?? 0, precoAtual: o.precoAtual, precoAnterior: o.precoAnterior,
      percentualDesconto: o.percentualDesconto, ofertaInicio: o.ofertaInicio, ofertaFim: o.ofertaFim, textoOferta: o.textoOferta,
      urlOriginal: o.urlOriginal, linkMeli: meliValidoPreparado(link) ? link : null,
      situacaoValio: !verificados.has(o.itemId) ? 'NÃO VERIFICADO' : existente ? 'EXISTENTE' : 'NOVO',
      situacaoOferta: o.situacao,
      estadoValio: existente ? estado(existente) : null, desativar: desativadas.has(o.chave), concluido: false }
  })
  const lote: LotePreparado = { schemaVersion: 1, salvoEm: agora.toISOString(), status: 'PREPARADO', itens }
  if (!validarLotePreparado(lote)) throw new Error('Selecione entre 1 e 500 produtos com dados válidos para salvar o lote.')
  return lote
}

function ofertaDoItem(item: ItemPreparado, posicao: number): OfertaExtraida {
  return { chave: item.itemId, itemId: item.itemId, posicao, titulo: item.titulo, imagem: item.imagem,
    precoAtual: item.precoAtual, precoAnterior: item.precoAnterior, percentualDesconto: item.percentualDesconto,
    ofertaInicio: item.ofertaInicio, ofertaFim: item.ofertaFim, textoOferta: item.textoOferta, urlOriginal: item.urlOriginal,
    userProductId: null, productId: null, fonteDesconto: null, tempoRestanteOriginal: null, fonteTempo: null,
    situacao: item.situacaoOferta, dadosProduto: null }
}

export function payloadLotePreparado(itens: ItemPreparado[], existentes: ReadonlyMap<string, ProdutoExistente>) {
  const novos = itens.filter((item) => !existentes.has(item.itemId))
  const produtos = novos.map((item, i) => ({ ordem: i + 1, itemId: item.itemId, titulo: item.titulo,
    userProductId: null, productId: null, pid: null, pidExtended: null, urlOriginal: item.urlOriginal,
    urlNormalizada: item.urlOriginal, urlParams: null, urlFragments: null }))
  const retorno = processarRetornoGerador(produtos, novos.map((item) => item.linkMeli ?? 'REVISAR').join('\n'))
  const ids = new Set(itens.map((item) => item.itemId))
  return prepararOfertasSelecionadas(itens.map(ofertaDoItem), ids, existentes, ids,
    new Map(itens.flatMap((item) => item.categoria ? [[item.itemId, item.categoria] as const] : [])), retorno,
    new Map(itens.map((item) => [item.itemId, item.prioridade])), new Set(itens.filter((item) => item.desativar).map((item) => item.itemId)))
}

export function revalidarLotePreparado(lote: LotePreparado, existentes: ReadonlyMap<string, ProdutoExistente>, agora = Date.now()) {
  const bloqueados: { itemId: string; motivo: string }[] = []
  for (const item of lote.itens.filter((item) => !item.concluido)) {
    const atual = existentes.get(item.itemId)
    let motivo = item.ofertaFim && Date.parse(item.ofertaFim) <= agora ? 'Oferta expirada.' : ''
    if (!motivo && (item.precoAtual === null || item.precoAtual <= 0
      || item.precoAnterior !== null && item.precoAnterior <= 0
      || item.percentualDesconto !== null && (item.percentualDesconto < 0 || item.percentualDesconto > 100))) motivo = 'Preço ou desconto inconsistente.'
    if (!motivo && item.ofertaInicio && item.ofertaFim && Date.parse(item.ofertaInicio) >= Date.parse(item.ofertaFim)) motivo = 'Período da oferta inconsistente.'
    if (!motivo && item.situacaoValio === 'NOVO' && atual) motivo = 'Produto passou a existir no Valiô. Revise o estado no fluxo atual; nenhuma informação será sobrescrita.'
    if (!motivo && item.situacaoValio === 'EXISTENTE' && (!atual || JSON.stringify(item.estadoValio) !== JSON.stringify(estado(atual)))) motivo = 'Estado do produto no Valiô mudou desde o salvamento. Revise antes de publicar.'
    if (!motivo && atual && !atual.ativo) motivo = 'Produto inativo no catálogo; a oferta não pode ativar o produto.'
    if (!motivo) motivo = payloadLotePreparado([item], existentes).bloqueados[0]?.motivo ?? ''
    if (motivo) bloqueados.push({ itemId: item.itemId, motivo })
  }
  const finalizado = lote.itens.every((item) => item.concluido)
  return { lote: { ...lote, status: finalizado ? 'FINALIZADO' : bloqueados.length ? 'PARCIALMENTE BLOQUEADO' : 'REVALIDADO' } as LotePreparado, bloqueados }
}

export function concluirItensPreparados(lote: LotePreparado, resultado: ResultadoConfirmacaoOfertas): LotePreparado {
  const itens = lote.itens.map((item) => {
    const respostas = resultado.itens.filter((r) => r.itemId === item.itemId)
    return { ...item, concluido: item.concluido || respostas.length === 1
      && ['CRIADA', 'ATIVAR', 'ATUALIZAR', 'DESATIVAR', 'SEM ALTERAÇÃO'].includes(respostas[0].resultado) }
  })
  return { ...lote, itens, status: itens.every((item) => item.concluido) && !resultado.erros && !resultado.conflitos ? 'FINALIZADO' : 'REVALIDAÇÃO NECESSÁRIA' }
}
