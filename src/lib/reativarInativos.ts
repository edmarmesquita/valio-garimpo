import type { DiagnosticoInativo } from './recuperarInativos'

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
