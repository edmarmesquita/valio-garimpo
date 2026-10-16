import { useEffect, useRef, useState } from 'react'
import AreaOperacional from '../components/AreaOperacional'
import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import { verificarProdutosValio, type ProdutoExistente } from '../lib/verificarProdutosValio'
import { CATEGORIAS_VALIO, type CategoriaValio } from '../lib/produtosGarimpados'
import { criarRegistroSnapshot, type RegistroSnapshot } from '../features/importar-lista-afiliados/snapshotLoteAfiliados'
import { processarRetornoGerador } from '../features/importar-lista-afiliados/processarRetornoGerador'
import { type ProdutoListaAfiliados } from '../features/importar-lista-afiliados/extrairListaAfiliados'
import { extrairOfertasRelampagoHtml, type OfertaExtraida } from '../features/ofertas-relampago/extrairOfertas'
import { prepararOfertasSelecionadas, type ResultadoPreparo } from '../features/ofertas-relampago/prepararOfertas'
import { confirmarOfertas, preverOfertas, type ItemOferta, type ModoOferta, type PreviaAssinadaOfertas, type ResultadoConfirmacaoOfertas } from '../lib/ofertasRelampagoApi'
import './OfertasRelampagoPage.css'
import { resolverUrlGerador } from '../features/ofertas-relampago/urlGerador'

import { CHAVE_SNAPSHOT_OFERTAS as CHAVE_SNAPSHOT, validarLoteOfertas, registrarRetornoLote, registrarConfirmacaoLote } from '../features/ofertas-relampago/cicloLote'
const dinheiro = (valor: number | null) => valor === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
type SituacaoValio = 'JÁ EXISTE' | 'NOVO PRODUTO' | 'NÃO VERIFICADO' | 'REVISAR'

function BadgeSituacaoValio({ situacao }: { situacao: SituacaoValio }) {
  const classe = situacao === 'JÁ EXISTE' ? 'existente' : situacao === 'NOVO PRODUTO' ? 'novo'
    : situacao === 'REVISAR' ? 'revisar' : 'pendente'
  return <span className={`flash-status flash-status--${classe}`}>{situacao}</span>
}

function carregarSnapshot(): RegistroSnapshot | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_SNAPSHOT)
    if (!valor) return null
    const parsed: unknown = JSON.parse(valor)
    return validarLoteOfertas(parsed) ? parsed : null
  } catch { return null }
}

export default function OfertasRelampagoPage() {
  const { token } = useSessaoOperacional()
  const payloadRef = useRef<HTMLElement>(null)
  const loteRef = useRef<HTMLElement>(null)
  const gravacaoRef = useRef<HTMLElement>(null)
  const confirmacaoRef = useRef<HTMLElement>(null)
  const [pedidoScroll, setPedidoScroll] = useState<{ destino: 'payload' | 'lote' | 'gravacao' | 'confirmacao' } | null>(null)
  const scrollConsumido = useRef(pedidoScroll)
  useEffect(() => {
    if (!pedidoScroll || scrollConsumido.current === pedidoScroll) return
    scrollConsumido.current = pedidoScroll
    const destinos = { payload: payloadRef, lote: loteRef, gravacao: gravacaoRef, confirmacao: confirmacaoRef }
    destinos[pedidoScroll.destino].current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [pedidoScroll])
  const [html, setHtml] = useState('')
  const [origem, setOrigem] = useState('')
  const [ofertas, setOfertas] = useState<OfertaExtraida[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [existentes, setExistentes] = useState<Map<string, ProdutoExistente>>(new Map())
  const [verificados, setVerificados] = useState<Set<string>>(new Set())
  const [categorias, setCategorias] = useState<Map<string, CategoriaValio>>(new Map())
  const [prioridades, setPrioridades] = useState<Map<string, number>>(new Map())
  const [desativadas, setDesativadas] = useState<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState(carregarSnapshot)
  const [feedbackGerador, setFeedbackGerador] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)
  const [retornoTexto, setRetornoTexto] = useState(() => snapshot?.retornoTexto ?? '')
  const [previa, setPrevia] = useState<ResultadoPreparo | null>(null)
  const [previaRemota, setPreviaRemota] = useState<(PreviaAssinadaOfertas & { token: string }) | null>(null)
  const [resultadoConfirmacao, setResultadoConfirmacao] = useState<ResultadoConfirmacaoOfertas | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [filtroValio, setFiltroValio] = useState<'todos' | 'existentes' | 'novos' | 'nao-verificados' | 'revisar'>('todos')

  const validas = ofertas.filter((oferta) => oferta.situacao === 'PRONTO')
  const selecionadas = ofertas.filter((oferta) => selecionados.has(oferta.chave))
  const novas = selecionadas.filter((oferta) => oferta.itemId && verificados.has(oferta.itemId) && !existentes.has(oferta.itemId))
  const retorno = snapshot && retornoTexto.trim() ? processarRetornoGerador(snapshot.snapshot.produtos, retornoTexto) : null
  const situacaoNoValio = (oferta: OfertaExtraida): SituacaoValio => oferta.situacao !== 'PRONTO' || !oferta.itemId ? 'REVISAR'
    : !verificados.has(oferta.itemId) ? 'NÃO VERIFICADO'
      : existentes.has(oferta.itemId) ? 'JÁ EXISTE' : 'NOVO PRODUTO'
  const ofertasVisiveis = ofertas.filter((oferta) => filtroValio === 'todos'
    || situacaoNoValio(oferta) === ({ existentes: 'JÁ EXISTE', novos: 'NOVO PRODUTO',
      'nao-verificados': 'NÃO VERIFICADO', revisar: 'REVISAR' } as const)[filtroValio])
  const selecionadasExistentes = selecionadas.filter((oferta) => situacaoNoValio(oferta) === 'JÁ EXISTE').length
  const selecionadasNovas = selecionadas.filter((oferta) => situacaoNoValio(oferta) === 'NOVO PRODUTO').length

  function extrair() {
    setErro(''); setMensagem(''); setFeedbackGerador(null); setPrevia(null); setPreviaRemota(null); setResultadoConfirmacao(null)
    try {
      const resultado = extrairOfertasRelampagoHtml(html)
      setOfertas(resultado); setSelecionados(new Set()); setExistentes(new Map()); setVerificados(new Set()); setCategorias(new Map())
      setPrioridades(new Map()); setDesativadas(new Set()); setFiltroValio('todos')
      setMensagem(`${resultado.length} oferta(s) extraída(s) apenas do HTML fornecido.`)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível analisar o HTML.') }
  }

  function limpar() {
    setHtml(''); setOrigem(''); setOfertas([]); setSelecionados(new Set()); setExistentes(new Map())
    setVerificados(new Set()); setCategorias(new Map()); setPrioridades(new Map()); setDesativadas(new Set()); setFiltroValio('todos'); setPrevia(null); setPreviaRemota(null); setResultadoConfirmacao(null); setErro('')
    setFeedbackGerador(null)
    setMensagem('Ofertas atuais limpas. Nenhum produto do Valiô foi alterado.')
  }

  function selecionar(chave: string, checked: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (checked) novo.add(chave); else novo.delete(chave)
      return novo
    })
    setPrevia(null); setPreviaRemota(null)
  }

  async function verificar() {
    const dados = selecionadas.filter((oferta) => oferta.itemId && oferta.dadosProduto)
      .map((oferta) => ({ ...oferta.dadosProduto!, itemId: oferta.itemId }))
    if (!dados.length) { setErro('Selecione ao menos uma oferta com ITEM_ID.'); return }
    setConsultando(true); setErro(''); setPrevia(null); setPreviaRemota(null)
    try {
      const resultado = await verificarProdutosValio(dados, token)
      setExistentes(resultado)
      setVerificados(new Set(dados.map((produto) => produto.itemId!)))
      setMensagem(`${resultado.size} produto(s) já existente(s); ${dados.length - resultado.size} novo(s). Nenhum dado foi alterado.`)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na consulta do Valiô.') }
    finally { setConsultando(false) }
  }

  function prepararLoteGerador() {
    const falhar = (motivo: string) => setFeedbackGerador({ tipo: 'erro', texto: `Não foi possível preparar o lote: ${motivo}` })
    setFeedbackGerador(null)
    if (snapshot) { falhar('já existe um snapshot de ofertas. Descarte-o antes de preparar outro lote.'); return }
    if (!novas.length) { falhar('selecione e verifique ao menos um produto novo no Valiô.'); return }
    const produtos: ProdutoListaAfiliados[] = novas.flatMap((oferta, indice) => {
      const url = resolverUrlGerador(oferta, origem).url
      if (!oferta.itemId || !url) return []
      return [{ ordem: indice + 1, itemId: oferta.itemId, titulo: oferta.titulo,
        userProductId: oferta.userProductId, productId: oferta.productId, pid: null, pidExtended: null,
        urlOriginal: url, urlParams: null, urlFragments: null,
        urlNormalizada: url, ...(oferta.dadosProduto ? { dadosPublicacao: oferta.dadosProduto } : {}) }]
    })
    if (produtos.length !== novas.length) { falhar('todos os produtos novos precisam de URL original válida para o Gerador. Informe uma URL da página de origem que identifique o mesmo produto ou forneça HTML com URL individual.'); return }
    try {
      const registro = criarRegistroSnapshot({ encontrados: produtos.length, unicos: produtos.length,
        ignorados: 0, duplicados: 0, produtos, urlsParaGerador: produtos.map((item) => item.urlNormalizada).join('\n') }, origem)
      window.localStorage.setItem(CHAVE_SNAPSHOT, JSON.stringify(registro))
      setPedidoScroll({ destino: 'lote' }); setSnapshot(registro); setRetornoTexto(''); setPrevia(null); setPreviaRemota(null); setErro('')
      setFeedbackGerador({ tipo: 'sucesso', texto: `Lote para o Gerador preparado com ${registro.snapshot.quantidade} produto(s).` })
    } catch (falha) { falhar(falha instanceof Error ? falha.message : 'não foi possível criar o snapshot.') }
  }

  function descartarSnapshot() {
    try { window.localStorage.removeItem(CHAVE_SNAPSHOT) }
    catch { setErro('Não foi possível remover o lote local. Tente novamente.'); return }
    const finalizado = snapshot?.status === 'FINALIZADO'
    setSnapshot(null); setRetornoTexto(''); setPrevia(null); setPreviaRemota(null); setErro(''); setFeedbackGerador(null)
    if (finalizado) setMensagem('Lote encerrado. As ofertas publicadas permanecem no Valiô.')
  }

  function atualizarRetorno(texto: string) {
    if (!snapshot || snapshot.status === 'FINALIZADO' || enviando) return
    try {
      const proximo = registrarRetornoLote(snapshot, texto)
      window.localStorage.setItem(CHAVE_SNAPSHOT, JSON.stringify(proximo))
      setSnapshot(proximo); setRetornoTexto(texto); setPrevia(null); setPreviaRemota(null)
    } catch { setErro('Não foi possível salvar o retorno do lote local. Tente novamente.') }
  }

  function preparar() {
    if (novas.length && snapshot && novas.some((oferta) => {
      const congelado = snapshot.snapshot.produtos.find((produto) => produto.itemId === oferta.itemId)
      return !congelado || congelado.urlNormalizada !== resolverUrlGerador(oferta, origem).url
    })) { setErro('O snapshot do Gerador pertence a outro lote. Descarte-o e prepare um novo.'); return }
    const resultado = prepararOfertasSelecionadas(ofertas, selecionados, existentes, verificados, categorias, retorno, prioridades, desativadas)
    setPrevia(resultado); setPreviaRemota(null); setErro(''); setPedidoScroll({ destino: 'payload' })
  }

  async function preverAcao(modo: ModoOferta) {
    if (!selecionadas.length || enviando) return
    if (novas.length && snapshot && novas.some((oferta) => {
      const congelado = snapshot.snapshot.produtos.find((produto) => produto.itemId === oferta.itemId)
      return !congelado || congelado.urlNormalizada !== resolverUrlGerador(oferta, origem).url
    })) { setErro('O snapshot do Gerador pertence a outro lote.'); return }
    let itens: ItemOferta[]
    if (modo === 'DESATIVAR' || modo === 'PRIORIDADE') {
      if (selecionadas.some((oferta) => !oferta.itemId || !verificados.has(oferta.itemId) || !existentes.has(oferta.itemId))) {
        setErro('Esta ação exige produtos existentes verificados no Valiô.'); return
      }
      itens = selecionadas.map((oferta) => ({ tipo: 'ATUALIZAR_OFERTA', dados: modo === 'DESATIVAR'
        ? { mercadoLivreId: oferta.itemId, ofertaRelampago: false }
        : { mercadoLivreId: oferta.itemId, prioridadeOferta: prioridades.get(oferta.chave) ?? 0 } }))
    } else {
      const local = prepararOfertasSelecionadas(ofertas, selecionados, existentes, verificados, categorias, retorno,
        prioridades, modo === 'ENVIAR' ? desativadas : new Set())
      setPrevia(local)
      if (local.bloqueados.length || local.prontos.length !== selecionadas.length) {
        setErro('Revise todas as ofertas bloqueadas antes de consultar a prévia de gravação.'); return
      }
      itens = local.prontos.map((item) => ({ tipo: item.tipo, dados: item.dados }))
    }
    setEnviando(true); setErro(''); setPreviaRemota(null); setResultadoConfirmacao(null)
    try {
      const resposta = await preverOfertas(modo, itens, token)
      setPreviaRemota({ ...resposta, token }); setPedidoScroll({ destino: 'gravacao' })
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar a prévia.') }
    finally { setEnviando(false) }
  }

  async function confirmarAcao() {
    if (!previaRemota || previaRemota.token !== token || enviando) return
    setEnviando(true); setErro('')
    try {
      const resultado = await confirmarOfertas({ previa: previaRemota.previa, assinatura: previaRemota.assinatura }, token)
      setPedidoScroll({ destino: 'confirmacao' }); setResultadoConfirmacao(resultado); setPreviaRemota(null); setVerificados(new Set())
      if (snapshot) {
        const proximo = registrarConfirmacaoLote(snapshot, previaRemota.previa, resultado)
        setSnapshot(proximo)
        try { window.localStorage.setItem(CHAVE_SNAPSHOT, JSON.stringify(proximo)) }
        catch { setErro('A confirmação terminou, mas não foi possível salvar o status do lote local. Não repita a publicação; confira o resultado.') }
      }
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível confirmar as ofertas.') }
    finally { setEnviando(false) }
  }

  return <AreaOperacional titulo="⚡ Ofertas Relâmpago" descricao="Extraia ofertas do HTML salvo do Mercado Livre, consulte a prévia e confirme as alterações desejadas.">
    <section className="extrair-card flash-import" aria-label="Extrair ofertas">
      <label htmlFor="flash-html">HTML da página de Ofertas Relâmpago do Mercado Livre</label>
      <textarea id="flash-html" rows={8} value={html} onChange={(evento) => { setHtml(evento.target.value); setPreviaRemota(null) }} spellCheck={false} />
      <label htmlFor="flash-origem">URL da página de origem</label>
      <input id="flash-origem" aria-describedby="flash-origem-ajuda" type="url" value={origem} onChange={(evento) => setOrigem(evento.target.value)} />
      <p id="flash-origem-ajuda">Recomendada. Pode ser necessária para preparar produtos novos para o Gerador de links.</p>
      <div className="flash-actions">
        <button type="button" onClick={extrair} disabled={!html.trim()}>Extrair ofertas</button>
        <button type="button" className="extrair-secundario" onClick={limpar}>Limpar ofertas atuais</button>
      </div>
      {erro && <p className="extrair-erro" role="alert">{erro}</p>}
      {mensagem && <p role="status">{mensagem}</p>}
    </section>

    {ofertas.length > 0 && <section className="extrair-card flash-preview" aria-labelledby="flash-preview-title">
      <h2 id="flash-preview-title">Prévia das ofertas</h2>
      <p>{ofertas.length} encontradas · {validas.length} válidas · {ofertas.length - validas.length} para revisar · {selecionados.size} ofertas selecionadas</p>
      <div className="flash-actions">
        <button type="button" className="extrair-secundario" onClick={() => { setSelecionados(new Set(validas.map((item) => item.chave))); setPrevia(null); setPreviaRemota(null) }}>Selecionar todas válidas</button>
        <button type="button" disabled={!token.trim() || !selecionados.size || consultando} onClick={() => void verificar()}>{consultando ? 'Consultando...' : 'Verificar selecionadas no Valiô'}</button>
      </div>
      {!token.trim() && <p>Informe o token de publicação acima para consultar se os ITEM_IDs já existem. O token permanece na sessão.</p>}
      <section className="flash-selecionadas" aria-label="Selecionadas">
        <div className="flash-selecionadas__cabecalho">
          <div><h3>Selecionadas</h3><p>{selecionadas.length} ofertas selecionadas · {selecionadasExistentes} já existentes · {selecionadasNovas} novos produtos</p></div>
          <button type="button" className="extrair-secundario" disabled={!selecionadas.length}
            onClick={() => { setSelecionados(new Set()); setPrevia(null); setPreviaRemota(null) }}>Limpar seleção</button>
        </div>
        {selecionadas.length ? <ul>{selecionadas.map((oferta) => <li key={oferta.chave}>
          <strong>{oferta.itemId ?? 'ITEM_ID ausente'}</strong><span>{oferta.titulo ?? 'Título ausente'}</span>
          <BadgeSituacaoValio situacao={situacaoNoValio(oferta)} />
        </li>)}</ul> : <p>Nenhuma oferta selecionada.</p>}
      </section>
      <div className="flash-filter">
        <label htmlFor="flash-filtro-valio">Filtrar por situação no Valiô</label>
        <select id="flash-filtro-valio" value={filtroValio} onChange={(evento) => setFiltroValio(evento.target.value as typeof filtroValio)}>
          <option value="todos">Todos</option><option value="existentes">Já existentes</option><option value="novos">Novos</option>
          <option value="nao-verificados">Não verificados</option><option value="revisar">Revisar</option>
        </select>
        <small>{ofertasVisiveis.length} de {ofertas.length} exibida(s). O filtro não altera a seleção.</small>
      </div>
      <div className="flash-table"><table>
        <thead><tr><th>Selecionar</th><th>Produto</th><th>ITEM_ID</th><th>Antes</th><th>Agora</th><th>Desconto</th><th>Termina</th><th>Prioridade</th><th>Ação</th><th>Situação da oferta</th><th>Situação no Valiô</th><th>URL original</th></tr></thead>
        <tbody>{ofertasVisiveis.map((oferta) => <tr key={oferta.chave}>
          <td><input type="checkbox" aria-label={`Selecionar oferta ${oferta.posicao}`} checked={selecionados.has(oferta.chave)} disabled={oferta.situacao !== 'PRONTO'} onChange={(evento) => selecionar(oferta.chave, evento.target.checked)} /></td>
          <td><strong>{oferta.titulo ?? 'Título ausente'}</strong><small>Posição {oferta.posicao}</small>{oferta.imagem && <img src={oferta.imagem} alt="" loading="lazy" />}</td>
          <td>{oferta.itemId ?? 'Ausente'}</td><td>{dinheiro(oferta.precoAnterior)}</td><td>{dinheiro(oferta.precoAtual)}</td>
          <td>{oferta.percentualDesconto === null ? '—' : `${oferta.percentualDesconto}% · ${oferta.fonteDesconto === 'CALCULADO' ? 'calculado' : 'Mercado Livre'}`}</td>
          <td>{oferta.ofertaFim ? new Date(oferta.ofertaFim).toLocaleString('pt-BR') : 'Sem prazo exato'}</td>
          <td><select aria-label={`Prioridade de ${oferta.itemId ?? oferta.posicao}`} value={prioridades.get(oferta.chave) ?? 0}
            onChange={(evento) => { setPrioridades((atual) => new Map(atual).set(oferta.chave, Number(evento.target.value))); setPrevia(null); setPreviaRemota(null) }}>
            <option value={0}>Normal</option><option value={50}>Média</option><option value={100}>Alta</option>
          </select></td>
          <td><select aria-label={`Ação de ${oferta.itemId ?? oferta.posicao}`} value={desativadas.has(oferta.chave) ? 'desativar' : 'ativar'}
            onChange={(evento) => { setDesativadas((atual) => { const proximo = new Set(atual)
              if (evento.target.value === 'desativar') proximo.add(oferta.chave); else proximo.delete(oferta.chave)
              return proximo }); setPrevia(null); setPreviaRemota(null) }}>
            <option value="ativar">Ativar oferta</option><option value="desativar">Desativar oferta</option>
          </select></td>
          <td>{oferta.situacao}{oferta.situacao === 'PRONTO' && !oferta.ofertaFim ? ' · SEM PRAZO EXATO' : ''}</td>
          <td><BadgeSituacaoValio situacao={situacaoNoValio(oferta)} /></td>
          <td>{situacaoNoValio(oferta) === 'NOVO PRODUTO'
            ? <span title={resolverUrlGerador(oferta, origem).url ?? undefined}>
              {resolverUrlGerador(oferta, origem).url ? 'URL PARA GERADOR DISPONÍVEL' : 'SEM URL PARA GERADOR'}
              {resolverUrlGerador(oferta, origem).fallback && <small>URL da página de origem usada</small>}
            </span>
            : <span title={oferta.urlOriginal ?? undefined}>{oferta.urlOriginal ? 'DISPONÍVEL' : 'AUSENTE'}</span>}</td>
        </tr>)}</tbody>
      </table></div>
      {novas.map((oferta) => <label className="flash-category" key={oferta.chave}>Categoria de {oferta.itemId}
        <select value={categorias.get(oferta.itemId!) ?? ''} onChange={(evento) => {
          const atual = new Map(categorias)
          if (evento.target.value) atual.set(oferta.itemId!, evento.target.value as CategoriaValio)
          else atual.delete(oferta.itemId!)
          setCategorias(atual); setPrevia(null); setPreviaRemota(null)
        }}><option value="">Selecione</option>{CATEGORIAS_VALIO.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}</select>
      </label>)}
      <button type="button" disabled={!selecionados.size} onClick={preparar}>Preparar ofertas selecionadas</button>
      <div className="flash-actions">
        {([['ATIVAR', 'Ativar selecionadas'], ['DESATIVAR', 'Desativar selecionadas'],
          ['PRIORIDADE', 'Atualizar prioridade'], ['ENVIAR', 'Enviar selecionadas para Ofertas Relâmpago'],
          ['SUBSTITUIR', 'Substituir ofertas ativas pelas selecionadas']] as const).map(([modo, titulo]) =>
          <button type="button" key={modo} className="extrair-secundario" disabled={!token.trim() || !selecionados.size || enviando}
            onClick={() => void preverAcao(modo)}>{titulo}</button>)}
      </div>
    </section>}

    {(ofertas.length > 0 || snapshot) && <section ref={loteRef} className="extrair-card flash-generator" aria-label="Lote para o Gerador">
      <h2>Gerador de links oficiais</h2>
      <p>Produtos novos precisam de retorno meli.la pareado por ITEM_ID. O snapshot desta área usa chave própria e não altera o lote da Lista de Afiliados.</p>
      {feedbackGerador && <p className={`flash-generator-feedback flash-generator-feedback--${feedbackGerador.tipo}`}
        role={feedbackGerador.tipo === 'erro' ? 'alert' : 'status'}>{feedbackGerador.texto}</p>}
      {snapshot ? <>
        <p>Snapshot ativo · {snapshot.status} · {snapshot.snapshot.quantidade} produto(s) · ID {snapshot.snapshot.identificacao}</p>
        <p className={snapshot.status === 'FINALIZADO' ? 'flash-generator-feedback' : undefined} role="status">
          Status do lote: {snapshot.status === 'RETORNO PROCESSADO' ? 'PRONTO' : snapshot.status}
          {snapshot.status === 'FINALIZADO' && ' · Publicação concluída.'}
        </p>
        <h3>Produtos no lote</h3>
        <ol className="flash-generator-lista">{snapshot.snapshot.produtos.map((produto) => <li key={produto.itemId}>
          <strong>{produto.itemId}</strong><span>{produto.urlNormalizada}</span>
        </li>)}</ol>
        <label htmlFor="flash-urls-gerador">URLs para o Gerador</label>
        <textarea id="flash-urls-gerador" aria-label="URLs para o Gerador" value={snapshot.snapshot.urlsParaGerador} readOnly rows={5} />
        <label htmlFor="flash-retorno">Retorno do Gerador, na mesma ordem</label>
        <textarea id="flash-retorno" value={retornoTexto} readOnly={snapshot.status === 'FINALIZADO' || enviando} onChange={(evento) => atualizarRetorno(evento.target.value)} rows={5} />
        {retorno && <p role="status">{retorno.linksValidos} link(s) válido(s) · {retorno.recusados} recusado(s) · {retorno.pausados} pausado(s) · {retorno.revisar} para revisar. {retorno.consistente ? 'Pareamento consistente.' : 'Revise a quantidade e a ordem.'}</p>}
        <p>Este botão remove apenas o lote local. Produtos, ofertas e links publicados permanecem no Valiô.</p>
        <button type="button" className="extrair-secundario" disabled={enviando} onClick={descartarSnapshot}>
          {snapshot.status === 'FINALIZADO' ? 'Encerrar lote' : 'Descartar snapshot de ofertas'}
        </button>
      </> : <button type="button" onClick={prepararLoteGerador}>Preparar lote para o Gerador</button>}
    </section>}

    {previa && <section ref={payloadRef} className="extrair-card flash-payload" aria-label="Prévia do payload">
      <h2>Prévia do payload — nenhuma publicação</h2>
      <p>{previa.prontos.length} pronta(s) · {previa.bloqueados.length} bloqueada(s)</p>
      {previa.bloqueados.map((item, indice) => <p key={`${item.itemId}-${indice}`} role="status">{item.itemId ?? 'Sem ITEM_ID'}: {item.motivo}</p>)}
      <pre>{JSON.stringify(previa.prontos, null, 2)}</pre>
    </section>}
    {previaRemota && previaRemota.token === token && <section ref={gravacaoRef} className="extrair-card flash-confirmacao" aria-label="Prévia de gravação">
      <h2>Prévia de gravação — nenhuma alteração feita</h2>
      {previaRemota.previa.modo === 'SUBSTITUIR' && <p>{previaRemota.previa.desativarAtuais} oferta(s) atual(is) serão desativadas;
        {' '}{previaRemota.previa.ativarSelecionadas} selecionada(s) serão ativadas ou criadas.</p>}
      <div className="flash-table"><table><thead><tr><th>ITEM_ID</th><th>Produto</th><th>Situação atual</th><th>Ação proposta</th>
        <th>Prioridade</th><th>Antes</th><th>Agora</th><th>Desconto</th><th>Prazo</th><th>Resultado esperado</th></tr></thead>
        <tbody>{previaRemota.previa.operacoes.map((item) => <tr key={item.itemId}><td>{item.itemId}</td><td>{item.produto}</td>
          <td>{item.situacaoAtual}</td><td>{item.acao}</td><td>{item.prioridade}</td><td>{dinheiro(item.precoAnterior)}</td>
          <td>{dinheiro(item.precoAtual)}</td><td>{item.percentualDesconto === null ? '—' : `${item.percentualDesconto}%`}</td>
          <td>{item.ofertaFim ? new Date(item.ofertaFim).toLocaleString('pt-BR') : 'Sem prazo exato'}</td><td>{item.resultadoEsperado}</td>
        </tr>)}</tbody></table></div>
      <button type="button" disabled={enviando} onClick={() => void confirmarAcao()}>
        {previaRemota.previa.modo === 'SUBSTITUIR' ? 'Confirmar substituição da fila'
          : previaRemota.previa.modo === 'DESATIVAR' ? `Confirmar desativação de ${previaRemota.previa.operacoes.length} oferta(s)`
            : previaRemota.previa.modo === 'PRIORIDADE' ? `Confirmar prioridade de ${previaRemota.previa.operacoes.length} oferta(s)`
              : `Confirmar ativação de ${previaRemota.previa.operacoes.length} oferta(s)`}</button>
    </section>}
    {resultadoConfirmacao && <section ref={confirmacaoRef} className="extrair-card flash-confirmacao" role="status">
      <h2>Resultado da confirmação</h2>
      <p>Criadas: {resultadoConfirmacao.criadas} · Ativadas: {resultadoConfirmacao.ativadas} · Atualizadas: {resultadoConfirmacao.atualizadas}
        {' '}· Desativadas: {resultadoConfirmacao.desativadas} · Sem alteração: {resultadoConfirmacao.semAlteracao}
        {' '}· Conflitos: {resultadoConfirmacao.conflitos} · Erros: {resultadoConfirmacao.erros}</p>
      <ul>{resultadoConfirmacao.itens.map((item) => <li key={item.itemId}>{item.itemId}: {item.resultado}{item.motivo ? ` — ${item.motivo}` : ''}</li>)}</ul>
    </section>}
  </AreaOperacional>
}
