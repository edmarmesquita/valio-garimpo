import { createHmac, timingSafeEqual } from 'node:crypto'
import { classificarPrecoAfiliado } from '../src/lib/classificarPrecoAfiliado.js'
import type { PedidoPrecoHar, RevalidacaoHar, ResultadoPrecoHar, StatusPrecoHar } from '../src/lib/atualizacaoHarTipos.js'

export type LinhaPrecoHar = { mercado_livre_id: string; titulo: string; preco: number; ativo: boolean
  oferta_relampago: boolean; oferta_inicio: string | null; oferta_fim: string | null }
export type PrecosHarGateway = { buscar: (id: string) => Promise<LinhaPrecoHar[]>;
  atualizar: (anterior: LinhaPrecoHar, novoPreco: number) => Promise<number> }
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const exatas = (v: Record<string, unknown>, nomes: string[]) => Object.keys(v).length === nomes.length && nomes.every((n) => Object.hasOwn(v, n))
// Dinheiro deve ser representável em centavos, sem truncar entradas ambíguas.
const dinheiro = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001
export function validarPedidoHar(valor: unknown): PedidoPrecoHar[] {
  const p = obj(valor)
  if (!p || !exatas(p, ['fonte', 'versao', 'itens']) || typeof p.versao !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(p.versao) || p.fonte !== 'api' || !Array.isArray(p.itens) || !p.itens.length || p.itens.length > 100) throw new Error('Pedido HAR inválido; use catálogo API e de 1 a 100 itens.')
  const ids = new Set<string>()
  return p.itens.map((v) => {
    const i = obj(v); const e = obj(i?.evidencia)
    if (!i || !e || !exatas(i, ['itemId', 'precoBase', 'novoPreco', 'classificacao', 'evidencia'])
      || !exatas(e, ['moeda', 'labels', 'precoAnterior', 'conflito'])
      || typeof i.itemId !== 'string' || !/^MLB\d+$/.test(i.itemId) || ids.has(i.itemId)
      || !dinheiro(i.precoBase) || !dinheiro(i.novoPreco) || i.precoBase === i.novoPreco
      || typeof i.classificacao !== 'string' || i.classificacao.length > 40
      || typeof e.moeda !== 'string' || e.moeda.length > 10 || typeof e.conflito !== 'boolean'
      || !Array.isArray(e.labels) || !e.labels.length || e.labels.length > 20
      || e.labels.some((l) => typeof l !== 'string' || l.length > 200)
      || e.precoAnterior !== null && !dinheiro(e.precoAnterior)) throw new Error('Item HAR inválido ou duplicado.')
    ids.add(i.itemId)
    return v as PedidoPrecoHar
  })
}
function ofertaProtegida(p: LinhaPrecoHar, agora: number): boolean {
  if (p.oferta_relampago === false) return false
  if (p.oferta_relampago !== true || !p.oferta_fim) return true
  // Datas sem horário incluem o dia final em Brasília. Datas inválidas são bloqueadas.
  function instante(v: string | null, final = false): number | null {
    if (!v) return null
    const calendario = /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0]
    if (!calendario || !Number.isFinite(Date.parse(`${calendario}T00:00:00Z`))
      || new Date(`${calendario}T00:00:00Z`).toISOString().slice(0, 10) !== calendario) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(`${v}T00:00:00-03:00`)
      if (!Number.isFinite(d.getTime()) || new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10) !== v) return null
      return d.getTime() + (final ? 86400000 : 0)
    }
    return /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null
  }
  const fim = instante(p.oferta_fim, true); const inicio = instante(p.oferta_inicio)
  return fim === null || Boolean(p.oferta_inicio && inicio === null) || (inicio !== null && inicio >= fim) || fim > agora
}
export function bloqueioPrecoHar(i: PedidoPrecoHar, atual: LinhaPrecoHar[], agora: number): { status: StatusPrecoHar; motivo: string } {
  if (!atual.length) return { status: 'BLOQUEADO_NAO_ENCONTRADO', motivo: 'ITEM_ID não encontrado.' }
  if (atual.length !== 1 || atual[0].mercado_livre_id !== i.itemId) return { status: 'ERRO', motivo: 'ITEM_ID ambíguo ou divergente.' }
  const p = atual[0]
  if (p.ativo !== true) return { status: 'BLOQUEADO_INATIVO', motivo: 'Produto não está ativo.' }
  if (!dinheiro(p.preco) || p.preco !== i.precoBase) return { status: 'BLOQUEADO_PRECO_ALTERADO', motivo: 'Preço atual não corresponde ao preço-base da prévia.' }
  if (ofertaProtegida(p, agora)) return { status: 'BLOQUEADO_OFERTA', motivo: 'Oferta ativa, agendada ou com dados inconclusivos.' }
  const base = Math.round(i.precoBase * 100); const novo = Math.round(i.novoPreco * 100)
  // BigInt evita arredondar +30,01% para 30% e mantém os limites exatos inclusivos.
  if (BigInt(Math.abs(novo - base)) * 100n > BigInt(base) * 30n) return { status: 'BLOQUEADO_VARIACAO_EXTREMA', motivo: 'Variação absoluta superior a 30%, sem override.' }
  const classes = i.evidencia.labels.map((l) => classificarPrecoAfiliado(l, i.novoPreco, i.evidencia.precoAnterior))
  if (i.evidencia.moeda !== 'BRL' || i.evidencia.conflito || !['NORMAL', 'DESCONTO'].includes(i.classificacao)
    || classes.some((c) => c !== i.classificacao)) return { status: 'BLOQUEADO_CLASSIFICACAO', motivo: 'Classificação, moeda ou evidência da captura não permite atualização.' }
  return { status: 'PRONTO', motivo: 'Revalidado no catálogo atual; aguardando confirmação.' }
}
export async function processarPrecosHar(itens: PedidoPrecoHar[], gateway: PrecosHarGateway, agora: () => number, gravar = false): Promise<ResultadoPrecoHar[]> {
  const resultados: ResultadoPrecoHar[] = []
  // Sequencial: um SELECT e no máximo um UPDATE condicional por item.
  for (const i of itens) {
    let titulo = ''
    try {
      const atuais = await gateway.buscar(i.itemId); titulo = atuais.length === 1 ? atuais[0].titulo : ''
      let r = bloqueioPrecoHar(i, atuais, agora())
      if (gravar && r.status === 'PRONTO') {
        const alterados = await gateway.atualizar(atuais[0], i.novoPreco)
        if (alterados === 1) r = { status: 'ATUALIZADO', motivo: 'Somente preco foi atualizado.' }
        else if (alterados === 0) {
          r = bloqueioPrecoHar(i, await gateway.buscar(i.itemId), agora())
          if (r.status === 'PRONTO') r = { status: 'ERRO', motivo: 'Condição concorrente mudou; nenhuma atualização confirmada.' }
        } else r = { status: 'ERRO', motivo: 'Quantidade inesperada de registros; interrompa e revise o catálogo.' }
      }
      resultados.push({ itemId: i.itemId, titulo, precoBase: i.precoBase, novoPreco: i.novoPreco, ...r })
    } catch { resultados.push({ itemId: i.itemId, titulo, precoBase: i.precoBase, novoPreco: i.novoPreco, status: 'ERRO', motivo: 'Falha na operação deste item; resultado de gravação não confirmado. Recarregue o catálogo antes de tentar novamente.' }) }
  }
  return resultados
}
// Mesmo padrão HMAC das prévias de ofertas, com finalidade distinta e expiração curta.
export function assinarPreviaHar(p: RevalidacaoHar, segredo: string): string {
  return createHmac('sha256', segredo).update('precos-har-v1:' + JSON.stringify(p)).digest('hex')
}
export function assinaturaHarValida(p: unknown, assinatura: unknown, segredo: string, agora: number): p is RevalidacaoHar {
  const o = obj(p)
  if (!o || o.finalidade !== 'precos-har-v1' || typeof o.versao !== 'string' || !/^[a-f0-9-]{36}$/i.test(o.versao) || o.fonte !== 'api' || typeof o.emitidaEm !== 'number'
    || o.emitidaEm > agora || agora - o.emitidaEm > 5 * 60_000 || typeof assinatura !== 'string' || !/^[a-f0-9]{64}$/.test(assinatura)) return false
  const esperado = assinarPreviaHar(p as RevalidacaoHar, segredo)
  return timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(assinatura, 'hex'))
}
