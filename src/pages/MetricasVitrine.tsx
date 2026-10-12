import { useState } from 'react'
import { carregarMetricasCliques } from '../lib/metricasCliques'
import type { MetricasCliques, PeriodoCliques } from '../lib/metricasCliques'

export default function MetricasVitrine({ token }: { token: string }) {
  const [periodo, setPeriodo] = useState<PeriodoCliques>('30dias')
  const [metricas, setMetricas] = useState<MetricasCliques | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  async function carregar() {
    setCarregando(true); setErro('')
    try { setMetricas(await carregarMetricasCliques(periodo, token)) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar as métricas.') }
    finally { setCarregando(false) }
  }
  return <section className="extrair-card metricas-vitrine" aria-labelledby="metricas-titulo">
    <div className="extrair-resultado-cabecalho"><div><h2 id="metricas-titulo">Métricas da vitrine</h2>
      <p>Cliques agregados nos botões de oferta, sem identificação de visitantes.</p></div>
      <button type="button" disabled={!token.trim() || carregando} onClick={() => void carregar()}>{carregando ? 'Carregando...' : 'Carregar métricas'}</button></div>
    <label htmlFor="periodo-metricas">Período</label>
    <select id="periodo-metricas" value={periodo} onChange={(evento) => setPeriodo(evento.target.value as PeriodoCliques)}>
      <option value="hoje">Hoje</option><option value="7dias">Últimos 7 dias</option>
      <option value="30dias">Últimos 30 dias</option><option value="todos">Todos</option>
    </select>
    {!token.trim() && <p className="extrair-aviso">Informe o token de publicação acima para consultar as métricas.</p>}
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {metricas && <>
      <p className="extrair-contagem">Período carregado: {{ hoje: 'Hoje', '7dias': 'Últimos 7 dias', '30dias': 'Últimos 30 dias', todos: 'Todos' }[metricas.periodo]}</p>
      <div className="metricas-resumo">
        <div><strong>{metricas.totalCliques}</strong><span>Total de cliques</span></div>
        <div><strong>{metricas.totalProdutosComClique}</strong><span>Produtos com clique</span></div>
        <div><strong>{metricas.produtosSemClique}</strong><span>Produtos ativos sem clique</span></div>
        <div><strong>{metricas.rankingCategorias[0]?.categoria ?? '—'}</strong><span>Categoria mais clicada</span></div>
        <div><strong>{metricas.rankingProdutos[0]?.titulo ?? '—'}</strong><span>Produto mais clicado</span></div>
      </div>
      <div className="metricas-listas">
        <div><h3>Top 10 produtos</h3>{metricas.rankingProdutos.length ? <ol>{metricas.rankingProdutos.map((item) => <li key={item.mercadoLivreId}>{item.titulo} <small>({item.mercadoLivreId})</small> — {item.cliques}</li>)}</ol> : <p>Sem cliques no período.</p>}</div>
        <div><h3>Top categorias</h3>{metricas.rankingCategorias.length ? <ol>{metricas.rankingCategorias.map((item) => <li key={item.categoria}>{item.categoria} — {item.cliques}</li>)}</ol> : <p>Sem cliques no período.</p>}</div>
        <div><h3>Cliques por dia</h3>{metricas.cliquesPorDia.length ? <ul>{metricas.cliquesPorDia.map((item) => <li key={item.data}>{item.data} — {item.cliques}</li>)}</ul> : <p>Sem cliques no período.</p>}</div>
      </div>
    </>}
  </section>
}
