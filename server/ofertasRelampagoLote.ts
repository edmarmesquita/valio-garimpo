import { createHmac, timingSafeEqual } from 'node:crypto'
import { CATEGORIAS_VALIO, validarProdutoPublicacao } from './valioProduto.js'
import { mapearProdutoParaRow } from './services/supabase.js'

export type ModoOferta = 'ATIVAR' | 'DESATIVAR' | 'PRIORIDADE' | 'ENVIAR' | 'SUBSTITUIR'
type Registro = Record<string, unknown>
export type CamposOferta = {
  oferta_relampago: boolean; oferta_inicio: string | null; oferta_fim: string | null
  preco_anterior: number | null; percentual_desconto: number | null; texto_oferta: string | null
  prioridade_oferta: number
}
export type OfertaRow = CamposOferta & {
  mercado_livre_id: string; titulo: string; preco: number; categoria: string
  imagem: string; link_afiliado: string; ativo: boolean
}
export type AlteracaoOferta = Partial<CamposOferta>
export type NovoProdutoOferta = OfertaRow & {
  descricao: string; data_preco: string; rating: number | null; ativo: true; updated_at: string
}
export type OfertaGateway = {
  buscar: (id: string) => Promise<OfertaRow[]>
  listarAtivas: () => Promise<OfertaRow[]>
  atualizar: (id: string, anterior: OfertaRow, alteracao: AlteracaoOferta) => Promise<OfertaRow[]>
  inserir: (produto: NovoProdutoOferta) => Promise<void>
}
type Acao = 'ATIVAR' | 'DESATIVAR' | 'ATUALIZAR' | 'CRIAR COMO OFERTA' | 'SEM ALTERAÇÃO'
type PedidoItem = { tipo: 'ATUALIZAR_OFERTA' | 'NOVO_PRODUTO'; dados: Registro }
type Operacao = { itemId: string; produto: string; situacaoAtual: string; acao: Acao; prioridade: number
  precoAnterior: number | null; precoAtual: number; percentualDesconto: number | null; ofertaFim: string | null
  resultadoEsperado: string; tipo: PedidoItem['tipo']; dados: Registro; anterior: OfertaRow | null }
export type PreviaOfertas = { modo: ModoOferta; emitidaEm: number; operacoes: Operacao[]; desativarAtuais: number; ativarSelecionadas: number; ativasNaPrevia: string[] }
export type ResultadoOfertas = { criadas: number; ativadas: number; atualizadas: number; desativadas: number
  semAlteracao: number; conflitos: number; erros: number
  itens: { itemId: string; resultado: string; motivo?: string }[] }

const objeto = (valor: unknown): Registro | null => valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
const chaves = (valor: Registro, permitidas: readonly string[]) => Object.keys(valor).every((chave) => permitidas.includes(chave))
const idValido = (valor: unknown): valor is string => typeof valor === 'string' && /^MLB\d+$/.test(valor)
const urlHttps = (valor: unknown) => {
  if (typeof valor !== 'string') return false
  try { const url = new URL(valor); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}
const meliValido = (valor: unknown) => typeof valor === 'string' && /^https:\/\/meli\.la\/[a-z0-9_-]+\/?$/i.test(valor)
const instante = (valor: unknown) => valor === null || (typeof valor === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(valor)
  && Number.isFinite(Date.parse(valor)))
const prioridade = (valor: unknown) => valor === 0 || valor === 50 || valor === 100
const campos = ['ofertaRelampago', 'ofertaInicio', 'ofertaFim', 'precoAnterior', 'percentualDesconto', 'textoOferta', 'prioridadeOferta'] as const
const novos = ['titulo', 'preco', 'imagem', 'categoria', 'linkAfiliado'] as const

function validarItem(valor: unknown, modo: ModoOferta): PedidoItem {
  const item = objeto(valor)
  const dados = objeto(item?.dados)
  if (!item || !dados || !chaves(item, ['tipo', 'dados']) || !idValido(dados.mercadoLivreId)
    || !['ATUALIZAR_OFERTA', 'NOVO_PRODUTO'].includes(String(item.tipo))) throw new Error('Item de oferta inválido.')
  const tipo = item.tipo as PedidoItem['tipo']
  if (tipo === 'NOVO_PRODUTO' && !['ATIVAR', 'ENVIAR', 'SUBSTITUIR'].includes(modo)) throw new Error('Produto novo não é permitido nesta ação.')
  const desativar = modo === 'DESATIVAR' || modo === 'ENVIAR' && dados.ofertaRelampago === false
  if (desativar && tipo === 'NOVO_PRODUTO') throw new Error('Produto novo não pode ser desativado.')
  const permitidas = modo === 'PRIORIDADE' ? ['mercadoLivreId', 'prioridadeOferta']
    : desativar ? ['mercadoLivreId', 'ofertaRelampago']
      : ['mercadoLivreId', ...campos, ...(tipo === 'NOVO_PRODUTO' ? novos : [])]
  if (!chaves(dados, permitidas) || Object.keys(dados).length !== permitidas.length) throw new Error('O item contém campos não permitidos ou ausentes.')
  if (modo === 'PRIORIDADE') {
    if (!prioridade(dados.prioridadeOferta)) throw new Error('Prioridade inválida.')
  } else if (desativar) {
    if (dados.ofertaRelampago !== false) throw new Error('Desativação inválida.')
  } else {
    if (dados.ofertaRelampago !== true || !instante(dados.ofertaInicio) || !instante(dados.ofertaFim)
      || dados.precoAnterior !== null && (typeof dados.precoAnterior !== 'number' || !Number.isFinite(dados.precoAnterior) || dados.precoAnterior <= 0)
      || dados.percentualDesconto !== null && (typeof dados.percentualDesconto !== 'number' || !Number.isFinite(dados.percentualDesconto) || dados.percentualDesconto < 0 || dados.percentualDesconto > 100)
      || dados.textoOferta !== null && typeof dados.textoOferta !== 'string' || !prioridade(dados.prioridadeOferta)) throw new Error('Campos da oferta inválidos.')
    if (tipo === 'NOVO_PRODUTO' && (typeof dados.titulo !== 'string' || !dados.titulo.trim()
      || typeof dados.preco !== 'number' || !Number.isFinite(dados.preco) || dados.preco <= 0
      || !urlHttps(dados.imagem) || !CATEGORIAS_VALIO.includes(dados.categoria as typeof CATEGORIAS_VALIO[number])
      || !meliValido(dados.linkAfiliado))) throw new Error('Produto novo exige dados completos e link oficial meli.la.')
  }
  return { tipo, dados }
}

export function validarPedidoOfertas(valor: unknown): { modo: ModoOferta; itens: PedidoItem[] } {
  const pedido = objeto(valor)
  if (!pedido || !chaves(pedido, ['modo', 'itens']) || Object.keys(pedido).length !== 2
    || !['ATIVAR', 'DESATIVAR', 'PRIORIDADE', 'ENVIAR', 'SUBSTITUIR'].includes(String(pedido.modo))
    || !Array.isArray(pedido.itens) || pedido.itens.length < 1 || pedido.itens.length > 500) throw new Error('Lote de ofertas inválido.')
  const modo = pedido.modo as ModoOferta
  const itens = pedido.itens.map((item) => validarItem(item, modo))
  const ids = itens.map((item) => item.dados.mercadoLivreId)
  if (new Set(ids).size !== ids.length) throw new Error('ITEM_ID duplicado no lote.')
  return { modo, itens }
}

function alteracao(item: PedidoItem, modo: ModoOferta): AlteracaoOferta {
  const d = item.dados
  if (modo === 'DESATIVAR' || d.ofertaRelampago === false) return { oferta_relampago: false }
  if (modo === 'PRIORIDADE') return { prioridade_oferta: d.prioridadeOferta as number }
  return { oferta_relampago: true, oferta_inicio: d.ofertaInicio as string | null,
    oferta_fim: d.ofertaFim as string | null, preco_anterior: d.precoAnterior as number | null,
    percentual_desconto: d.percentualDesconto as number | null, texto_oferta: d.textoOferta as string | null,
    prioridade_oferta: d.prioridadeOferta as number }
}

function acaoPara(anterior: OfertaRow | null, item: PedidoItem, modo: ModoOferta): Acao {
  if (!anterior) return 'CRIAR COMO OFERTA'
  const mudancas = alteracao(item, modo)
  if (Object.entries(mudancas).every(([chave, valor]) => anterior[chave as keyof OfertaRow] === valor)) return 'SEM ALTERAÇÃO'
  if (modo === 'DESATIVAR' || item.dados.ofertaRelampago === false) return 'DESATIVAR'
  if (!anterior.oferta_relampago && modo !== 'PRIORIDADE') return 'ATIVAR'
  return 'ATUALIZAR'
}

function operacao(item: PedidoItem, anterior: OfertaRow | null, modo: ModoOferta): Operacao {
  const d = item.dados
  const acao = acaoPara(anterior, item, modo)
  const desativar = d.ofertaRelampago === false
  return { itemId: d.mercadoLivreId as string, produto: anterior?.titulo ?? d.titulo as string ?? 'Produto',
    situacaoAtual: anterior ? anterior.oferta_relampago ? 'OFERTA ATIVA' : 'PRODUTO SEM OFERTA' : 'NOVO PRODUTO',
    acao, prioridade: desativar ? anterior?.prioridade_oferta ?? 0 : d.prioridadeOferta as number,
    precoAnterior: desativar || modo === 'PRIORIDADE' ? anterior?.preco_anterior ?? null : d.precoAnterior as number | null,
    precoAtual: anterior?.preco ?? d.preco as number,
    percentualDesconto: desativar || modo === 'PRIORIDADE' ? anterior?.percentual_desconto ?? null : d.percentualDesconto as number | null,
    ofertaFim: desativar || modo === 'PRIORIDADE' ? anterior?.oferta_fim ?? null : d.ofertaFim as string | null,
    resultadoEsperado: acao === 'DESATIVAR' ? 'Sai da fila; produto permanece no catálogo.'
      : acao === 'SEM ALTERAÇÃO' ? 'Nenhuma gravação.'
        : acao === 'CRIAR COMO OFERTA' ? 'Produto novo criado como oferta.' : 'Campos de oferta atualizados.',
    tipo: item.tipo, dados: d, anterior }
}

export async function criarPreviaOfertas(valor: unknown, gateway: OfertaGateway, agora = Date.now()): Promise<PreviaOfertas> {
  const pedido = validarPedidoOfertas(valor)
  const operacoes: Operacao[] = []
  let ativasNaPrevia: string[] = []
  for (const item of pedido.itens) {
    const encontrados = await gateway.buscar(item.dados.mercadoLivreId as string)
    if (encontrados.length > 1) throw new Error('Mais de um produto corresponde ao ITEM_ID.')
    const anterior = encontrados[0] ?? null
    if (item.tipo === 'NOVO_PRODUTO' && anterior) throw new Error(`Produto ${item.dados.mercadoLivreId} já existe; atualize a verificação.`)
    if (item.tipo === 'ATUALIZAR_OFERTA' && !anterior) throw new Error(`Produto ${item.dados.mercadoLivreId} não existe; atualize a verificação.`)
    operacoes.push(operacao(item, anterior, pedido.modo))
  }
  if (pedido.modo === 'SUBSTITUIR') {
    const selecionados = new Set(operacoes.map((item) => item.itemId))
    const atuais = await gateway.listarAtivas()
    ativasNaPrevia = atuais.map((item) => item.mercado_livre_id).sort()
    for (const atual of atuais) {
      if (selecionados.has(atual.mercado_livre_id)) continue
      operacoes.push(operacao({ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: atual.mercado_livre_id, ofertaRelampago: false } }, atual, 'DESATIVAR'))
    }
  }
  return { modo: pedido.modo, emitidaEm: agora, operacoes, ativasNaPrevia,
    desativarAtuais: operacoes.filter((item) => item.acao === 'DESATIVAR').length,
    ativarSelecionadas: operacoes.filter((item) => item.acao === 'ATIVAR' || item.acao === 'CRIAR COMO OFERTA').length }
}

export function assinarPrevia(preview: PreviaOfertas, segredo: string): string {
  return createHmac('sha256', segredo).update('ofertas-relampago:v1:').update(JSON.stringify(preview)).digest('hex')
}

export function validarAssinatura(preview: unknown, assinatura: unknown, segredo: string, agora = Date.now()): preview is PreviaOfertas {
  if (!objeto(preview) || typeof assinatura !== 'string' || !/^[a-f0-9]{64}$/.test(assinatura)) return false
  const emitida = (preview as Registro).emitidaEm
  if (typeof emitida !== 'number' || !Number.isSafeInteger(emitida) || emitida > agora || agora - emitida > 600_000) return false
  const esperado = Buffer.from(assinarPrevia(preview as PreviaOfertas, segredo), 'hex')
  return timingSafeEqual(Buffer.from(assinatura, 'hex'), esperado)
}

const mesmoEstado = (a: OfertaRow, b: OfertaRow) => (Object.keys(b) as (keyof OfertaRow)[])
  .every((campo) => a[campo] === b[campo])
function camposTecnicosSeguros(erro: unknown, segredos: readonly string[]) {
  const registro = objeto(erro)
  const limpar = (valor: unknown) => {
    if (typeof valor !== 'string') return ''
    let texto = valor.replace(/[\r\n\t]+/g, ' ')
      .replace(/Bearer\s+\S+/gi, '[redigido]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redigido]')
      .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi, '[redigido]')
    for (const segredo of segredos) if (segredo.length >= 8) texto = texto.replaceAll(segredo, '[redigido]')
    return texto.slice(0, 500)
  }
  const code = limpar(registro?.code)
  return { code: /^[A-Z0-9_]{1,32}$/i.test(code) ? code : '',
    message: limpar(registro?.message ?? (erro instanceof Error ? erro.message : '')),
    details: limpar(registro?.details), hint: limpar(registro?.hint) }
}

export async function confirmarPreviaOfertas(preview: PreviaOfertas, gateway: OfertaGateway,
  agora = new Date(), segredos: readonly string[] = []): Promise<ResultadoOfertas> {
  const resumo: ResultadoOfertas = { criadas: 0, ativadas: 0, atualizadas: 0, desativadas: 0,
    semAlteracao: 0, conflitos: 0, erros: 0, itens: [] }
  if (preview.modo === 'SUBSTITUIR') {
    const ativasAgora = (await gateway.listarAtivas()).map((item) => item.mercado_livre_id).sort()
    if (JSON.stringify(ativasAgora) !== JSON.stringify(preview.ativasNaPrevia)) {
      resumo.conflitos = preview.operacoes.length
      resumo.itens = preview.operacoes.map((op) => ({ itemId: op.itemId, resultado: 'CONFLITO',
        motivo: 'A fila ativa mudou desde a prévia; consulte novamente.' }))
      return resumo
    }
  }
  for (const op of preview.operacoes) {
    try {
      const encontrados = await gateway.buscar(op.itemId)
      if (encontrados.length > 1 || Boolean(encontrados[0]) !== Boolean(op.anterior)
        || op.anterior && !mesmoEstado(encontrados[0], op.anterior)) {
        resumo.conflitos++; resumo.itens.push({ itemId: op.itemId, resultado: 'CONFLITO', motivo: 'Produto mudou desde a prévia.' }); continue
      }
      if (op.acao === 'SEM ALTERAÇÃO') {
        resumo.semAlteracao++; resumo.itens.push({ itemId: op.itemId, resultado: 'SEM ALTERAÇÃO' }); continue
      }
      if (!op.anterior) {
        const d = op.dados
        const dataPreco = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
          day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora)
        const produto = validarProdutoPublicacao({ mercadoLivreId: op.itemId, titulo: d.titulo,
          descricao: '', preco: d.preco, dataPreco, linkAfiliado: d.linkAfiliado,
          categoria: d.categoria, rating: null, imagem: d.imagem })
        await gateway.inserir({ ...mapearProdutoParaRow(produto, agora),
          ...alteracao({ tipo: op.tipo, dados: d }, preview.modo) } as NovoProdutoOferta)
        resumo.criadas++; resumo.itens.push({ itemId: op.itemId, resultado: 'CRIADA' }); continue
      }
      const atualizado = await gateway.atualizar(op.itemId, op.anterior,
        alteracao({ tipo: op.tipo, dados: op.dados }, op.acao === 'DESATIVAR' ? 'DESATIVAR' : preview.modo))
      if (atualizado.length !== 1 || atualizado[0].mercado_livre_id !== op.itemId) {
        resumo.conflitos++; resumo.itens.push({ itemId: op.itemId, resultado: 'CONFLITO', motivo: 'Atualização concorrente.' }); continue
      }
      if (op.acao === 'ATIVAR') resumo.ativadas++
      else if (op.acao === 'DESATIVAR') resumo.desativadas++
      else resumo.atualizadas++
      resumo.itens.push({ itemId: op.itemId, resultado: op.acao })
    } catch (erro) {
      if ((erro as { code?: string })?.code === '23505') {
        resumo.conflitos++; resumo.itens.push({ itemId: op.itemId, resultado: 'CONFLITO', motivo: 'Produto já existe.' })
      } else {
        const campos = camposTecnicosSeguros(erro, segredos)
        console.error('Falha ao gravar oferta no Valiô', { itemId: op.itemId, ...campos })
        const motivo = Object.entries(campos).filter(([, valor]) => valor).map(([campo, valor]) => `${campo}: ${valor}`).join(' | ')
        resumo.erros++; resumo.itens.push({ itemId: op.itemId, resultado: 'ERRO',
          motivo: motivo || 'Falha ao gravar a oferta.' })
      }
    }
  }
  return resumo
}
