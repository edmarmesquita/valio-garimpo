import type { DiagnosticoInativo } from './recuperarInativos'
import type { CategoriaValio } from './produtosGarimpados'

export type PedidoReativacao = { mercado_livre_id: string; item_id_capturado: string; preco: number; moeda: 'BRL' }
export type ResultadoReativacao = { mercado_livre_id: string; status: 'REATIVADO' | 'ERRO'; motivo?: string }

export function selecionarExatos(diagnostico: DiagnosticoInativo[], ids: ReadonlySet<string>): DiagnosticoInativo[] {
  return diagnostico.filter((item) => item.tipo === 'EXATO' && item.exato?.itemId === item.inativo.mercadoLivreId
    && ids.has(item.inativo.mercadoLivreId))
}

export function pedidosDosExatos(itens: DiagnosticoInativo[]): PedidoReativacao[] {
  return itens.map((item) => ({ mercado_livre_id: item.inativo.mercadoLivreId,
    item_id_capturado: item.exato!.itemId, preco: item.exato!.preco, moeda: 'BRL' }))
}

export async function reativarExatos(token: string, produtos: PedidoReativacao[]): Promise<ResultadoReativacao[]> {
  const resultados: ResultadoReativacao[] = []
  for (let inicio = 0; inicio < produtos.length; inicio += 100) {
    const resposta = await fetch('/api/valio/produtos/reativar-inativos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ produtos: produtos.slice(inicio, inicio + 100) }),
    })
    const corpo = await resposta.json()
    if (!resposta.ok || !corpo.ok || !Array.isArray(corpo.resultados)) {
      throw new Error(corpo.erro || `Falha no sublote ${Math.floor(inicio / 100) + 1}.`)
    }
    resultados.push(...corpo.resultados)
  }
  return resultados
}

export type PedidoSubstituicao = {
  id_interno: number; item_id_anterior: string; mercado_livre_id: string; titulo: string
  descricao: string; preco: number; moeda: 'BRL'; imagem: string; link_afiliado: string
  categoria: CategoriaValio
}

export async function substituirInativo(token: string, pedido: PedidoSubstituicao): Promise<void> {
  if (!Number.isSafeInteger(pedido.id_interno) || !/^MLB\d+$/.test(pedido.item_id_anterior)
    || !/^MLB\d+$/.test(pedido.mercado_livre_id) || pedido.item_id_anterior === pedido.mercado_livre_id
    || !pedido.titulo.trim() || !Number.isFinite(pedido.preco) || pedido.preco <= 0 || pedido.moeda !== 'BRL'
    || !/^https:\/\//i.test(pedido.imagem) || !/^https:\/\//i.test(pedido.link_afiliado)) {
    throw new Error('Revise os dados do candidato e informe um link afiliado e uma imagem HTTPS.')
  }
  const resposta = await fetch('/api/valio/produtos/substituir-inativo', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirmar: true, ...pedido }),
  })
  const corpo = await resposta.json()
  if (!resposta.ok || !corpo.ok || corpo.id_interno !== pedido.id_interno
    || corpo.mercado_livre_id !== pedido.mercado_livre_id) {
    throw new Error(corpo.erro || 'A API não confirmou a substituição do produto.')
  }
}
