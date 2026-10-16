import { useEffect, useRef, useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import { confirmarOfertas, listarOfertasPublicadas, preverOfertas, type ModoOferta, type PreviaAssinadaOfertas, type ResultadoConfirmacaoOfertas } from '../../lib/ofertasRelampagoApi'
import { classificarOfertas, type OfertaPublicada } from './gerenciarOfertas'

const dinheiro = (valor: number | null) => valor === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
const data = (valor: string | null) => !valor ? 'Não informado' : /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ? valor.split('-').reverse().join('/') : new Date(valor).toLocaleString('pt-BR')
const filtros = ['Todas', 'Ativas agora', 'Na Home', 'Na fila', 'Expiradas', 'Agendadas'] as const

export default function GerenciarOfertasPanel() {
  const { token } = useSessaoOperacional()
  const [consulta, setConsulta] = useState<{ token: string; produtos: OfertaPublicada[] } | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [prioridades, setPrioridades] = useState<Record<string, number>>({})
  const [prioridadeLote, setPrioridadeLote] = useState(0)
  const [filtro, setFiltro] = useState<typeof filtros[number]>('Todas')
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [previa, setPrevia] = useState<(PreviaAssinadaOfertas & { token: string }) | null>(null)
  const [resultado, setResultado] = useState<ResultadoConfirmacaoOfertas | null>(null)
  const [agora, setAgora] = useState(() => Date.now())
  const requisicao = useRef(0)
  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const produtos = consulta?.token === token ? consulta.produtos : []
  const classificados = classificarOfertas(produtos, agora)
  const marcadas = classificados.filter((item) => item.oferta_relampago)
  const visiveis = classificados.filter((item) => filtro === 'Todas'
    || filtro === 'Ativas agora' && item.ativa || filtro === 'Na Home' && item.naHome
    || filtro === 'Na fila' && item.naFila || filtro === 'Expiradas' && item.situacao === 'EXPIRADA'
    || filtro === 'Agendadas' && item.situacao === 'AGENDADA')
  const idsSelecionados = produtos.filter((item) => selecionados.has(item.mercado_livre_id)).map((item) => item.mercado_livre_id)
  function invalidarPrevia() { setPrevia(null) }

  async function carregar(itemId?: string) {
    const pedido = ++requisicao.current
    setOcupado(true); setErro(''); setPrevia(null)
    try {
      const [marcadasAgora, encontradas] = await Promise.all([
        listarOfertasPublicadas(token), itemId ? listarOfertasPublicadas(token, itemId) : Promise.resolve([]),
      ])
      const recebidos = [...marcadasAgora, ...encontradas.filter((item) => !marcadasAgora.some((marcada) => marcada.mercado_livre_id === item.mercado_livre_id))]
      if (pedido !== requisicao.current) return
      setConsulta({ token, produtos: recebidos })
      setSelecionados(new Set()); setPrioridades({}); setAgora(Date.now())
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na consulta.') }
    finally { if (pedido === requisicao.current) setOcupado(false) }
  }

  async function preparar(modo: ModoOferta, ids: string[], emLote = false) {
    if (!ids.length || ocupado) return
    setOcupado(true); setErro(''); setPrevia(null); setResultado(null)
    try {
      const itens = ids.map((id) => ({ tipo: 'ATUALIZAR_OFERTA' as const, dados: modo === 'PRIORIDADE'
        ? { mercadoLivreId: id, prioridadeOferta: emLote ? prioridadeLote : prioridades[id] ?? produtos.find((item) => item.mercado_livre_id === id)!.prioridade_oferta }
        : { mercadoLivreId: id, ofertaRelampago: modo === 'REATIVAR' } }))
      const resposta = await preverOfertas(modo, itens, token)
      setPrevia({ ...resposta, token })
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na prévia.') }
    finally { setOcupado(false) }
  }

  async function confirmar() {
    if (!previa || previa.token !== token || ocupado) return
    setOcupado(true); setErro('')
    try {
      const resposta = await confirmarOfertas({ previa: previa.previa, assinatura: previa.assinatura }, token)
      setResultado(resposta); setPrevia(null)
      // Reconsulta o catálogo; mantém na sessão as ofertas recém-desativadas
      // para permitir reativação sem perder o recibo da confirmação.
      const [marcadasAgora, atualizadas] = await Promise.all([
        listarOfertasPublicadas(token),
        Promise.all(previa.previa.operacoes.map((item) => listarOfertasPublicadas(token, item.itemId))),
      ])
      const ids = new Set(marcadasAgora.map((item) => item.mercado_livre_id))
      setConsulta({ token, produtos: [...marcadasAgora, ...atualizadas.flat().filter((item) => !ids.has(item.mercado_livre_id))] })
      setSelecionados(new Set()); setPrioridades({}); setAgora(Date.now())
    } catch (falha) {
      setPrevia(null)
      setErro(falha instanceof Error ? falha.message : 'Não foi possível confirmar ou atualizar a lista. Consulte o resultado antes de repetir.')
    } finally { setOcupado(false) }
  }

  return <section className="extrair-card flash-manager" aria-labelledby="flash-manager-title">
    <h2 id="flash-manager-title">Gerenciar ofertas ativas</h2>
    <p>Consulte o catálogo independentemente do HTML e do lote do Gerador. Desativar uma Oferta Relâmpago mantém o produto no catálogo.</p>
    <div className="flash-actions">
      <button type="button" disabled={!token.trim() || ocupado} onClick={() => void carregar()}>Carregar ofertas do catálogo</button>
      <label>Consultar ou reativar por ITEM_ID <input value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="MLB…" /></label>
      <button type="button" disabled={!token.trim() || ocupado || !/^MLB\d+$/.test(busca.trim())} onClick={() => void carregar(busca.trim())}>Consultar ITEM_ID</button>
    </div>
    {!token.trim() && <p>Informe o token acima para consultar e gerenciar as ofertas.</p>}
    {ocupado && <p role="status">Consultando catálogo ou processando ação…</p>}
    {erro && <p className="extrair-erro" role="alert">{erro}</p>}
    {consulta?.token === token && <>
      <p role="status">{marcadas.length} ofertas marcadas · {classificados.filter((item) => item.ativa).length} ativas agora · {classificados.filter((item) => item.naHome).length} na Home · {classificados.filter((item) => item.naFila).length} na fila · {marcadas.filter((item) => item.situacao === 'EXPIRADA').length} expiradas</p>
      <label>Filtrar ofertas publicadas <select value={filtro} onChange={(evento) => setFiltro(evento.target.value as typeof filtro)}>{filtros.map((valor) => <option key={valor}>{valor}</option>)}</select></label>
      <div className="flash-actions">
        <button type="button" disabled={ocupado} onClick={() => { setSelecionados(new Set(visiveis.map((item) => item.mercado_livre_id))); invalidarPrevia() }}>Selecionar exibidas</button>
        <span>{idsSelecionados.length} selecionadas</span>
        <label>Prioridade em lote <select disabled={ocupado} value={prioridadeLote} onChange={(evento) => { setPrioridadeLote(Number(evento.target.value)); invalidarPrevia() }}>
          <option value={0}>Normal</option><option value={50}>Média</option><option value={100}>Alta</option>
        </select></label>
        <button type="button" disabled={ocupado || !idsSelecionados.length} onClick={() => void preparar('PRIORIDADE', idsSelecionados, true)}>Prévia de prioridade em lote</button>
        <button type="button" disabled={ocupado || !idsSelecionados.length} onClick={() => void preparar('DESATIVAR', idsSelecionados)}>Desativar Ofertas Relâmpago selecionadas</button>
      </div>
      {!visiveis.length && <p>Nenhuma oferta neste filtro.</p>}
      <div className="flash-table"><table>
        <thead><tr><th>Selecionar</th><th>Produto</th><th>Categoria</th><th>Agora</th><th>Antes</th><th>Desconto</th><th>Prioridade</th><th>Início</th><th>Fim</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{visiveis.map((item) => <tr key={item.mercado_livre_id}>
          <td><input type="checkbox" disabled={ocupado} aria-label={`Gerenciar ${item.mercado_livre_id}`} checked={selecionados.has(item.mercado_livre_id)} onChange={(evento) => {
            const proximo = new Set(selecionados); if (evento.target.checked) proximo.add(item.mercado_livre_id); else proximo.delete(item.mercado_livre_id)
            setSelecionados(proximo); invalidarPrevia()
          }} /></td>
          <td>{item.imagem && <img src={item.imagem} alt="" loading="lazy" />}<strong>{item.titulo}</strong><small>{item.mercado_livre_id}</small></td>
          <td>{item.categoria}</td><td>{dinheiro(item.preco)}</td><td>{dinheiro(item.preco_anterior)}</td><td>{item.percentual_desconto === null ? '—' : `${item.percentual_desconto}%`}</td>
          <td><select aria-label={`Prioridade publicada de ${item.mercado_livre_id}`} disabled={ocupado} value={prioridades[item.mercado_livre_id] ?? item.prioridade_oferta} onChange={(evento) => {
            setPrioridades({ ...prioridades, [item.mercado_livre_id]: Number(evento.target.value) }); invalidarPrevia()
          }}><option value={0}>Normal</option><option value={50}>Média</option><option value={100}>Alta</option></select></td>
          <td>{data(item.oferta_inicio)}</td><td>{data(item.oferta_fim)}</td>
          <td>{item.situacao}{item.naHome && <strong className="flash-manager-home">NA HOME</strong>}{item.naFila && <strong className="flash-manager-queue">FILA</strong>}{!item.ativo && <small>Produto inativo no catálogo</small>}</td>
          <td><div className="flash-manager-item-actions">
            <button type="button" disabled={ocupado} onClick={() => void preparar('PRIORIDADE', [item.mercado_livre_id])}>Prévia de prioridade</button>
            {item.oferta_relampago
              ? <button type="button" disabled={ocupado} onClick={() => void preparar('DESATIVAR', [item.mercado_livre_id])}>Desativar Oferta Relâmpago</button>
              : <button type="button" disabled={ocupado || !item.ativo || (item.oferta_fim !== null && Date.parse(item.oferta_fim) <= agora)} onClick={() => void preparar('REATIVAR', [item.mercado_livre_id])}>Reativar Oferta Relâmpago</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {previa?.token === token && <section aria-label="Prévia do gerenciamento" className="flash-manager-preview">
      <h3>Prévia do gerenciamento — nenhuma alteração feita</h3>
      <p>Somente os campos da oferta serão atualizados. O status do produto e seu link afiliado permanecem iguais.</p>
      <ul>{previa.previa.operacoes.map((item) => <li key={item.itemId}>{item.produto} · {item.itemId} · {item.acao} · Prioridade: {item.prioridade} · {item.resultadoEsperado}</li>)}</ul>
      <button type="button" disabled={ocupado} onClick={() => void confirmar()}>Confirmar alterações das ofertas publicadas</button>
      <button type="button" disabled={ocupado} onClick={() => setPrevia(null)}>Cancelar prévia do gerenciamento</button>
    </section>}
    {resultado && <section role="status" aria-label="Resultado do gerenciamento"><h3>Resultado do gerenciamento</h3>
      <p>Ativadas: {resultado.ativadas} · Atualizadas: {resultado.atualizadas} · Desativadas: {resultado.desativadas} · Sem alteração: {resultado.semAlteracao} · Conflitos: {resultado.conflitos} · Erros: {resultado.erros}</p>
      <ul>{resultado.itens.map((item) => <li key={item.itemId}>{item.itemId}: {item.resultado} {item.motivo}</li>)}</ul>
    </section>}
  </section>
}
