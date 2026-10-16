import { useEffect, useRef, useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import { CATEGORIAS_VALIO, type CategoriaValio } from '../../lib/produtosGarimpados'
import { verificarIdsValio, type ProdutoExistente } from '../../lib/verificarProdutosValio'
import { confirmarOfertas, preverLotePreparado, type PreviaAssinadaOfertas, type ResultadoConfirmacaoOfertas } from '../../lib/ofertasRelampagoApi'
import { CHAVE_LOTE_PREPARADO, concluirItensPreparados, lerLotePreparado, payloadLotePreparado, revalidarLotePreparado, salvarLotePreparado,
  type ItemPreparado, type LotePreparado } from './lotePreparado'

type Bloqueio = { itemId: string; motivo: string }
export default function LotePreparadoPanel({ criarAtual, podeSalvar }: { criarAtual: () => LotePreparado; podeSalvar: boolean }) {
  const { token } = useSessaoOperacional()
  const [inicial] = useState(() => lerLotePreparado(window.localStorage))
  const [lote, setLote] = useState(inicial.lote)
  const [invalido, setInvalido] = useState(inicial.invalido)
  const [carregado, setCarregado] = useState(false)
  const [substituir, setSubstituir] = useState<{ lote: LotePreparado; anterior: string | null } | null>(null)
  const [excluir, setExcluir] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [existentes, setExistentes] = useState<Map<string, ProdutoExistente>>(new Map())
  const [bloqueados, setBloqueados] = useState<Bloqueio[]>([])
  const [validadoToken, setValidadoToken] = useState<string | null>(null)
  const [previa, setPrevia] = useState<(PreviaAssinadaOfertas & { token: string; ids: string[] }) | null>(null)
  const [resultado, setResultado] = useState<ResultadoConfirmacaoOfertas | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const armazenamento = useRef<string | null | undefined>(undefined)
  const resultadoRef = useRef<HTMLElement>(null)
  const previaRef = useRef<HTMLElement>(null)
  useEffect(() => { if (previa) previaRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }, [previa])
  useEffect(() => { if (resultado) resultadoRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }, [resultado])
  function lerBruto() { return window.localStorage.getItem(CHAVE_LOTE_PREPARADO) }
  function persistir(proximo: LotePreparado) {
    const bruto = lerBruto()
    if (armazenamento.current !== undefined && bruto !== armazenamento.current) throw new Error('O lote salvo mudou em outra aba. Recarregue antes de continuar.')
    salvarLotePreparado(window.localStorage, proximo)
    armazenamento.current = JSON.stringify(proximo)
    setLote(proximo); setInvalido(false)
  }
  function invalidar() { setValidadoToken(null); setPrevia(null) }
  function iniciarSalvamento() {
    if (ocupado) return
    setErro(''); setMensagem('')
    try {
      const candidato = criarAtual()
      const bruto = lerBruto()
      if (bruto !== null) { setSubstituir({ lote: candidato, anterior: bruto }); return }
      armazenamento.current = bruto
      salvar(candidato)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar o lote.') }
  }
  function salvar(proximo: LotePreparado) {
    persistir(proximo); setCarregado(false); invalidar(); setBloqueados([]); setResultado(null); setSubstituir(null)
    setMensagem('Lote salvo para depois. Nenhuma oferta foi publicada.')
  }
  function confirmarSubstituicao() {
    if (!substituir) return
    try {
      if (lerBruto() !== substituir.anterior) throw new Error('O lote salvo mudou. Cancele e confira novamente antes de substituir.')
      armazenamento.current = substituir.anterior
      salvar(substituir.lote)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível substituir o lote.') }
  }
  function carregar() {
    if (!lote || ocupado || lote.status === 'FINALIZADO') return
    setErro('')
    try {
      const atual = lerLotePreparado(window.localStorage)
      if (!atual.lote) throw new Error('Lote preparado ausente ou inválido; nenhum dado atual foi substituído.')
      armazenamento.current = lerBruto()
      persistir({ ...atual.lote, status: 'REVALIDAÇÃO NECESSÁRIA' })
      setCarregado(true); setSelecionados(new Set(atual.lote.itens.filter((item) => !item.concluido).map((item) => item.itemId)))
      invalidar(); setBloqueados([]); setResultado(null)
      setMensagem('Lote carregado. Revalide antes de publicar.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o lote.') }
  }
  async function revalidar() {
    if (!lote || !carregado || ocupado || !token.trim() || lote.status === 'FINALIZADO') return
    const atual = lote
    setOcupado(true); setErro(''); setMensagem(''); invalidar()
    try {
      persistir({ ...atual, status: 'REVALIDAÇÃO NECESSÁRIA' })
      const resposta = await verificarIdsValio(atual.itens.filter((item) => !item.concluido).map((item) => item.itemId), token)
      const validacao = revalidarLotePreparado(atual, resposta)
      persistir(validacao.lote); setExistentes(resposta); setBloqueados(validacao.bloqueados); setValidadoToken(token)
      setMensagem(validacao.bloqueados.length ? 'Revalidação parcial. Itens bloqueados ficam fora da prévia; os demais continuam disponíveis.'
        : 'Lote revalidado. Gere uma nova prévia antes da confirmação.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na revalidação; nenhuma oferta foi publicada.') }
    finally { setOcupado(false) }
  }
  function editar(itemId: string, alteracoes: Partial<Pick<ItemPreparado, 'categoria' | 'prioridade'>>) {
    if (!lote || ocupado) return
    try {
      persistir({ ...lote, status: 'REVALIDAÇÃO NECESSÁRIA', itens: lote.itens.map((item) => item.itemId === itemId ? { ...item, ...alteracoes } : item) })
      invalidar(); setBloqueados([]); setMensagem('Dados locais atualizados. Revalide antes de publicar.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar a classificação.') }
  }
  async function gerarPrevia() {
    if (!lote || ocupado || validadoToken !== token || !carregado) { setErro('REVALIDAÇÃO NECESSÁRIA: revalide antes de gerar a prévia.'); return }
    setErro(''); setPrevia(null); setResultado(null)
    try {
      const validacao = revalidarLotePreparado(lote, existentes)
      persistir(validacao.lote); setBloqueados(validacao.bloqueados)
      const idsBloqueados = new Set(validacao.bloqueados.map((item) => item.itemId))
      const itens = lote.itens.filter((item) => selecionados.has(item.itemId) && !item.concluido && !idsBloqueados.has(item.itemId))
      if (!itens.length) throw new Error('Nenhum item selecionado está liberado. Revise os bloqueios ou a seleção.')
      const local = payloadLotePreparado(itens, existentes)
      if (local.bloqueados.length) throw new Error('Revise os dados bloqueados antes de gerar a prévia.')
      setOcupado(true)
      const resposta = await preverLotePreparado(local.prontos.map((item) => ({ tipo: item.tipo, dados: item.dados })), token)
      setPrevia({ ...resposta, token, ids: itens.map((item) => item.itemId) })
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível gerar uma nova prévia.') }
    finally { setOcupado(false) }
  }
  async function confirmar() {
    if (!lote || !previa || ocupado || previa.token !== token || validadoToken !== token) return
    setOcupado(true); setErro('')
    try {
      const validacao = revalidarLotePreparado(lote, existentes)
      if (validacao.bloqueados.some((item) => previa.ids.includes(item.itemId))) {
        persistir(validacao.lote); setBloqueados(validacao.bloqueados)
        throw new Error('Um item da prévia expirou ou ficou inconsistente. Gere uma nova prévia antes de confirmar.')
      }
      if (lerBruto() !== armazenamento.current) throw new Error('O lote salvo mudou em outra aba. Recarregue e revalide antes de confirmar.')
      const resposta = await confirmarOfertas({ previa: previa.previa, assinatura: previa.assinatura }, token)
      setResultado(resposta); invalidar()
      try { persistir(concluirItensPreparados(lote, resposta)) }
      catch { setErro('A confirmação terminou, mas não foi possível salvar seu resultado local. Confira o recibo e o catálogo antes de repetir.') }
    } catch (falha) { setPrevia(null); setErro(falha instanceof Error ? falha.message : 'Falha na confirmação. Revalide e confira o catálogo antes de repetir.') }
    finally { setOcupado(false) }
  }
  function remover() {
    try {
      const bruto = lerBruto()
      if (armazenamento.current !== undefined && bruto !== armazenamento.current) throw new Error('O lote mudou em outra aba. Recarregue antes de excluir.')
      window.localStorage.removeItem(CHAVE_LOTE_PREPARADO); armazenamento.current = null
      setLote(null); setInvalido(false); setCarregado(false); setExcluir(false); invalidar(); setResultado(null)
      setMensagem('Lote preparado excluído. O lote atual, o Gerador e as ofertas publicadas permanecem intactos.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível excluir o lote local.') }
  }
  const validado = carregado && validadoToken === token && ['REVALIDADO', 'PARCIALMENTE BLOQUEADO'].includes(lote?.status ?? '')
  const pendentes = lote?.itens.filter((item) => !item.concluido) ?? []
  return <section className="extrair-card flash-prepared" aria-labelledby="flash-prepared-title">
    <h2 id="flash-prepared-title">Lote preparado para depois</h2>
    <p>Salva somente seu trabalho neste navegador. Não agenda nem publica ofertas. O lote de extração e o snapshot do Gerador permanecem separados.</p>
    <button type="button" disabled={!podeSalvar || ocupado} onClick={iniciarSalvamento}>Salvar lote para depois</button>
    {invalido && <p role="alert">O lote preparado salvo está inválido ou inacessível. Ele não foi apagado nem carregado.</p>}
    {erro && <p className="extrair-erro" role="alert">{erro}</p>}
    {mensagem && <p role="status">{mensagem}</p>}
    {substituir && <section role="alertdialog" aria-label="Substituir lote preparado">
      <p>Já existe um lote preparado. Substituir pelo lote com {substituir.lote.itens.length} produto(s) selecionado(s)? O snapshot do Gerador não será alterado.</p>
      <button type="button" onClick={confirmarSubstituicao}>Substituir lote preparado</button>
      <button type="button" onClick={() => setSubstituir(null)}>Cancelar substituição</button>
    </section>}
    {lote && <>
      <p><strong>Status: {carregado && !validado && lote.status !== 'FINALIZADO' ? 'REVALIDAÇÃO NECESSÁRIA' : lote.status}</strong></p>
      <p>{lote.itens.length} produtos · Salvo em {new Date(lote.salvoEm).toLocaleString('pt-BR')} · {lote.itens.filter((item) => item.linkMeli).length} com meli.la
        {' '}· {validado ? bloqueados.length : pendentes.length} precisam de revalidação · {lote.itens.filter((item) => item.situacaoValio === 'EXISTENTE').length} eram existentes
        {' '}· {lote.itens.filter((item) => item.situacaoValio === 'NOVO').length} eram novos · {lote.itens.filter((item) => item.situacaoValio === 'NÃO VERIFICADO').length} não verificados</p>
      {!carregado && lote.status !== 'FINALIZADO' && <p>Carregar sempre exige nova revalidação, mesmo se o lote foi revalidado em uma sessão anterior.</p>}
      <div className="flash-actions">
        <button type="button" disabled={ocupado || lote.status === 'FINALIZADO'} onClick={carregar}>Carregar lote preparado</button>
        <button type="button" disabled={ocupado || !carregado || !token.trim() || lote.status === 'FINALIZADO'} onClick={() => void revalidar()}>Revalidar agora</button>
        <button type="button" disabled={ocupado} onClick={() => setExcluir(true)}>Excluir lote preparado</button>
      </div>
      {excluir && <section role="alertdialog" aria-label="Excluir lote preparado"><p>Excluir apenas este lote de trabalho local?</p>
        <button type="button" onClick={remover}>Confirmar exclusão do lote preparado</button>
        <button type="button" onClick={() => setExcluir(false)}>Cancelar exclusão</button>
      </section>}
      {carregado && <>
        <p>Itens bloqueados permanecem salvos e ficam fora da prévia. Selecione os itens válidos que deseja confirmar.</p>
        <ul className="flash-prepared-items">{lote.itens.map((item) => <li key={item.itemId}>
          <label><input type="checkbox" aria-label={`Publicar preparado ${item.itemId}`} disabled={ocupado || item.concluido} checked={selecionados.has(item.itemId)} onChange={(evento) => {
            const ids = new Set(selecionados); if (evento.target.checked) ids.add(item.itemId); else ids.delete(item.itemId)
            setSelecionados(ids); setPrevia(null)
          }} /> <strong>{item.titulo ?? 'Produto sem título'}</strong> · {item.itemId}</label>
          {item.imagem && <img src={item.imagem} alt="" loading="lazy" />}
          <p>Preço salvo: {item.precoAtual ?? 'Ausente'} · Antes: {item.precoAnterior ?? '—'} · Desconto: {item.percentualDesconto ?? '—'}% · Fim: {item.ofertaFim ? new Date(item.ofertaFim).toLocaleString('pt-BR') : 'Sem prazo exato'} · {item.linkMeli ? 'meli.la preservado' : 'Sem meli.la salvo'}</p>
          <label>Categoria — {item.titulo ?? item.itemId} <select value={item.categoria ?? ''} disabled={ocupado || item.concluido} onChange={(evento) => editar(item.itemId, { categoria: evento.target.value as CategoriaValio || null })}>
            <option value="">Selecione</option>{CATEGORIAS_VALIO.map((categoria) => <option key={categoria}>{categoria}</option>)}
          </select></label>
          <label>Prioridade salva <select value={item.prioridade} disabled={ocupado || item.concluido} onChange={(evento) => editar(item.itemId, { prioridade: Number(evento.target.value) })}>
            <option value={0}>Normal</option><option value={50}>Média</option><option value={100}>Alta</option>
          </select></label>
          {item.concluido && <p>FINALIZADO — processado com sucesso</p>}
          {bloqueados.filter((b) => b.itemId === item.itemId).map((b) => <p className="extrair-erro" key={b.itemId}>BLOQUEADO: {b.motivo}</p>)}
        </li>)}</ul>
        <button type="button" disabled={ocupado || !validado || !pendentes.length} onClick={() => void gerarPrevia()}>Gerar nova prévia do lote preparado</button>
      </>}
    </>}
    {previa?.token === token && validado && <section ref={previaRef} className="flash-prepared-preview" aria-label="Prévia do lote preparado">
      <h3>Nova prévia do lote preparado — nenhuma alteração feita</h3>
      <ul>{previa.previa.operacoes.map((item) => <li key={item.itemId}>{item.produto} · {item.itemId} · {item.acao} · Prioridade: {item.prioridade} · {item.resultadoEsperado}</li>)}</ul>
      <button type="button" disabled={ocupado} onClick={() => void confirmar()}>Confirmar publicação do lote preparado</button>
      <button type="button" disabled={ocupado} onClick={() => setPrevia(null)}>Cancelar prévia do lote preparado</button>
    </section>}
    {resultado && <section ref={resultadoRef} role="status" aria-label="Resultado do lote preparado"><h3>Resultado do lote preparado</h3>
      <p>Criadas: {resultado.criadas} · Ativadas: {resultado.ativadas} · Atualizadas: {resultado.atualizadas} · Desativadas: {resultado.desativadas} · Conflitos: {resultado.conflitos} · Erros: {resultado.erros}</p>
      <ul>{resultado.itens.map((item) => <li key={item.itemId}>{item.itemId}: {item.resultado} {item.motivo}</li>)}</ul>
    </section>}
  </section>
}
