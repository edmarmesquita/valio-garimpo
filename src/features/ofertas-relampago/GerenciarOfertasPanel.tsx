import { useEffect, useRef, useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import { confirmarOfertas, listarOfertasPublicadas, preverOfertas, preverLimpezaExpiradas, type ModoOferta, type PreviaAssinadaOfertas, type ResultadoConfirmacaoOfertas } from '../../lib/ofertasRelampagoApi'
import { classificarOfertas, type OfertaPublicada } from './gerenciarOfertas'
import { agendaIso, agendaInput } from './agendaOferta'

const dinheiro = (valor: number | null) => valor === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
const data = (valor: string | null) => !valor ? 'Não informado' : /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ? valor.split('-').reverse().join('/') : new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const filtros = ['Todas', 'Ativas agora', 'Na Home', 'Na fila', 'Expiradas / Histórico', 'Agendadas', 'Desativadas'] as const
const modosHome = { auto: 'Automática', fixada: 'Fixar na Home', fila: 'Enviar para fila' } as const

export default function GerenciarOfertasPanel() {
  const { token } = useSessaoOperacional()
  const [consulta, setConsulta] = useState<{ token: string; produtos: OfertaPublicada[] } | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [prioridades, setPrioridades] = useState<Record<string, number>>({})
  const [homeModes, setHomeModes] = useState<Record<string, 'auto' | 'fixada' | 'fila'>>({})
  const [prioridadeLote, setPrioridadeLote] = useState(0)
  const [agendas, setAgendas] = useState<Record<string, { inicio: string; fim: string }>>({})
  const [filtro, setFiltro] = useState<typeof filtros[number]>('Todas')
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [previa, setPrevia] = useState<(PreviaAssinadaOfertas & { token: string }) | null>(null)
  const [resultado, setResultado] = useState<ResultadoConfirmacaoOfertas | null>(null)
  const [agora, setAgora] = useState(() => Date.now())
  const requisicao = useRef(0)
  const previaHome = useRef<HTMLElement>(null)
  useEffect(() => {
    if (previa?.token === token && previa.previa.modo === 'HOME') {
      previaHome.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      previaHome.current?.focus({ preventScroll: true })
    }
  }, [previa, token])
  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const produtos = consulta?.token === token ? consulta.produtos : []
  const classificados = classificarOfertas(produtos, agora)
  const marcadas = classificados.filter((item) => item.oferta_relampago)
  const visiveis = classificados.filter((item) => filtro === 'Todas' && item.oferta_relampago && (item.ativa || item.situacao === 'AGENDADA')
    || filtro === 'Ativas agora' && item.ativa || filtro === 'Na Home' && item.naHome
    || filtro === 'Na fila' && item.naFila || filtro === 'Expiradas / Histórico' && item.oferta_relampago && item.situacao === 'EXPIRADA'
    || filtro === 'Agendadas' && item.situacao === 'AGENDADA' || filtro === 'Desativadas' && !item.oferta_relampago)
  const expiradas = marcadas.filter((item) => item.situacao === 'EXPIRADA')
  const fixadas = classificados.filter((item) => item.ativa && item.home_oferta_mode === 'fixada').length
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
      setAgora(Date.now())
      if (itemId && encontradas[0]) setFiltro(!encontradas[0].oferta_relampago ? 'Desativadas'
        : classificarOfertas(encontradas, Date.now())[0].situacao === 'EXPIRADA' ? 'Expiradas / Histórico' : 'Todas')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na consulta.') }
    finally { if (pedido === requisicao.current) setOcupado(false) }
  }

  async function preparar(modo: ModoOferta, ids: string[], emLote = false) {
    if (!ids.length || ocupado) return
    setOcupado(true); setErro(''); setPrevia(null); setResultado(null)
    try {
      const itens = ids.map((id) => ({ tipo: 'ATUALIZAR_OFERTA' as const, dados: modo === 'AGENDAR' || modo === 'ATIVAR_AGORA'
        ? { mercadoLivreId: id, ofertaInicio: modo === 'ATIVAR_AGORA' ? null : agendaIso(agendas[id]?.inicio ?? agendaInput(produtos.find((item) => item.mercado_livre_id === id)!.oferta_inicio)),
          ofertaFim: agendas[id]?.fim !== undefined && agendas[id].fim !== agendaInput(produtos.find((item) => item.mercado_livre_id === id)!.oferta_fim)
            ? agendaIso(agendas[id].fim) : produtos.find((item) => item.mercado_livre_id === id)!.oferta_fim }
        : modo === 'HOME'
        ? { mercadoLivreId: id, homeOfertaMode: homeModes[id] ?? produtos.find((item) => item.mercado_livre_id === id)!.home_oferta_mode ?? 'auto' }
        : modo === 'PRIORIDADE'
        ? { mercadoLivreId: id, prioridadeOferta: emLote ? prioridadeLote : prioridades[id] ?? produtos.find((item) => item.mercado_livre_id === id)!.prioridade_oferta }
        : { mercadoLivreId: id, ofertaRelampago: modo === 'REATIVAR' } }))
      const resposta = await preverOfertas(modo, itens, token)
      setPrevia({ ...resposta, token })
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na prévia.') }
    finally { setOcupado(false) }
  }

  async function prepararLimpeza() {
    if (ocupado) return
    setOcupado(true); setErro(''); setPrevia(null); setResultado(null)
    try { setPrevia({ ...await preverLimpezaExpiradas(token), token }) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível preparar a limpeza.') }
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
        previa.previa.modo === 'LIMPAR_EXPIRADAS' ? Promise.resolve([])
          : Promise.all(previa.previa.operacoes.map((item) => listarOfertasPublicadas(token, item.itemId))),
      ])
      const ids = new Set(marcadasAgora.map((item) => item.mercado_livre_id))
      setConsulta({ token, produtos: [...marcadasAgora, ...atualizadas.flat().filter((item) => !ids.has(item.mercado_livre_id))] })
      // Preserva seleção e rascunhos de outras linhas. Atualiza somente os
      // controles efetivamente confirmados, para não exibir um valor antigo.
      if (previa.previa.modo === 'PRIORIDADE') setPrioridades((atual) => {
        const proximo = { ...atual }; for (const item of resposta.itens) if (item.resultado !== 'ERRO' && item.resultado !== 'CONFLITO') delete proximo[item.itemId]
        return proximo
      })
      if (previa.previa.modo === 'HOME') setHomeModes((atual) => {
        const proximo = { ...atual }; for (const item of resposta.itens) if (item.resultado !== 'ERRO' && item.resultado !== 'CONFLITO') delete proximo[item.itemId]
        return proximo
      })
      if (previa.previa.modo === 'AGENDAR' || previa.previa.modo === 'ATIVAR_AGORA') setAgendas((atual) => {
        const proximo = { ...atual }; for (const item of resposta.itens) if (item.resultado !== 'ERRO' && item.resultado !== 'CONFLITO') delete proximo[item.itemId]
        return proximo
      })
      setAgora(Date.now())
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
      <p role="status">{marcadas.length} ofertas marcadas · {classificados.filter((item) => item.ativa).length} ativas agora · {classificados.filter((item) => item.situacao === 'AGENDADA').length} agendadas · {classificados.filter((item) => item.naHome).length} na Home · {classificados.filter((item) => item.naFila).length} na fila · {expiradas.length} expiradas aguardando limpeza</p>
      <p>A listagem principal mostra ativas e agendadas. Consulte as vencidas em Expiradas / Histórico.</p>
      {fixadas > 12 && <p role="alert">{fixadas} ofertas fixadas para 12 vagas. Entram as 12 primeiras por prioridade e ordem estável do catálogo; as demais ficam na fila.</p>}
      {produtos.some((item) => item.controle_home_disponivel === false) && <p role="alert">Controle de Home indisponível: aplique a migração 004 no Supabase. As demais ações continuam disponíveis.</p>}
      <button type="button" disabled={ocupado || !expiradas.length} onClick={() => void prepararLimpeza()}>Limpar ofertas expiradas</button>
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
        <thead><tr><th>Selecionar</th><th>Produto</th><th>Categoria</th><th>Agora</th><th>Antes</th><th>Desconto</th><th>Prioridade</th><th>Início</th><th>Fim</th><th>Situação</th><th>Posição na Home</th><th>Ações</th></tr></thead>
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
          <td>{item.situacao}{item.naHome && <strong className="flash-manager-home">{item.home_oferta_mode === 'fixada' ? 'FIXADA NA HOME' : 'NA HOME'}</strong>}{item.naFila && <strong className="flash-manager-queue">FILA{item.home_oferta_mode === 'fixada' ? ' · fixada aguardando vaga' : ''}</strong>}{!item.ativo && <small>Produto inativo no catálogo</small>}</td>
          <td><small>Atual: {modosHome[item.home_oferta_mode ?? 'auto']}</small><select aria-label={`Posição na Home de ${item.mercado_livre_id}`} disabled={ocupado || !item.oferta_relampago || item.controle_home_disponivel === false} value={homeModes[item.mercado_livre_id] ?? item.home_oferta_mode ?? 'auto'} onChange={(evento) => {
            setHomeModes({ ...homeModes, [item.mercado_livre_id]: evento.target.value as keyof typeof modosHome }); invalidarPrevia()
          }}>{Object.entries(modosHome).map(([valor, titulo]) => <option key={valor} value={valor}>{titulo}</option>)}</select>
            <button type="button" disabled={ocupado || !item.oferta_relampago || item.controle_home_disponivel === false} onClick={() => void preparar('HOME', [item.mercado_livre_id])}>Prévia da posição na Home</button>
          </td>
          <td><div className="flash-manager-item-actions">
            {item.situacao === 'AGENDADA' && <small>Agendada para: {data(item.oferta_inicio)}</small>}
            {item.ativa && <small>ATIVA AGORA · Termina em: {data(item.oferta_fim)}</small>}
            <label>Início (Brasília)<input type="datetime-local" disabled={ocupado} value={agendas[item.mercado_livre_id]?.inicio ?? agendaInput(item.oferta_inicio)} onChange={(e) => {
              setAgendas({ ...agendas, [item.mercado_livre_id]: { inicio: e.target.value, fim: agendas[item.mercado_livre_id]?.fim ?? agendaInput(item.oferta_fim) } }); invalidarPrevia()
            }} /></label>
            <label>Fim opcional (Brasília)<input type="datetime-local" disabled={ocupado} value={agendas[item.mercado_livre_id]?.fim ?? agendaInput(item.oferta_fim)} onChange={(e) => {
              setAgendas({ ...agendas, [item.mercado_livre_id]: { inicio: agendas[item.mercado_livre_id]?.inicio ?? agendaInput(item.oferta_inicio), fim: e.target.value } }); invalidarPrevia()
            }} /></label>
            <button type="button" disabled={ocupado || !item.ativo} onClick={() => void preparar('AGENDAR', [item.mercado_livre_id])}>{item.situacao === 'AGENDADA' ? 'Editar agendamento — gerar prévia' : 'Agendar Oferta Relâmpago'}</button>
            {item.situacao === 'AGENDADA' && <button type="button" disabled={ocupado} onClick={() => void preparar('ATIVAR_AGORA', [item.mercado_livre_id])}>Cancelar agendamento e ativar agora — prévia</button>}
            <button type="button" disabled={ocupado} onClick={() => void preparar('PRIORIDADE', [item.mercado_livre_id])}>Prévia de prioridade</button>
            {item.oferta_relampago
              ? <button type="button" disabled={ocupado} onClick={() => void preparar('DESATIVAR', [item.mercado_livre_id])}>{item.situacao === 'AGENDADA' ? 'Cancelar agendamento e desativar somente a Oferta Relâmpago' : 'Desativar Oferta Relâmpago'}</button>
              : <button type="button" disabled={ocupado || !item.ativo || (item.oferta_fim !== null && Date.parse(item.oferta_fim) <= agora)} onClick={() => void preparar('REATIVAR', [item.mercado_livre_id])}>Reativar Oferta Relâmpago</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {previa?.token === token && <section ref={previaHome} tabIndex={-1} aria-label="Prévia do gerenciamento" className="flash-manager-preview">
      <h3>{previa.previa.modo === 'HOME' ? 'Prévia da posição na Home' : 'Prévia do gerenciamento'} — nenhuma alteração feita</h3>
      <p>{previa.previa.modo === 'HOME' ? 'Somente a posição na Home será atualizada. Nenhuma prioridade ou outro campo será alterado.' : 'Somente os campos da oferta serão atualizados. O status do produto e seu link afiliado permanecem iguais.'}</p>
      {previa.previa.modo === 'LIMPAR_EXPIRADAS' && <><p>{previa.previa.operacoes.length} ofertas expiradas serão limpas.</p><p>Esses produtos sairão da área de Ofertas Relâmpago, mas permanecerão ativos no catálogo.</p></>}
      {previa.previa.avisos?.map((aviso) => <p role="alert" key={aviso}>{aviso}</p>)}
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
