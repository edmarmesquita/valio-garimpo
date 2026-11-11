import { useState } from 'react'
import AreaOperacional from '../components/AreaOperacional'
import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import { carregarCatalogo } from '../lib/manutencaoVitrine'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { CATEGORIAS_VALIO } from '../lib/produtosGarimpados'
import type { CategoriaValio } from '../lib/produtosGarimpados'
import { analisarArquivoInativos, classificarInativos, urlAnuncioCandidato, urlBuscaTituloCandidato } from '../lib/recuperarInativos'
import type { CapturaInativo, ResultadoArquivoInativos } from '../lib/recuperarInativos'
import { pedidosDosExatos, reativarExatos, selecionarExatos, substituirInativo, validarDestinoSubstituicao } from '../lib/reativarInativos'
import type { ResultadoReativacao } from '../lib/reativarInativos'
import './RecuperarInativosPage.css'

const reais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const LOTE_SEM_CORRESPONDENCIA = 25
type SubstituicaoSelecionada = { inativo: ProdutoCatalogo; candidato: CapturaInativo }
type FormularioSubstituicao = { link: string; categoria: CategoriaValio; descricao: string }

function LinksCandidato({ produto }: { produto: CapturaInativo }) {
  const url = urlAnuncioCandidato(produto)
  const busca = urlBuscaTituloCandidato(produto.titulo)
  return <>
    <p>URL do anúncio: {url ? <a href={url} target="_blank" rel="noreferrer">{url}</a>
      : 'URL do anúncio não pôde ser determinada com segurança.'}</p>
    {!url && busca && <p>
      <a href={busca} target="_blank" rel="noreferrer">Buscar pelo título no Mercado Livre</a>
      <br />A busca é apenas apoio visual: não confirma o ITEM_ID. O link meli.la ainda precisa resolver exatamente para {produto.itemId}.
    </p>}
  </>
}

export default function RecuperarInativosPage() {
  const { token } = useSessaoOperacional()
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [capturas, setCapturas] = useState<CapturaInativo[]>([])
  const [arquivos, setArquivos] = useState<string[]>([])
  const [arquivosProcessados, setArquivosProcessados] = useState(0)
  const [cardsBrutos, setCardsBrutos] = useState(0)
  const [duplicadosNaOrigem, setDuplicadosNaOrigem] = useState(0)
  const [naoReconhecidos, setNaoReconhecidos] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmacao, setConfirmacao] = useState<ReturnType<typeof selecionarExatos> | null>(null)
  const [resultado, setResultado] = useState<ResultadoReativacao[] | null>(null)
  const [candidatosSelecionados, setCandidatosSelecionados] = useState<Map<string, SubstituicaoSelecionada>>(new Map())
  const [previaSubstituicoes, setPreviaSubstituicoes] = useState<SubstituicaoSelecionada[] | null>(null)
  const [formulariosSubstituicao, setFormulariosSubstituicao] = useState<Map<string, FormularioSubstituicao>>(new Map())
  const [destinosValidados, setDestinosValidados] = useState<Map<string, string>>(new Map())
  const [imagensValidadas, setImagensValidadas] = useState<Map<string, string>>(new Map())
  const [errosValidacaoDestino, setErrosValidacaoDestino] = useState<Map<string, string>>(new Map())
  const [resultadoSubstituicoes, setResultadoSubstituicoes] = useState<{ id: string; ok: boolean; motivo?: string }[] | null>(null)
  const [limiteSemCorrespondencia, setLimiteSemCorrespondencia] = useState(LOTE_SEM_CORRESPONDENCIA)
  const diagnostico = catalogo ? classificarInativos(catalogo, capturas) : []
  const exatos = diagnostico.filter((item) => item.tipo === 'EXATO')
  const candidatos = diagnostico.filter((item) => item.tipo === 'CANDIDATO')
  const semCorrespondencia = diagnostico.filter((item) => item.tipo === 'SEM CORRESPONDÊNCIA')
  const conflitosPreco = diagnostico.filter((item) => item.conflitoPreco)
  const idsCapturados = new Set(capturas.map((item) => item.itemId))
  const duplicadosCapturados = duplicadosNaOrigem + Math.max(0, capturas.length - idsCapturados.size)
  const selecionadosExatos = selecionarExatos(exatos, selecionados)
  const pendenciasSubstituicao = (previaSubstituicoes ?? []).flatMap((item) => {
    const chave = chaveSubstituicao(item)
    const form = formulariosSubstituicao.get(chave)
    const pendencias: string[] = []
    if (!item.inativo.id) pendencias.push(`${item.candidato.itemId}: ID interno indisponível; recarregue o catálogo.`)
    if (!item.candidato.imagem && !imagensValidadas.get(chave)) pendencias.push(`${item.candidato.itemId}: imagem principal não encontrada na captura nem na validação do meli.la.`)
    if (!form?.link.trim()) pendencias.push(`${item.candidato.itemId}: informe o link meli.la.`)
    else if (destinosValidados.get(chave) !== form.link.trim()) pendencias.push(`${item.candidato.itemId}: valide o destino do link para este ITEM_ID.`)
    return pendencias
  })

  function alternar(id: string) {
    setSelecionados((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo })
    setConfirmacao(null)
  }

  async function confirmarReativacao() {
    if (!confirmacao?.length || ocupado) return
    setOcupado(true); setErro(''); setResultado(null)
    try {
      const respostas = await reativarExatos(token, pedidosDosExatos(confirmacao))
      setResultado(respostas)
      const reativados = new Set(respostas.filter((item) => item.status === 'REATIVADO').map((item) => item.mercado_livre_id))
      setCatalogo((atual) => atual?.map((item) => reativados.has(item.mercadoLivreId)
        ? { ...item, ativo: true, preco: confirmacao.find((linha) => linha.inativo.mercadoLivreId === item.mercadoLivreId)!.exato!.preco }
        : item) ?? null)
      setSelecionados((atual) => new Set([...atual].filter((id) => !reativados.has(id))))
      setConfirmacao(null)
      try { setCatalogo(await carregarCatalogo(token)) }
      catch { setErro('Reativação concluída, mas não foi possível recarregar o catálogo. Confira o resultado abaixo.') }
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na reativação.') }
    finally { setOcupado(false) }
  }

  async function consultarCatalogo() {
    setOcupado(true); setErro('')
    setConfirmacao(null)
    try { setCatalogo(await carregarCatalogo(token)); setCandidatosSelecionados(new Map()); setPreviaSubstituicoes(null) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar o catálogo.') }
    finally { setOcupado(false) }
  }

  async function adicionarArquivos(lista: FileList | null) {
    if (!lista?.length) return
    setOcupado(true); setErro('')
    setConfirmacao(null)
    setPreviaSubstituicoes(null); setCandidatosSelecionados(new Map())
    try {
      const resultados: ResultadoArquivoInativos[] = []
      for (const arquivo of Array.from(lista)) {
        if (!/\.(har|json|html?|html?\.txt)$/i.test(arquivo.name)) throw new Error(`Formato não aceito: ${arquivo.name}`)
        if (arquivo.size > 50 * 1024 * 1024) throw new Error(`Arquivo maior que 50 MB: ${arquivo.name}`)
        resultados.push(analisarArquivoInativos(await arquivo.text(), arquivo.name))
      }
      const novos = resultados.flatMap((resultado) => resultado.capturas)
      const rejeitados = Array.from(lista).filter((_, indice) => !resultados[indice]?.reconhecido).map((arquivo) => arquivo.name)
      setCapturas((atual) => [...atual, ...novos])
      setArquivos((atual) => [...atual, ...Array.from(lista, (arquivo) => arquivo.name)])
      setArquivosProcessados((atual) => atual + lista.length)
      setCardsBrutos((atual) => atual + resultados.reduce((total, resultado) => total + resultado.cardsBrutos, 0))
      setDuplicadosNaOrigem((atual) => atual + resultados.reduce((total, resultado) =>
        total + (resultado.formato === 'OFERTAS_NORDIC' ? 0 : resultado.duplicados), 0))
      setNaoReconhecidos((atual) => [...atual, ...rejeitados])
      if (rejeitados.length) setErro(`Não foi possível reconhecer ${rejeitados.length} arquivo(s): ${rejeitados.join(', ')}. Envie HTML de produtos do Mercado Livre, lista estruturada ou HAR válido.`)
      setLimiteSemCorrespondencia(LOTE_SEM_CORRESPONDENCIA)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível ler os arquivos.') }
    finally { setOcupado(false) }
  }

  function chaveSubstituicao(item: SubstituicaoSelecionada) {
    return `${item.inativo.mercadoLivreId}:${item.candidato.itemId}`
  }
  function alternarCandidato(inativo: ProdutoCatalogo, candidato: CapturaInativo) {
    setCandidatosSelecionados((atuais) => {
      const novos = new Map(atuais)
      if (novos.get(inativo.mercadoLivreId)?.candidato.itemId === candidato.itemId) novos.delete(inativo.mercadoLivreId)
      else novos.set(inativo.mercadoLivreId, { inativo, candidato })
      return novos
    })
  }
  function revisarSubstituicoes() {
    const itens = [...candidatosSelecionados.values()]
    setPreviaSubstituicoes(itens)
    setResultadoSubstituicoes(null)
    setDestinosValidados(new Map())
    setImagensValidadas(new Map())
    setErrosValidacaoDestino(new Map())
    setFormulariosSubstituicao(new Map(itens.map((item) => [chaveSubstituicao(item), {
      link: '', categoria: item.inativo.categoria, descricao: '',
    }])))
  }
  async function validarDestinoCandidato(item: SubstituicaoSelecionada) {
    if (ocupado) return
    const chave = chaveSubstituicao(item)
    const link = formulariosSubstituicao.get(chave)?.link.trim() ?? ''
    if (!link) {
      setErrosValidacaoDestino((atuais) => new Map(atuais).set(chave, 'Informe o link meli.la antes de validar.'))
      return
    }
    setOcupado(true)
    setErrosValidacaoDestino((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
    setDestinosValidados((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
    setImagensValidadas((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
    try {
      const imagem = await validarDestinoSubstituicao(token, item.candidato.itemId, link)
      setDestinosValidados((atuais) => new Map(atuais).set(chave, link))
      setImagensValidadas((atuais) => {
        const novos = new Map(atuais)
        if (imagem) novos.set(chave, imagem)
        return novos
      })
    } catch (falha) {
      setImagensValidadas((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
      setErrosValidacaoDestino((atuais) => new Map(atuais).set(chave,
        falha instanceof Error ? falha.message : 'Não foi possível validar o destino do link afiliado.'))
    } finally { setOcupado(false) }
  }
  async function confirmarSubstituicoes() {
    if (!previaSubstituicoes?.length || ocupado) return
    setOcupado(true); setErro(''); setResultadoSubstituicoes(null)
    const resultados: { id: string; ok: boolean; motivo?: string }[] = []
    for (const item of previaSubstituicoes) {
      const form = formulariosSubstituicao.get(chaveSubstituicao(item))!
      try {
        if (!item.inativo.id) throw new Error('ID interno indisponível; recarregue o catálogo.')
        const imagem = item.candidato.imagem ?? imagensValidadas.get(chaveSubstituicao(item))
        if (!imagem) throw new Error('Imagem principal não encontrada na captura nem na validação do meli.la.')
        await substituirInativo(token, {
          id_interno: item.inativo.id, item_id_anterior: item.inativo.mercadoLivreId,
          mercado_livre_id: item.candidato.itemId, titulo: item.candidato.titulo,
          descricao: form.descricao, preco: item.candidato.preco, moeda: 'BRL',
          imagem, link_afiliado: form.link.trim(), categoria: form.categoria,
        })
        resultados.push({ id: item.candidato.itemId, ok: true })
      } catch (falha) {
        resultados.push({ id: item.candidato.itemId, ok: false,
          motivo: falha instanceof Error ? falha.message : 'Falha ao substituir produto.' })
      }
    }
    setResultadoSubstituicoes(resultados)
    const idsSucesso = new Set(resultados.filter((item) => item.ok).map((item) => item.id))
    if (idsSucesso.size) {
      setCandidatosSelecionados((atuais) => new Map([...atuais].filter(([, item]) => !idsSucesso.has(item.candidato.itemId))))
      setPreviaSubstituicoes((atuais) => atuais?.filter((item) => !idsSucesso.has(item.candidato.itemId)) ?? null)
      try { setCatalogo(await carregarCatalogo(token)) }
      catch { setErro('Substituição concluída, mas não foi possível recarregar o catálogo.') }
    }
    setOcupado(false)
  }

  return <AreaOperacional titulo="Recuperar inativos" descricao="Prévia de correspondências entre produtos inativos e capturas do Mercado Livre.">
    <section className="extrair-card recuperar-inativos" aria-label="Diagnóstico de produtos inativos">
      <p>EXATOS podem ser reativados pelo mesmo ITEM_ID. CANDIDATOS só podem ser substituídos manualmente após revisão e confirmação explícita.</p>
      <button type="button" disabled={!token.trim() || ocupado} onClick={() => void consultarCatalogo()}>
        {ocupado ? 'Aguarde...' : 'Carregar catálogo de inativos'}
      </button>
      <label className="recuperar-inativos__arquivo">HTMLs, documentos de listas ou HARs do Mercado Livre
        <input type="file" multiple accept=".html,.htm,.txt,.json,.har" disabled={ocupado}
          onChange={(evento) => { void adicionarArquivos(evento.currentTarget.files); evento.currentTarget.value = '' }} />
      </label>
      {arquivosProcessados > 0 && <p aria-label="Resumo dos arquivos">Arquivos processados: {arquivosProcessados} · Cards lidos: {cardsBrutos} · ITEM_IDs únicos: {idsCapturados.size} · Duplicados: {duplicadosCapturados} · Não reconhecidos: {naoReconhecidos.length}</p>}
      {naoReconhecidos.length > 0 && <p>Arquivos não reconhecidos: {naoReconhecidos.join(', ')}</p>}
      {arquivos.length > 0 && <p>Arquivos analisados: {arquivos.join(', ')}</p>}
      {erro && <p role="alert" className="extrair-erro">{erro}</p>}
      <div className="recuperar-inativos__resumo" aria-label="Resumo do diagnóstico">
        <p>Total de inativos: <strong>{diagnostico.length}</strong></p>
        <p>Reativação segura (ITEM_ID exato): <strong>{exatos.length}</strong></p>
        <p>Candidatos à substituição: <strong>{candidatos.length}</strong></p>
        <p>Sem correspondência: <strong>{semCorrespondencia.length}</strong></p>
      </div>
      {conflitosPreco.length > 0 && <p role="status">Conflitos de preço que exigem revisão: <strong>{conflitosPreco.length}</strong></p>}
      <p>Candidatos por título são apenas sugestões para conferência manual.</p>
      <h2>EXATO — mesmo ITEM_ID</h2>
      <div className="recuperar-inativos__acoes">
        <button type="button" disabled={ocupado || !exatos.length} onClick={() => { setSelecionados(new Set(exatos.map((item) => item.inativo.mercadoLivreId))); setConfirmacao(null) }}>Selecionar todos os exatos</button>
        <button type="button" disabled={ocupado || !selecionados.size} onClick={() => { setSelecionados(new Set()); setConfirmacao(null) }}>Limpar seleção</button>
        <span>{selecionadosExatos.length} de {exatos.length} selecionados</span>
        <button type="button" disabled={ocupado || !selecionadosExatos.length} onClick={() => setConfirmacao(selecionadosExatos)}>Reativar selecionados</button>
      </div>
      {exatos.length === 0 && <p>Nenhum produto com ITEM_ID exato.</p>}
      {exatos.map(({ inativo, exato }) => <article key={inativo.mercadoLivreId} className="recuperar-inativos__item">
        <label><input type="checkbox" aria-label={`Selecionar ${inativo.mercadoLivreId}`} checked={selecionados.has(inativo.mercadoLivreId)} disabled={ocupado}
          onChange={() => alternar(inativo.mercadoLivreId)} /> Selecionar para reativação</label>
        <h3>{inativo.titulo}</h3>
        <p>ITEM_ID: {inativo.mercadoLivreId} · Categoria: {inativo.categoria}</p>
        <p>Preço no Valiô: {reais(inativo.preco)} · Preço no HTML: {reais(exato!.preco)} · Origem: {(exato!.origens ?? [exato!.origem]).join(', ')}</p>
      </article>)}
      {confirmacao && <section className="recuperar-inativos__confirmacao" aria-label="Confirmar reativação">
        <h3>Você está prestes a reativar {confirmacao.length} {confirmacao.length === 1 ? 'produto' : 'produtos'}.</h3>
        {confirmacao.map((item) => <p key={item.inativo.mercadoLivreId}>{item.inativo.mercadoLivreId} · {item.inativo.titulo} · {reais(item.inativo.preco)} → {reais(item.exato!.preco)}</p>)}
        <button type="button" disabled={ocupado} onClick={() => setConfirmacao(null)}>Cancelar</button>
        <button type="button" disabled={ocupado} onClick={() => void confirmarReativacao()}>Confirmar reativação</button>
      </section>}
      {resultado && <section aria-label="Resultado da reativação">
        <p>{resultado.filter((item) => item.status === 'REATIVADO').length} {resultado.filter((item) => item.status === 'REATIVADO').length === 1 ? 'produto reativado' : 'produtos reativados'} · {resultado.filter((item) => item.status === 'ERRO').length} erros</p>
        {resultado.filter((item) => item.status === 'ERRO').map((item, indice) => <p key={`${item.mercado_livre_id}-${indice}`}>{item.mercado_livre_id}: {item.motivo}</p>)}
      </section>}
      <h2>CANDIDATO — outro ITEM_ID</h2>
      <div className="recuperar-inativos__acoes">
        <span>{candidatosSelecionados.size} selecionado(s) para substituição</span>
        <button type="button" disabled={ocupado || !candidatosSelecionados.size} onClick={revisarSubstituicoes}>Revisar substituições selecionadas</button>
      </div>
      {candidatos.length === 0 && <p>Nenhum candidato conservador.</p>}
      {candidatos.map(({ inativo, candidatos: opcoes }) => <article key={inativo.mercadoLivreId} className="recuperar-inativos__item">
        <div className="recuperar-inativos__comparacao">
          <div><h3>Produto inativo</h3>{inativo.imagem && <img className="recuperar-inativos__imagem" src={inativo.imagem} alt={`Imagem atual de ${inativo.titulo}`} />}
            <p>ID interno: {inativo.id ?? 'indisponível'} · ITEM_ID: {inativo.mercadoLivreId}</p><p>{inativo.titulo}</p>
            <p>{reais(inativo.preco)} · {inativo.categoria}</p><p>Link afiliado: {inativo.linkAfiliado}</p></div>
          <div><h3>Candidato</h3>{opcoes.map(({ produto, confianca, motivo }) => <div key={produto.itemId}>
            {produto.imagem && <img className="recuperar-inativos__imagem" src={produto.imagem} alt={`Imagem candidata de ${produto.titulo}`} />}
            <p>{produto.itemId} · {produto.titulo}</p><p>{reais(produto.preco)} · Origem: {produto.origem}</p>
            <p>productId: {produto.productId ?? '—'} · userProductId: {produto.userProductId ?? '—'}</p>
            <LinksCandidato produto={produto} />
            <p>Confiança: {confianca} · {motivo}</p>
            <button type="button" disabled={ocupado} onClick={() => alternarCandidato(inativo, produto)}>
              {candidatosSelecionados.get(inativo.mercadoLivreId)?.candidato.itemId === produto.itemId ? 'Remover seleção' : 'Selecionar para substituição'}
            </button>
          </div>)}</div>
        </div>
      </article>)}
      {previaSubstituicoes && previaSubstituicoes.length > 0 && <section className="recuperar-inativos__confirmacao" aria-label="Revisar substituições">
        <h3>Revise cada substituição</h3>
        <p role="alert">Esta ação substituirá o produto antigo por outro produto no mesmo registro.</p>
        {previaSubstituicoes.map((item) => {
          const chave = chaveSubstituicao(item); const form = formulariosSubstituicao.get(chave)!
          const destinoValidado = destinosValidados.get(chave) === form.link.trim()
          const imagemCandidato = item.candidato.imagem ?? imagensValidadas.get(chave) ?? null
          return <article key={chave} className="recuperar-inativos__item recuperar-inativos__comparacao">
            <div><h4>ANTES</h4>{item.inativo.imagem && <img className="recuperar-inativos__imagem" src={item.inativo.imagem} alt="Imagem antiga" />}
              <p>ID interno: {item.inativo.id ?? 'indisponível'}</p><p>ITEM_ID: {item.inativo.mercadoLivreId}</p><p>{item.inativo.titulo}</p>
              <p>{reais(item.inativo.preco)} · {item.inativo.categoria}</p><p>{item.inativo.linkAfiliado}</p></div>
            <div><h4>DEPOIS</h4>{imagemCandidato && <img className="recuperar-inativos__imagem" src={imagemCandidato} alt="Imagem nova" />}
              {!item.candidato.imagem && imagemCandidato && <p>Imagem obtida do anúncio validado pelo link afiliado.</p>}
              <p>ITEM_ID: {item.candidato.itemId}</p><p>{item.candidato.titulo}</p><p>{reais(item.candidato.preco)} · BRL</p>
              <p>productId: {item.candidato.productId ?? '—'} · userProductId: {item.candidato.userProductId ?? '—'}</p>
              <LinksCandidato produto={item.candidato} />
              <label>Link afiliado novo (meli.la)
                <input aria-label={`Link afiliado para ${item.candidato.itemId}`} value={form.link}
                  onChange={(evento) => {
                    setFormulariosSubstituicao((atuais) => new Map(atuais).set(chave, { ...form, link: evento.target.value }))
                    setDestinosValidados((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
                    setImagensValidadas((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
                    setErrosValidacaoDestino((atuais) => { const novos = new Map(atuais); novos.delete(chave); return novos })
                  }} />
              </label>
              <p>Valide o destino antes de confirmar. Só será aceito se resolver exatamente para {item.candidato.itemId}.</p>
              <button type="button" disabled={ocupado || !form.link.trim()} onClick={() => void validarDestinoCandidato(item)}>
                {ocupado ? 'Validando destino…' : 'Validar meli.la'}
              </button>
              {destinoValidado && <p role="status">Destino validado para {item.candidato.itemId}. A confirmação revalidará o link antes de aplicar.</p>}
              {errosValidacaoDestino.get(chave) && <p role="alert">{errosValidacaoDestino.get(chave)}</p>}
              <label>Descrição do produto (opcional)
                <textarea aria-label={`Descrição para ${item.candidato.itemId}`} value={form.descricao}
                  onChange={(evento) => setFormulariosSubstituicao((atuais) => new Map(atuais).set(chave, { ...form, descricao: evento.target.value }))} />
              </label>
              <label>Categoria a salvar
                <select aria-label={`Categoria para ${item.candidato.itemId}`} value={form.categoria}
                  onChange={(evento) => setFormulariosSubstituicao((atuais) => new Map(atuais).set(chave, { ...form, categoria: evento.target.value as CategoriaValio }))}>
                  {CATEGORIAS_VALIO.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
                </select>
              </label>
            </div>
          </article>
        })}
        {pendenciasSubstituicao.length > 0 && <div role="alert">
          <strong>A confirmação está bloqueada:</strong>
          <ul>{pendenciasSubstituicao.map((motivo) => <li key={motivo}>{motivo}</li>)}</ul>
        </div>}
        <div className="recuperar-inativos__confirmacao-acoes">
          <button type="button" disabled={ocupado} onClick={() => setPreviaSubstituicoes(null)}>Cancelar</button>
          <button type="button" disabled={ocupado || pendenciasSubstituicao.length > 0} onClick={() => void confirmarSubstituicoes()}>
            {ocupado ? 'Aplicando substituição…' : 'Confirmar substituição'}
          </button>
        </div>
      </section>}
      {resultadoSubstituicoes && <section aria-label="Resultado das substituições">
        {resultadoSubstituicoes.map((item, indice) => <p key={`${item.id}-${indice}`} role={item.ok ? 'status' : 'alert'}>
          {item.id}: {item.ok ? 'substituído e reativado' : item.motivo}
        </p>)}
      </section>}
      <h2>SEM CORRESPONDÊNCIA</h2>
      {semCorrespondencia.slice(0, limiteSemCorrespondencia).map(({ inativo, conflitoPreco }) => <p key={inativo.mercadoLivreId}>
        {inativo.mercadoLivreId} · {inativo.titulo} · {reais(inativo.preco)}
        {conflitoPreco && <strong> · Conflito de preço: {conflitoPreco.precos.map(reais).join(' / ')} · origem: {conflitoPreco.origens.join(', ')}</strong>}
      </p>)}
      <p aria-live="polite">{Math.min(limiteSemCorrespondencia, semCorrespondencia.length)} de {semCorrespondencia.length} exibidos</p>
      {limiteSemCorrespondencia < semCorrespondencia.length && <button type="button"
        onClick={() => setLimiteSemCorrespondencia((atual) => Math.min(atual + LOTE_SEM_CORRESPONDENCIA, semCorrespondencia.length))}>
        Mostrar mais
      </button>}
    </section>
  </AreaOperacional>
}
