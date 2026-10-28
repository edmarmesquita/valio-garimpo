import { useEffect, useRef, useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import { confirmarLinksLote, preverLinksLote } from '../../lib/manutencaoVitrine'
import type { PreviaLinksLote, ResultadoLinksLote } from '../../lib/manutencaoVitrine'
import { enviarSelecionadosValio } from '../../lib/publicarProdutosValio'
import type { ResumoEnvio } from '../../lib/publicarProdutosValio'
import { verificarProdutosValio } from '../../lib/verificarProdutosValio'
import { CATEGORIAS_VALIO } from '../../lib/produtosGarimpados'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import { extrairListaAfiliados } from './extrairListaAfiliados'
import type { ResultadoListaAfiliados } from './extrairListaAfiliados'
import { processarRetornoGerador } from './processarRetornoGerador'
import type { ResultadoRetornoGerador } from './processarRetornoGerador'
import { prepararPublicacaoNovos } from './prepararPublicacaoNovos'
import { atualizarStatusSnapshot, criarRegistrosSnapshot, lerRegistrosSnapshot, removerRegistroSnapshot, salvarRegistrosSnapshot } from './snapshotLoteAfiliados'
import type { RegistroSnapshot } from './snapshotLoteAfiliados'
import './ImportarListaAfiliadosPanel.css'

export default function ImportarListaAfiliadosPanel() {
  const { token } = useSessaoOperacional()
  const [carregado] = useState(() => typeof window === 'undefined' ? { registros: [], invalido: false }
    : lerRegistrosSnapshot(window.localStorage))
  const [registros, setRegistros] = useState<RegistroSnapshot[]>(carregado.registros)
  const [loteAtivo, setLoteAtivo] = useState(0)
  const registro = registros[loteAtivo] ?? null
  const [snapshotInvalido, setSnapshotInvalido] = useState(carregado.invalido)
  const [snapshotErro, setSnapshotErro] = useState('')
  const [restaurado, setRestaurado] = useState(Boolean(carregado.registros.length))
  const [trocandoLote, setTrocandoLote] = useState(false)
  const [urlLista, setUrlLista] = useState('')
  const [html, setHtml] = useState('')
  const [resultado, setResultado] = useState<ResultadoListaAfiliados | null>(null)
  const [erro, setErro] = useState('')
  const [mensagemCopia, setMensagemCopia] = useState('')
  const [mensagemListaLimpa, setMensagemListaLimpa] = useState('')
  const [retornoTexto, setRetornoTexto] = useState(carregado.registros[0]?.retornoTexto ?? '')
  const [retornoProcessado, setRetornoProcessado] = useState<ResultadoRetornoGerador | null>(() => {
    const inicial = carregado.registros[0]
    return inicial?.retornoTexto ? processarRetornoGerador(inicial.snapshot.produtos, inicial.retornoTexto) : null
  })
  const [mensagemBloco, setMensagemBloco] = useState('')
  const [previa, setPrevia] = useState<{ dados: PreviaLinksLote; texto: string; token: string } | null>(null)
  const [confirmacao, setConfirmacao] = useState<ResultadoLinksLote | null>(null)
  const [erroLote, setErroLote] = useState('')
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [categoriasNovos, setCategoriasNovos] = useState<Map<string, CategoriaValio>>(() =>
    new Map(Object.entries(carregado.registros[0]?.categorias ?? {})))
  const [preparadaPublicacao, setPreparadaPublicacao] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [erroPublicacao, setErroPublicacao] = useState('')
  const [resultadoPublicacao, setResultadoPublicacao] = useState<ResumoEnvio | null>(null)
  const [ignoradosPublicacao, setIgnoradosPublicacao] = useState<string[]>([])
  const [novosJaExistentes, setNovosJaExistentes] = useState<Set<string>>(new Set())
  const campoUrls = useRef<HTMLTextAreaElement>(null)
  const campoBloco = useRef<HTMLTextAreaElement>(null)
  const versao = useRef(0)
  const tokenAtual = useRef(token)
  useEffect(() => { tokenAtual.current = token }, [token])
  useEffect(() => {
    if (!mensagemListaLimpa) return
    const temporizador = window.setTimeout(() => setMensagemListaLimpa(''), 5000)
    return () => window.clearTimeout(temporizador)
  }, [mensagemListaLimpa])
  const snapshot = registro?.snapshot ?? null
  const retornos = registros.map((item) => item.retornoTexto ? processarRetornoGerador(item.snapshot.produtos, item.retornoTexto) : null)
  const retornoConsolidadoBase = retornos.filter((item): item is ResultadoRetornoGerador => Boolean(item)).reduce<ResultadoRetornoGerador | null>((total, item) => {
    if (!total) return item
    return { ...total, pareamentos: [...total.pareamentos, ...item.pareamentos], excedentes: [...total.excedentes, ...item.excedentes], totalProdutos: total.totalProdutos + item.totalProdutos,
      totalResultados: total.totalResultados + item.totalResultados, linksValidos: total.linksValidos + item.linksValidos, recusados: total.recusados + item.recusados,
      pausados: total.pausados + item.pausados, revisar: total.revisar + item.revisar, errosQuantidade: total.errosQuantidade + item.errosQuantidade,
      consistente: total.consistente && item.consistente, blocoAtualizador: [total.blocoAtualizador, item.blocoAtualizador].filter(Boolean).join('\n') }
  }, null)
  const pendentes = registros.filter((item) => !item.retornoTexto).reduce((total, item) => total + item.snapshot.quantidade, 0)
  const retornoConsolidado = retornoConsolidadoBase && pendentes > 0
    ? { ...retornoConsolidadoBase, revisar: retornoConsolidadoBase.revisar + pendentes, errosQuantidade: retornoConsolidadoBase.errosQuantidade + pendentes, consistente: false }
    : retornoConsolidadoBase
  const retornoAtual = registros.length > 1 ? retornoConsolidado : retornoProcessado
  const retornoLoteAtivo = retornoProcessado
  const urlsGerador = snapshot?.urlsParaGerador ?? resultado?.urlsParaGerador ?? ''
  const previaAtual = previa?.token === token && previa.texto === retornoAtual?.blocoAtualizador ? previa : null
  const prontos = previaAtual?.dados.linhas.filter((item) => !item.motivo).length ?? 0
  const previaTemFalhas = Boolean(previaAtual?.dados.falhasSublotes?.length)
  const classificacao = previaAtual && retornoAtual
    ? prepararPublicacaoNovos(retornoAtual, previaAtual.dados, categoriasNovos) : { existentes: [], novos: [], erros: [] }
  const analisadosPrevia = previaAtual?.dados.solicitadas ?? 0
  const errosPrevia = previaAtual ? classificacao.erros.length + Math.max(0,
    analisadosPrevia - classificacao.existentes.length - classificacao.novos.length - classificacao.erros.length) : 0
  const novosProntos = (previaTemFalhas ? [] : classificacao.novos).filter((item) => item.situacao === 'PRONTO PARA PUBLICAR'
    && !novosJaExistentes.has(item.produto.itemId) && !registros.some((lote) => lote.novosConcluidos.includes(item.produto.itemId)))

  function persistir(proximo: RegistroSnapshot): boolean {
    try {
      const proximos = registros.map((item, indice) => indice === loteAtivo ? proximo : item)
      const salvos = salvarRegistrosSnapshot(window.localStorage, proximos)
      setRegistros(salvos); setSnapshotErro(''); setSnapshotInvalido(false)
      return true
    } catch {
      setSnapshotErro('Não foi possível salvar o lote no navegador. Libere o armazenamento local e tente novamente.')
      return false
    }
  }

  function persistirIdsEmTodos(campo: 'linksConcluidos' | 'novosConcluidos', ids: readonly string[]): boolean {
    const procurados = new Set(ids)
    const proximos = registros.map((item) => atualizarStatusSnapshot(item, {
      [campo]: [...new Set([...item[campo], ...item.snapshot.produtos.map((produto) => produto.itemId).filter((id) => procurados.has(id))])],
    }))
    try {
      const salvos = salvarRegistrosSnapshot(window.localStorage, proximos)
      setRegistros(salvos); setSnapshotErro(''); setSnapshotInvalido(false)
      return true
    } catch {
      setSnapshotErro('NÃ£o foi possÃ­vel salvar o lote no navegador. Libere o armazenamento local e tente novamente.')
      return false
    }
  }

  function limparDerivados() {
    versao.current++
    setPrevia(null); setConfirmacao(null); setErroLote(''); setCarregandoPrevia(false)
    setPreparadaPublicacao(false); setResultadoPublicacao(null); setErroPublicacao(''); setIgnoradosPublicacao([])
    setNovosJaExistentes(new Set()); setRetornoTexto(''); setRetornoProcessado(null); setCategoriasNovos(new Map())
  }

  function prepararSnapshot(substituir = false) {
    if (!resultado || snapshotInvalido || (registro && !substituir)) { setTrocandoLote(Boolean(registro)); return }
    try {
      const novos = criarRegistrosSnapshot(resultado, urlLista)
      const salvos = salvarRegistrosSnapshot(window.localStorage, novos)
      setRegistros(salvos); setLoteAtivo(0); setSnapshotErro(''); setSnapshotInvalido(false)
      limparDerivados(); setRestaurado(false); setTrocandoLote(false)
    } catch (falha) { setSnapshotErro(falha instanceof Error ? falha.message : 'Não foi possível preparar o lote.') }
  }

  function descartarSnapshot() {
    try { removerRegistroSnapshot(window.localStorage) }
    catch { setSnapshotErro('Não foi possível descartar o snapshot salvo.'); return }
    setRegistros([]); setLoteAtivo(0); setSnapshotInvalido(false); setSnapshotErro(''); setRestaurado(false); setTrocandoLote(false)
    limparDerivados()
  }

  function invalidarPrevia() {
    versao.current++
    setPrevia(null); setConfirmacao(null); setErroLote(''); setCarregandoPrevia(false)
    setPreparadaPublicacao(false); setResultadoPublicacao(null); setErroPublicacao(''); setIgnoradosPublicacao([])
    setNovosJaExistentes(new Set())
  }

  async function publicarNovos() {
    if (!preparadaPublicacao || !previaAtual || !retornoAtual?.consistente || !novosProntos.length || publicando || confirmando || !token.trim()) return
    const pedido = versao.current
    setPublicando(true); setErroPublicacao(''); setResultadoPublicacao(null); setIgnoradosPublicacao([])
    try {
      const produtos = novosProntos.map((item) => item.dados!)
      const encontrados = await verificarProdutosValio(produtos, token)
      if (pedido !== versao.current || tokenAtual.current !== token) return
      const livres = novosProntos.filter((item) => !encontrados.has(item.produto.itemId))
      const ignorados = novosProntos.filter((item) => encontrados.has(item.produto.itemId)).map((item) => item.produto.itemId)
      setIgnoradosPublicacao(ignorados)
      setNovosJaExistentes((atuais) => new Set([...atuais, ...ignorados]))
      if (!livres.length) { setErroPublicacao('Os produtos já existem no Valiô. Atualize a prévia antes de tentar novamente.'); return }
      const dados = livres.map((item) => item.dados!)
      const categorias = new Map(livres.map((item, indice) => [indice, categoriasNovos.get(item.produto.itemId)!]))
      const resumo = await enviarSelecionadosValio(dados, new Set(dados.map((_, indice) => indice)), categorias, token, fetch,
        { somenteCriar: true, origemLink: 'gerador-lote' })
      if (pedido === versao.current && tokenAtual.current === token) {
        setResultadoPublicacao(resumo); setPreparadaPublicacao(false)
        const falhas = new Set(resumo.erros.map((item) => item.id))
        const criados = livres.filter((item) => !falhas.has(item.produto.itemId)).map((item) => item.produto.itemId)
        setNovosJaExistentes((atuais) => new Set([...atuais, ...criados]))
        if (criados.length) persistirIdsEmTodos('novosConcluidos', criados)
      }
    } catch (falha) {
      if (pedido === versao.current) setErroPublicacao(falha instanceof Error ? falha.message : 'Não foi possível publicar os novos produtos.')
    } finally {
      if (pedido === versao.current) setPublicando(false)
    }
  }

  async function enviarParaPrevia() {
    const texto = retornoAtual?.blocoAtualizador
    if (!registro || !texto || !token.trim() || carregandoPrevia || confirmando || publicando) return
    const pedido = ++versao.current
    setCarregandoPrevia(true); setPrevia(null); setConfirmacao(null); setErroLote('')
    try {
      const dados = await preverLinksLote(texto, token)
      if (pedido === versao.current && tokenAtual.current === token) {
        setPrevia({ dados, texto, token })
        setErroLote(dados.falhasSublotes?.map((falha) =>
          `Falha no sublote ${falha.sublote} de ${falha.totalSublotes}: ${falha.motivo}`).join(' ') ?? '')
        const jaSalvos = dados.linhas.filter((item) => item.motivo === 'Este link já está salvo.'
          && item.mercado_livre_id && item.link_novo === retornoAtual?.pareamentos
            .filter((par) => par.retorno?.tipo === 'LINK')[item.linha - 1]?.retorno?.link)
          .map((item) => item.mercado_livre_id!)
        if (jaSalvos.length) persistirIdsEmTodos('linksConcluidos', jaSalvos)
      }
    } catch (falha) {
      if (pedido === versao.current) setErroLote(falha instanceof Error ? falha.message : 'Não foi possível preparar a prévia.')
    } finally {
      if (pedido === versao.current) setCarregandoPrevia(false)
    }
  }

  async function confirmar() {
    if (!registro || !previaAtual || previaTemFalhas || !prontos || confirmacao || confirmando || carregandoPrevia || publicando) return
    const pedido = versao.current
    setConfirmando(true); setErroLote(''); setConfirmacao(null)
    try {
      const dados = await confirmarLinksLote(previaAtual.texto, previaAtual.dados, token)
      if (pedido === versao.current && tokenAtual.current === token) {
        setConfirmacao(dados)
        if (dados.idsAtualizados.length) persistirIdsEmTodos('linksConcluidos', dados.idsAtualizados)
      }
    } catch (falha) {
      if (pedido === versao.current) setErroLote(falha instanceof Error ? falha.message : 'Não foi possível atualizar os links.')
    } finally {
      if (pedido === versao.current) setConfirmando(false)
    }
  }

  function extrair() {
    setErro('')
    setMensagemCopia('')
    setMensagemListaLimpa('')
    setResultado(null)
    setMensagemBloco('')
    try { setResultado(extrairListaAfiliados(html)) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível ler a lista de afiliados.') }
  }

  function limparListaAtual() {
    setUrlLista(''); setHtml(''); setResultado(null); setErro(''); setMensagemCopia('')
    setTrocandoLote(false)
    setMensagemListaLimpa(`Lista atual limpa. Nenhum produto do Valiô foi excluído.${snapshot ? ' O lote ativo foi preservado.' : ''}`)
  }

  async function copiarBloco() {
    if (!retornoAtual?.blocoAtualizador) return
    try {
      await navigator.clipboard.writeText(retornoAtual.blocoAtualizador)
      setMensagemBloco('Bloco copiado.')
    } catch {
      campoBloco.current?.select()
      setMensagemBloco('Não foi possível copiar automaticamente. Selecione o bloco abaixo para copiar.')
    }
  }

  async function copiarUrls() {
    if (!urlsGerador || snapshotInvalido) return
    if (!registro) {
      if (!resultado) return
      try {
        const novos = criarRegistrosSnapshot(resultado, urlLista)
        const salvos = salvarRegistrosSnapshot(window.localStorage, novos)
        setRegistros(salvos); setLoteAtivo(0); setSnapshotErro(''); setSnapshotInvalido(false)
      } catch (falha) { setSnapshotErro(falha instanceof Error ? falha.message : 'Não foi possível preparar o lote.'); return }
    }
    try {
      await navigator.clipboard.writeText(snapshot?.urlsParaGerador ?? urlsGerador)
      setMensagemCopia('URLs copiadas.')
    } catch {
      campoUrls.current?.select()
      setMensagemCopia('Não foi possível copiar automaticamente. Selecione as URLs abaixo para copiar.')
    }
  }

  async function copiarUrlsDoLote(urls: string, indice: number) {
    const lote = registros[indice]
    if (lote) {
      setLoteAtivo(indice)
      setRetornoTexto(lote.retornoTexto ?? '')
      setRetornoProcessado(lote.retornoTexto ? processarRetornoGerador(lote.snapshot.produtos, lote.retornoTexto) : null)
      setCategoriasNovos(new Map(Object.entries(lote.categorias)))
      setMensagemBloco('')
      invalidarPrevia()
    }
    try { await navigator.clipboard.writeText(urls); setMensagemCopia(`URLs do lote ${indice + 1} copiadas.`) }
    catch { setMensagemCopia(`Selecione manualmente as URLs do lote ${indice + 1} abaixo para copiar.`) }
  }

  return <section className="extrair-card lista-afiliados" aria-labelledby="lista-afiliados-titulo">
    <span className="lista-afiliados-etapa">LISTA DE AFILIADOS</span>
    <h2 id="lista-afiliados-titulo">Importar lista de afiliados por HTML</h2>
    <p>Cole o HTML/Response completo da lista. Esta prévia não publica produtos nem gera links afiliados.</p>
    <label htmlFor="url-lista-afiliados">URL da lista <span className="lista-afiliados-opcional">(opcional, apenas referência)</span></label>
    <input id="url-lista-afiliados" type="url" value={urlLista} onChange={(evento) => setUrlLista(evento.target.value)} placeholder="https://www.mercadolivre.com.br/..." />
    <label htmlFor="html-lista-afiliados">HTML/Response da lista</label>
    <textarea id="html-lista-afiliados" value={html} disabled={confirmando || publicando} onChange={(evento) => {
      setHtml(evento.target.value); setResultado(null); setErro(''); setMensagemCopia('')
    }} spellCheck={false} placeholder="Cole aqui o HTML completo da lista de afiliados" />
    <div className="lista-afiliados-acoes-lista">
      <button type="button" disabled={confirmando || publicando} onClick={extrair}>Extrair produtos da lista</button>
      <button type="button" className="extrair-secundario" disabled={!urlLista && !html && !resultado && !erro}
        onClick={limparListaAtual}>Limpar lista atual</button>
    </div>
    {mensagemListaLimpa && <p className="lista-afiliados-lista-limpa" role="status">{mensagemListaLimpa}</p>}
    <p className="lista-afiliados-nota">O HTML é processado somente no navegador. A URL da lista não é acessada.</p>
    {erro && <p className="extrair-erro" role="alert">{erro}</p>}
    {snapshotInvalido && <div className="lista-afiliados-snapshot-aviso" role="alert">Snapshot salvo inválido. Crie um novo lote.
      <button type="button" className="extrair-secundario" onClick={descartarSnapshot}>Descartar snapshot salvo</button></div>}
    {snapshotErro && <p className="extrair-erro" role="alert">{snapshotErro}</p>}
    {snapshot && <div className="lista-afiliados-snapshot" role="status">
      <h3>Lote ativo para o Gerador</h3>
      {registros.length > 1 && <p><strong>{registros.length} lotes de até 30 produtos</strong> · trabalhando no lote {loteAtivo + 1}</p>}
      {restaurado && <p>Lote restaurado da sessão anterior.</p>}
      <p><strong>Lote #{snapshot.identificacao.slice(0, 6)}</strong> · {new Date(snapshot.createdAt).toLocaleString('pt-BR')} · {snapshot.quantidade} produto(s)</p>
      {snapshot.origemLista && <p>Lista de origem: {snapshot.origemLista}</p>}
      <p>Status: <strong>{registro?.status}</strong></p>
      {registros.length > 1 && <p role="status"><strong>Lote {loteAtivo + 1} de {registros.length} — {registro?.retornoTexto ? (retornoProcessado?.consistente ? 'PROCESSADO' : 'INCONSISTENTE') : 'PENDENTE'} — LOTE ATIVO</strong></p>}
      {registros.length > 1 && <div className="lista-afiliados-lotes" role="tablist" aria-label="Lotes do Gerador">
        {registros.map((item, indice) => <button key={item.snapshot.snapshotId} type="button" aria-pressed={indice === loteAtivo} className={indice === loteAtivo ? '' : 'extrair-secundario'} onClick={() => { setLoteAtivo(indice); setRetornoTexto(item.retornoTexto ?? ''); setRetornoProcessado(item.retornoTexto ? processarRetornoGerador(item.snapshot.produtos, item.retornoTexto) : null); setCategoriasNovos(new Map(Object.entries(item.categorias))); setMensagemBloco(''); invalidarPrevia() }}>
          Lote {indice + 1} · {item.snapshot.quantidade} produtos · {item.retornoTexto ? (processarRetornoGerador(item.snapshot.produtos, item.retornoTexto).consistente ? 'PROCESSADO' : 'INCONSISTENTE') : 'PENDENTE'}
        </button>)}
      </div>}
      <div className="lista-afiliados-snapshot-acoes">
        {registro?.status === 'FINALIZADO' && <button type="button" onClick={descartarSnapshot}>Encerrar lote</button>}
        {registro?.status !== 'FINALIZADO' && <button type="button" className="extrair-secundario" onClick={descartarSnapshot}>Descartar snapshot</button>}
        {resultado && <button type="button" className="extrair-secundario" onClick={() => setTrocandoLote(true)}>Preparar novo lote</button>}
      </div>
      {resultado && <p>Existe um lote ativo aguardando retorno do Gerador. A nova lista não altera esse lote.</p>}
      {trocandoLote && <div className="lista-afiliados-snapshot-troca" role="alert">
        <strong>Já existe um lote ativo.</strong><p>Ao criar outro lote, o snapshot anterior será substituído.</p>
        <button type="button" className="extrair-secundario" onClick={() => setTrocandoLote(false)}>Usar lote atual</button>
        <button type="button" disabled={!resultado || confirmando || publicando} onClick={() => prepararSnapshot(true)}>Descartar e criar novo lote</button>
      </div>}
    </div>}
    {(resultado || snapshot) && <div className="lista-afiliados-resultado">
      {resultado && <div className="lista-afiliados-previa-lista"><h3>Prévia da lista</h3>
      <div className="lista-afiliados-contadores" role="status">
        <div><strong>{resultado.encontrados}</strong><span>Encontrados</span></div>
        <div><strong>{resultado.unicos}</strong><span>Únicos</span></div>
        <div><strong>{resultado.ignorados}</strong><span>Ignorados</span></div>
        <div><strong>{resultado.duplicados}</strong><span>Duplicados</span></div>
      </div>
      <div className="lista-afiliados-tabela">
        <table><thead><tr><th>Ordem</th><th>ITEM_ID</th><th>Título</th><th>URL normalizada</th></tr></thead>
          <tbody>{resultado.produtos.map((produto) => <tr key={produto.itemId}>
            <td>{produto.ordem}</td><td>{produto.itemId}</td><td>{produto.titulo ?? '—'}</td><td>{produto.urlNormalizada ?? '—'}</td>
          </tr>)}</tbody></table>
      </div></div>}
      {resultado && resultado.lotes && resultado.lotes.length > 1 && <div className="lista-afiliados-lotes-gerador" aria-label="Lotes de URLs para o Gerador">
        <h3>URLs divididas para o Gerador Mercado Livre</h3>
        {resultado.lotes.map((lote, indice) => { const urls = lote.map((produto) => produto.urlNormalizada!).join('\n'); return <div className="lista-afiliados-lote-gerador" key={lote[0]?.itemId ?? indice}>
          <div className="extrair-resultado-cabecalho"><div><h4>Lote {indice + 1} de {resultado.lotes!.length}</h4><p>{lote.length} produtos · PENDENTE</p></div>
            <button type="button" className="extrair-secundario" onClick={() => void copiarUrlsDoLote(urls, indice)}>Copiar URLs do lote {indice + 1}</button></div>
          <textarea aria-label={`URLs do lote ${indice + 1}`} value={urls} readOnly rows={Math.min(8, Math.max(2, lote.length))} />
        </div> })}
      </div>}
      {snapshot && <div className="lista-afiliados-snapshot-produtos"><h3>Produtos do lote ativo</h3>
        <div className="lista-afiliados-tabela lista-afiliados-snapshot-tabela"><table><thead><tr><th>Gerador</th><th>ITEM_ID congelado</th><th>Título</th><th>URL enviada</th></tr></thead>
        <tbody>{snapshot.produtos.map((produto) => <tr key={produto.itemId}><td>{produto.posicaoGerador}</td><td>{produto.itemId}</td>
          <td>{produto.titulo ?? '—'}</td><td>{produto.urlNormalizada}</td></tr>)}</tbody></table></div></div>}
      <div className="lista-afiliados-urls">
        <div className="extrair-resultado-cabecalho"><div><h3>URLs para o Gerador Mercado Livre</h3><p>Uma URL por linha, na ordem da prévia.</p></div>
          <button type="button" className="extrair-secundario" disabled={!urlsGerador || snapshotInvalido} onClick={() => void copiarUrls()}>Copiar URLs</button></div>
        <textarea ref={campoUrls} aria-label="URLs para o Gerador Mercado Livre" value={urlsGerador} readOnly rows={8} />
        {!snapshot && <button type="button" className="extrair-secundario" disabled={!resultado?.urlsParaGerador || snapshotInvalido} onClick={() => prepararSnapshot()}>Preparar lote para o Gerador</button>}
        {mensagemCopia && <p role="status" className="lista-afiliados-copia">{mensagemCopia}</p>}
      </div>
      <div className="lista-afiliados-retorno">
        <h3>Retorno do Gerador Mercado Livre</h3>
        <p role="status">Pareamento por posição é provisório: os links ainda não estão validados. A prévia verifica o ITEM_ID do destino e bloqueia divergências. Links não validados exigem conferência e nova validação antes de publicar.</p>
        <label htmlFor="retorno-gerador-lista">Cole aqui exatamente o retorno do Gerador, incluindo links e avisos.</label>
        <textarea id="retorno-gerador-lista" value={retornoTexto} disabled={confirmando || publicando || !snapshot || registro?.status === 'FINALIZADO'} onChange={(evento) => {
          setRetornoTexto(evento.target.value); setRetornoProcessado(null); setMensagemBloco(''); invalidarPrevia()
        }} rows={10} spellCheck={false} />
        <button type="button" disabled={confirmando || publicando || !snapshot || registro?.status === 'FINALIZADO'} onClick={() => {
          if (!registro) return
          const processado = processarRetornoGerador(registro.snapshot.produtos, retornoTexto)
          const proximo = atualizarStatusSnapshot(registro, { status: 'RETORNO PROCESSADO', retornoTexto,
            ...(registro.retornoTexto !== retornoTexto ? { linksConcluidos: [], novosConcluidos: [] } : {}) })
          if (!persistir(proximo)) return
          setRetornoProcessado(processado); setMensagemBloco(''); invalidarPrevia()
        }}>Processar retorno</button>
        {!snapshot && <p>Prepare e salve o lote antes de processar o retorno do Gerador.</p>}
        {retornoAtual && <div className="lista-afiliados-pareamento">
          {retornoLoteAtivo?.errosQuantidade && retornoLoteAtivo.errosQuantidade > 0 && <p role="alert" className="extrair-erro">Lote inconsistente: {retornoLoteAtivo.totalProdutos} produtos originais e {retornoLoteAtivo.totalResultados} resultados que ocupam posição. Revise as linhas destacadas.</p>}
          {retornoLoteAtivo?.errosQuantidade === 0 && retornoLoteAtivo.revisar > 0 && <p role="alert" className="extrair-erro">Há mensagens para revisar. Confira o texto original antes de usar os links.</p>}
          <div className="lista-afiliados-contadores lista-afiliados-contadores-retorno" role="status">
            <div><strong>{retornoLoteAtivo?.totalProdutos ?? snapshot?.quantidade ?? 0}</strong><span>Produtos do lote</span></div>
            <div><strong>{retornoLoteAtivo?.linksValidos ?? 0}</strong><span>Links válidos</span></div>
            <div><strong>{retornoLoteAtivo?.recusados ?? 0}</strong><span>Recusados</span></div>
            <div><strong>{retornoLoteAtivo?.pausados ?? 0}</strong><span>Pausados</span></div>
            <div><strong>{retornoLoteAtivo?.revisar ?? 0}</strong><span>Revisar</span></div>
            <div><strong>{retornoLoteAtivo?.errosQuantidade ?? 0}</strong><span>Erros de quantidade</span></div>
          </div>
          <div className="lista-afiliados-tabela">
            <table><thead><tr><th>Ordem</th><th>ITEM_ID</th><th>Título</th><th>Resultado</th><th>Link afiliado</th><th>Situação</th></tr></thead>
              <tbody>{retornoAtual.pareamentos.map(({ produto, retorno, situacao }) => <tr key={produto.itemId} className={!retorno || retorno.tipo === 'REVISAR' ? 'lista-afiliados-revisar' : ''}>
                <td>{produto.ordem}</td><td>{produto.itemId}</td><td>{produto.titulo ?? '—'}</td>
                <td>{retorno?.tipo ?? 'SEM RESULTADO'}{retorno?.tipo === 'REVISAR' && <small>{retorno.original}</small>}</td>
                <td>{retorno?.link ?? '—'}</td><td>{retorno?.tipo === 'LINK' ? 'NÃO VALIDADO — consulte a prévia' : situacao}</td>
              </tr>)}</tbody></table>
          </div>
          {retornoAtual.excedentes.length > 0 && <div className="lista-afiliados-excedentes" role="alert"><strong>Resultados sem produto correspondente:</strong>
            <ol>{retornoAtual.excedentes.map((item, indice) => <li key={indice}>{item.original}</li>)}</ol>
          </div>}
          <div className="lista-afiliados-bloco">
            <div className="extrair-resultado-cabecalho"><div><h3>Bloco para o atualizador em lote</h3><p>Somente links válidos de um lote consistente e sem mensagens para revisar.</p></div>
              <button type="button" className="extrair-secundario" disabled={!retornoAtual.blocoAtualizador} onClick={() => void copiarBloco()}>Copiar bloco ITEM_ID | link</button></div>
            <textarea ref={campoBloco} aria-label="Bloco ITEM_ID | link" value={retornoAtual.blocoAtualizador} readOnly rows={6} />
            {mensagemBloco && <p role="status" className="lista-afiliados-copia">{mensagemBloco}</p>}
          </div>
          <div className="lista-afiliados-integracao">
            <button type="button" disabled={!retornoAtual.consistente || !retornoAtual.linksValidos || !token.trim() || carregandoPrevia || confirmando || publicando}
              onClick={() => void enviarParaPrevia()}>{carregandoPrevia ? 'Consultando prévia...' : 'Enviar válidos para prévia'}</button>
            {!token.trim() && <p>Informe o token de publicação no acesso acima para consultar a prévia.</p>}
            {erroLote && <p role="alert" className="extrair-erro">{erroLote}</p>}
            {previaAtual && <div className="lista-afiliados-previa">
              <h3>{confirmacao ? 'Prévia consultada — atualização de links concluída' : 'Prévia — nenhuma alteração feita'}</h3>
              <div className="lista-afiliados-contadores lista-afiliados-contadores-retorno" role="status">
                <div><strong>{analisadosPrevia}</strong><span>Analisados</span></div>
                <div><strong>{classificacao.existentes.length}</strong><span>Já existe</span></div>
                <div><strong>{classificacao.novos.length}</strong><span>Novos</span></div>
                <div><strong>{errosPrevia}</strong><span>Erros</span></div>
              </div>
              <div className="lista-afiliados-tabela"><table><thead><tr><th>Linha</th><th>ITEM_ID</th><th>Produto</th><th>Link atual</th><th>Link novo</th><th>Situação</th></tr></thead>
                <tbody>{previaAtual.dados.linhas.map((item) => <tr key={item.linha} className={classificacao.erros.some((erro) => erro.linha === item.linha) ? 'lista-afiliados-revisar' : ''}>
                  <td>{item.linha}</td><td>{item.mercado_livre_id ?? '—'}</td><td>{item.titulo ?? '—'}</td>
                  <td>{item.link_anterior ?? '—'}</td><td>{item.link_novo ?? '—'}</td>
                  <td>{classificacao.erros.find((erro) => erro.linha === item.linha)?.motivo
                    ?? (item.mercado_livre_id && classificacao.existentes.includes(item.mercado_livre_id)
                      ? 'Já existe no Valiô — não será republicado'
                      : item.mercado_livre_id && classificacao.novos.some((novo) => novo.produto.itemId === item.mercado_livre_id)
                        ? 'Novo — pronto para categorização' : item.motivo ?? 'Resultado da prévia não classificado.')}</td>
                </tr>)}</tbody></table></div>
              <button type="button" className="lista-afiliados-confirmar" disabled={!prontos || previaTemFalhas || !!confirmacao || confirmando || publicando}
                onClick={() => void confirmar()}>{confirmando ? 'Atualizando...' : 'Confirmar atualização dos links válidos'}</button>
              <div className="lista-afiliados-novos">
                <h3>Já existe no Valiô</h3>
                <p>{classificacao.existentes.length} produto(s) existente(s) podem seguir pela confirmação de links acima.</p>
                <h3>Produtos novos prontos para publicação</h3>
                {classificacao.novos.length === 0 ? <p>Nenhum produto novo identificado nesta prévia.</p> : <>
                  <p>Produtos ausentes no Valiô. Somente os itens prontos serão enviados após confirmação.</p>
                  <div className="lista-afiliados-tabela"><table><thead><tr><th>ITEM_ID</th><th>Título</th><th>Categoria</th><th>Preço</th><th>Link afiliado oficial</th><th>Situação</th></tr></thead>
                    <tbody>{classificacao.novos.map((item) => <tr key={item.produto.itemId} className={item.situacao !== 'PRONTO PARA PUBLICAR' ? 'lista-afiliados-revisar' : ''}>
                      <td>{item.produto.itemId}</td><td>{item.dados?.titulo ?? item.produto.titulo ?? '—'}</td>
                      <td><select aria-label={`Categoria de ${item.produto.itemId}`} value={categoriasNovos.get(item.produto.itemId) ?? ''}
                        disabled={publicando || confirmando} onChange={(evento) => {
                          const proximas = new Map(categoriasNovos)
                          if (evento.target.value) proximas.set(item.produto.itemId, evento.target.value as CategoriaValio)
                          else proximas.delete(item.produto.itemId)
                          setCategoriasNovos(proximas)
                          if (registro) persistir({ ...registro, categorias: Object.fromEntries(proximas) })
                          setPreparadaPublicacao(false); setResultadoPublicacao(null)
                        }}><option value="">Selecione</option>{CATEGORIAS_VALIO.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}</select></td>
                      <td>{item.dados?.precoAtual ?? '—'}</td><td>{item.link}</td>
                      <td>{novosJaExistentes.has(item.produto.itemId) ? 'JÁ EXISTE' : item.situacao}{item.faltantes.length > 0 && <small>Faltando: {item.faltantes.join(', ')}</small>}</td>
                    </tr>)}</tbody></table></div>
                  <button type="button" disabled={!novosProntos.length || publicando || confirmando || !token.trim()}
                    onClick={() => { setPreparadaPublicacao(true); setErroPublicacao(''); setResultadoPublicacao(null) }}>Publicar novos no Valiô</button>
                  {preparadaPublicacao && <div className="lista-afiliados-publicacao-previa">
                    <strong>Prévia de publicação — nenhuma alteração feita</strong>
                    <p>{novosProntos.length} produto(s) pronto(s) com categoria, dados completos e link oficial.</p>
                    <button type="button" disabled={!novosProntos.length || publicando || confirmando || !token.trim()}
                      onClick={() => void publicarNovos()}>{publicando ? 'Publicando...' : 'Confirmar publicação dos novos'}</button>
                  </div>}
                  {erroPublicacao && <p role="alert" className="extrair-erro">{erroPublicacao}</p>}
                  {ignoradosPublicacao.length > 0 && <p role="status">Já existentes, não publicados: {ignoradosPublicacao.join(', ')}</p>}
                  {resultadoPublicacao && <div role="status" className="lista-afiliados-confirmacao">
                    <strong>Resultado da publicação</strong><p>Criados: {resultadoPublicacao.criados} · Erros: {resultadoPublicacao.erros.length}</p>
                    {resultadoPublicacao.erros.length > 0 && <ul>{resultadoPublicacao.erros.map((falha) => <li key={falha.id}>{falha.id}: {falha.motivo}</li>)}</ul>}
                  </div>}
                </>}
              </div>
            </div>}
            {confirmacao && <div role="status" className="lista-afiliados-confirmacao">
              <strong>Resultado da atualização em lote</strong>
              <p>Solicitados: {confirmacao.solicitadas} · Atualizados: {confirmacao.atualizadas} · Com erro: {confirmacao.erros}</p>
              <p>ITEM_IDs atualizados: {confirmacao.idsAtualizados.join(', ') || 'Nenhum'}</p>
              {confirmacao.falhas.length > 0 && <ul>{confirmacao.falhas.map((falha) => <li key={falha.linha}>
                Linha {falha.linha} ({falha.mercado_livre_id ?? 'ITEM_ID inválido'}): {falha.motivo}
              </li>)}</ul>}
            </div>}
          </div>
        </div>}
      </div>
    </div>}
  </section>
}
