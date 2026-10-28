import { useState } from 'react'
import AreaOperacional from '../components/AreaOperacional'
import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import { carregarCatalogo } from '../lib/manutencaoVitrine'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { classificarInativos, extrairArquivoInativos } from '../lib/recuperarInativos'
import type { CapturaInativo } from '../lib/recuperarInativos'
import { pedidosDosExatos, reativarExatos, selecionarExatos } from '../lib/reativarInativos'
import type { ResultadoReativacao } from '../lib/reativarInativos'
import './RecuperarInativosPage.css'

const reais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const LOTE_SEM_CORRESPONDENCIA = 25

export default function RecuperarInativosPage() {
  const { token } = useSessaoOperacional()
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [capturas, setCapturas] = useState<CapturaInativo[]>([])
  const [arquivos, setArquivos] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmacao, setConfirmacao] = useState<ReturnType<typeof selecionarExatos> | null>(null)
  const [resultado, setResultado] = useState<ResultadoReativacao[] | null>(null)
  const [limiteSemCorrespondencia, setLimiteSemCorrespondencia] = useState(LOTE_SEM_CORRESPONDENCIA)
  const diagnostico = catalogo ? classificarInativos(catalogo, capturas) : []
  const exatos = diagnostico.filter((item) => item.tipo === 'EXATO')
  const candidatos = diagnostico.filter((item) => item.tipo === 'CANDIDATO')
  const semCorrespondencia = diagnostico.filter((item) => item.tipo === 'SEM CORRESPONDÊNCIA')
  const selecionadosExatos = selecionarExatos(exatos, selecionados)

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
    try { setCatalogo(await carregarCatalogo(token)) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar o catálogo.') }
    finally { setOcupado(false) }
  }

  async function adicionarArquivos(lista: FileList | null) {
    if (!lista?.length) return
    setOcupado(true); setErro('')
    setConfirmacao(null)
    try {
      const novos: CapturaInativo[] = []
      for (const arquivo of Array.from(lista)) {
        if (!/\.(har|json|html?|html?\.txt)$/i.test(arquivo.name)) throw new Error(`Formato não aceito: ${arquivo.name}`)
        if (arquivo.size > 50 * 1024 * 1024) throw new Error(`Arquivo maior que 50 MB: ${arquivo.name}`)
        novos.push(...extrairArquivoInativos(await arquivo.text(), arquivo.name))
      }
      setCapturas((atual) => [...atual, ...novos])
      setArquivos((atual) => [...atual, ...Array.from(lista, (arquivo) => arquivo.name)])
      setLimiteSemCorrespondencia(LOTE_SEM_CORRESPONDENCIA)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível ler os arquivos.') }
    finally { setOcupado(false) }
  }

  return <AreaOperacional titulo="Recuperar inativos" descricao="Prévia de correspondências entre produtos inativos e capturas do Mercado Livre.">
    <section className="extrair-card recuperar-inativos" aria-label="Diagnóstico de produtos inativos">
      <p>Reativação disponível somente para correspondências EXATAS, após seleção e confirmação explícita.</p>
      <button type="button" disabled={!token.trim() || ocupado} onClick={() => void consultarCatalogo()}>
        {ocupado ? 'Aguarde...' : 'Carregar catálogo de inativos'}
      </button>
      <label className="recuperar-inativos__arquivo">HTMLs, documentos de listas ou HARs do Mercado Livre
        <input type="file" multiple accept=".html,.htm,.txt,.json,.har" disabled={ocupado}
          onChange={(evento) => { void adicionarArquivos(evento.currentTarget.files); evento.currentTarget.value = '' }} />
      </label>
      {arquivos.length > 0 && <p>Arquivos analisados: {arquivos.join(', ')}</p>}
      {erro && <p role="alert" className="extrair-erro">{erro}</p>}
      <div className="recuperar-inativos__resumo" aria-label="Resumo do diagnóstico">
        <p>Total de inativos: <strong>{diagnostico.length}</strong></p>
        <p>Reativação segura (ITEM_ID exato): <strong>{exatos.length}</strong></p>
        <p>Candidatos à substituição: <strong>{candidatos.length}</strong></p>
        <p>Sem correspondência: <strong>{semCorrespondencia.length}</strong></p>
      </div>
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
        <p>Preço no Valiô: {reais(inativo.preco)} · Preço no HTML: {reais(exato!.preco)} · Origem: {exato!.origem}</p>
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
      {candidatos.length === 0 && <p>Nenhum candidato conservador.</p>}
      {candidatos.map(({ inativo, candidatos: opcoes }) => <article key={inativo.mercadoLivreId} className="recuperar-inativos__item">
        <div className="recuperar-inativos__comparacao">
          <div><h3>Produto inativo</h3><p>{inativo.mercadoLivreId}</p><p>{inativo.titulo}</p>
            <p>{reais(inativo.preco)} · {inativo.categoria}</p></div>
          <div><h3>Candidato</h3>{opcoes.map(({ produto, confianca, motivo }) => <div key={produto.itemId}>
            <p>{produto.itemId} · {produto.titulo}</p><p>{reais(produto.preco)} · Origem: {produto.origem}</p>
            <p>productId: {produto.productId ?? '—'} · userProductId: {produto.userProductId ?? '—'}</p>
            <p>Confiança: {confianca} · {motivo}</p>
          </div>)}</div>
        </div>
      </article>)}
      <h2>SEM CORRESPONDÊNCIA</h2>
      {semCorrespondencia.slice(0, limiteSemCorrespondencia).map(({ inativo }) => <p key={inativo.mercadoLivreId}>
        {inativo.mercadoLivreId} · {inativo.titulo} · {reais(inativo.preco)}
      </p>)}
      <p aria-live="polite">{Math.min(limiteSemCorrespondencia, semCorrespondencia.length)} de {semCorrespondencia.length} exibidos</p>
      {limiteSemCorrespondencia < semCorrespondencia.length && <button type="button"
        onClick={() => setLimiteSemCorrespondencia((atual) => Math.min(atual + LOTE_SEM_CORRESPONDENCIA, semCorrespondencia.length))}>
        Mostrar mais
      </button>}
    </section>
  </AreaOperacional>
}
