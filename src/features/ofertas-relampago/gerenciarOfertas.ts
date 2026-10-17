export type OfertaPublicada = {
  mercado_livre_id: string; titulo: string; imagem: string; categoria: string; preco: number
  ativo: boolean; oferta_relampago: boolean; oferta_inicio: string | null; oferta_fim: string | null
  preco_anterior: number | null; percentual_desconto: number | null; prioridade_oferta: number
  home_oferta_mode?: 'auto' | 'fixada' | 'fila'; controle_home_disponivel?: boolean
}

// Mesma semântica de valio/src/lib/ofertasRelampago.ts: datas sem horário
// incluem o dia final; timestamps precisam de fuso explícito.
export function instanteOferta(valor: string | null, fim = false): number | null {
  if (!valor) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(valor)) {
    const tempo = Date.parse(valor)
    return Number.isFinite(tempo) ? tempo : null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null
  const [ano, mes, dia] = valor.split('-').map(Number)
  const data = new Date(ano, mes - 1, dia)
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null
  return new Date(ano, mes - 1, dia + (fim ? 1 : 0)).getTime()
}

export function classificarOfertas(produtos: OfertaPublicada[], agora: number) {
  const ordenadas = produtos.map((produto, indice) => ({ produto, indice }))
    .sort((a, b) => (Number.isFinite(b.produto.prioridade_oferta) ? b.produto.prioridade_oferta : 0)
      - (Number.isFinite(a.produto.prioridade_oferta) ? a.produto.prioridade_oferta : 0) || a.indice - b.indice)
    .map(({ produto }) => {
      const inicio = instanteOferta(produto.oferta_inicio)
      const fim = instanteOferta(produto.oferta_fim, true)
      const expirada = fim !== null && fim <= agora
      const agendada = produto.ativo && produto.oferta_relampago && !expirada && inicio !== null && inicio > agora
      const ativa = produto.ativo && produto.oferta_relampago && !expirada && !agendada
      const prazoExato = Boolean(produto.oferta_fim?.includes('T') && fim !== null)
      const situacao = !produto.oferta_relampago ? 'DESATIVADA' : expirada ? 'EXPIRADA' : agendada ? 'AGENDADA'
        : prazoExato ? 'ATIVA' : 'SEM PRAZO EXATO'
      return { ...produto, ativa, situacao, naHome: false, naFila: false }
    })
  const naHome = new Set(ordenadas.filter((produto) => produto.ativa && produto.home_oferta_mode !== 'fila')
    .sort((a, b) => Number(b.home_oferta_mode === 'fixada') - Number(a.home_oferta_mode === 'fixada'))
    .slice(0, 12).map((produto) => produto.mercado_livre_id))
  return ordenadas.map((produto) => produto.ativa
    ? { ...produto, naHome: naHome.has(produto.mercado_livre_id), naFila: !naHome.has(produto.mercado_livre_id) } : produto)
}
