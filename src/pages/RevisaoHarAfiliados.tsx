import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { analisarDocumentoLista, analisarHar, combinarHars } from '../lib/harAfiliadosParser'
import type { ResultadoParsingHar } from '../lib/harAfiliadosParser'
import { compararHarCatalogo, filtrarComparacaoHar, filtrosHar } from '../lib/compararHarCatalogo'
import type { FiltroHar } from '../lib/compararHarCatalogo'
import { analisarCatalogoCsv } from '../lib/catalogoCsv'
import type { CatalogoCsv } from '../lib/catalogoCsv'
import { candidatoSeguroHar, gerarPreviaHar, motivosBloqueioHar, selecionarCandidatosHar } from '../lib/previaHar'
import type { PreviaFinalHar } from '../lib/previaHar'
import ConfirmacaoPrecosHar from './ConfirmacaoPrecosHar'
import './RevisaoHarAfiliados.css'

const reais = (valor: number | null) => valor === null ? '—' : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const limiteArquivo = 50 * 1024 * 1024
const percentual = (valor: number | null) => valor === null ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

export default function RevisaoHarAfiliados({ catalogo, erroCatalogo, carregandoCatalogo, token = '' }: {
  catalogo: ProdutoCatalogo[] | null; erroCatalogo: string; carregandoCatalogo: boolean; token?: string
}) {
  const [arquivos, setArquivos] = useState<File[]>([])
  const [resultado, setResultado] = useState<ResultadoParsingHar | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<FiltroHar>('Todos')
  const input = useRef<HTMLInputElement>(null)
  const geracao = useRef(0)
  const [fonte, setFonte] = useState<'api' | 'csv'>('api')
  const [csv, setCsv] = useState<{ nome: string; dados: CatalogoCsv } | null>(null)
  const [erroCsv, setErroCsv] = useState('')
  const [lendoCsv, setLendoCsv] = useState(false)
  const geracaoCsv = useRef(0)
  const inputCsv = useRef<HTMLInputElement>(null)
  const catalogoEscolhido = fonte === 'csv' ? csv?.dados.produtos ?? null : !erroCatalogo && !carregandoCatalogo ? catalogo : null
  const comparacao = resultado && catalogoEscolhido ? compararHarCatalogo(resultado, catalogoEscolhido) : null
  const idsEncontrados = new Set(comparacao?.encontrados.map((p) => p.har.itemId) ?? [])
  const filtrados = comparacao ? filtrarComparacaoHar(comparacao.encontrados, filtro) : []
  const contexto = useMemo(() => ({ resultado, catalogo, csv, fonte, arquivos, erroCatalogo, carregandoCatalogo, analisando, lendoCsv }),
    [resultado, catalogo, csv, fonte, arquivos, erroCatalogo, carregandoCatalogo, analisando, lendoCsv])
  const previaAutorizada = useRef<{ contexto: typeof contexto; previa: PreviaFinalHar } | null>(null)
  useLayoutEffect(() => { if (previaAutorizada.current?.contexto !== contexto) previaAutorizada.current = null }, [contexto])
  const [selecao, setSelecao] = useState<{ contexto: typeof contexto; ids: string[]; previa: PreviaFinalHar | null }>({ contexto, ids: [], previa: null })
  // Ajuste condicionado ao contexto: voltar à fonte anterior não restaura uma seleção antiga.
  if (selecao.contexto !== contexto) setSelecao({ contexto, ids: [], previa: null })
  const selecionados = selecao.contexto === contexto ? selecao.ids : []
  const previa = selecao.contexto === contexto ? selecao.previa : null
  const candidatos = comparacao ? selecionarCandidatosHar(comparacao.encontrados) : []
  function selecionar(ids: string[]) { previaAutorizada.current = null; setSelecao({ contexto, ids, previa: null }) }
  function selecionarItem(itemId: string, marcado: boolean) {
    previaAutorizada.current = null
    setSelecao((atual) => {
      const ids = atual.contexto === contexto ? atual.ids : []
      return { contexto, ids: marcado ? [...new Set([...ids, itemId])] : ids.filter((id) => id !== itemId), previa: null }
    })
  }
  function gerarPrevia() {
    if (!comparacao || analisando || lendoCsv || arquivos.length) return
    try {
      const nova = gerarPreviaHar(comparacao.encontrados, selecionados, fonte)
      previaAutorizada.current = { contexto, previa: nova }
      setSelecao({ contexto, ids: selecionados, previa: nova })
    }
    catch { selecionar([]) }
  }

  async function carregarCsv(arquivo: File) {
    previaAutorizada.current = null
    const atual = ++geracaoCsv.current
    setLendoCsv(true); setErroCsv(''); setFonte('csv'); setCsv(null)
    try {
      if (!/\.csv$/i.test(arquivo.name) || arquivo.size > 20 * 1024 * 1024) throw new Error('Selecione um arquivo .csv de até 20 MB.')
      let conteudo: string
      try { conteudo = await arquivo.text() } catch { throw new Error('Não foi possível ler o CSV local.') }
      if (atual !== geracaoCsv.current) return
      const dados = analisarCatalogoCsv(conteudo)
      setCsv({ nome: arquivo.name, dados }); setFiltro('Todos')
    } catch (falha) {
      if (atual === geracaoCsv.current) setErroCsv(falha instanceof Error ? falha.message : 'CSV inválido.')
    } finally { if (atual === geracaoCsv.current) setLendoCsv(false) }
  }

  async function analisar() {
    previaAutorizada.current = null
    const atual = ++geracao.current
    setAnalisando(true); setErro('')
    try {
      if (arquivos.some((f) => f.size > limiteArquivo) || arquivos.reduce((s, f) => s + f.size, 0) > 100 * 1024 * 1024) {
        throw new Error('Selecione até 100 MB por lote e até 50 MB por arquivo.')
      }
      const parciais: ResultadoParsingHar[] = []
      for (const arquivo of arquivos) {
        if (!/\.(har|json|html|htm|html\.txt|htm\.txt)$/i.test(arquivo.name)) throw new Error('Selecione arquivos .har, .json, .html ou .html.txt.')
        let conteudo: string
        try { conteudo = await arquivo.text() } catch { throw new Error('Não foi possível ler um dos arquivos locais.') }
        if (atual !== geracao.current) return
        if (/\.(html|htm)(\.txt)?$/i.test(arquivo.name) || !conteudo.trimStart().startsWith('{')) {
          parciais.push(analisarDocumentoLista(conteudo, arquivo.name))
        } else {
          let har = false
          try { har = Boolean((JSON.parse(conteudo) as { log?: unknown }).log) } catch { /* parser HAR informa erro */ }
          parciais.push(har ? analisarHar(conteudo, arquivo.name) : analisarDocumentoLista(conteudo, arquivo.name))
        }
      }
      if (atual !== geracao.current) return
      setResultado(combinarHars([...(resultado ? [resultado] : []), ...parciais]))
      setArquivos([]); setFiltro('Todos')
      if (input.current) input.current.value = ''
    } catch (falha) {
      if (atual === geracao.current) setErro(falha instanceof Error ? falha.message : 'Não foi possível analisar o HAR.')
    } finally { if (atual === geracao.current) setAnalisando(false) }
  }
  function limpar() {
    previaAutorizada.current = null
    geracao.current++; setArquivos([]); setResultado(null); setErro(''); setFiltro('Todos'); setAnalisando(false)
    if (input.current) input.current.value = ''
    geracaoCsv.current++; setCsv(null); setErroCsv(''); setLendoCsv(false); setFonte('api')
    if (inputCsv.current) inputCsv.current.value = ''
  }

  const cards: [string, number][] = resultado ? [
    ['Arquivos importados', resultado.arquivos.length], ['Chamadas search válidas (HTTP 200)', resultado.chamadasSearch],
    ['Documentos de listas detectados', resultado.documentosLista], ['Listas detectadas', resultado.listas.length],
    ['Ocorrências de produtos', resultado.ocorrencias], ['ITEM_IDs únicos', resultado.produtos.length],
    ['Produtos válidos com preço BRL, sem conflito', resultado.produtos.filter((p) => p.valido).length],
    ['Duplicados removidos', resultado.duplicados], ['Conflitos entre capturas', resultado.produtos.filter((p) => p.conflito).length],
    ['Sem ITEM_ID válido: ignorados', resultado.semItemId], ['Ocorrências com preço inválido', resultado.precosInvalidos],
    ['Ocorrências com moeda inválida', resultado.moedasInvalidas], ['Respostas sem corpo', resultado.semCorpo],
    ['Respostas inválidas/incompletas', resultado.respostasInvalidas],
    ...(comparacao ? [
      ['Ativos do Valiô', comparacao.totalAtivos], ['Ativos encontrados', comparacao.encontrados.length],
      ['Ativos não encontrados', comparacao.naoEncontrados.length], ['Preços iguais', comparacao.iguais], ['Preços diferentes', comparacao.diferentes],
      ...(['NORMAL', 'DESCONTO', 'PIX', 'CUPOM', 'OUTRO_REVISAR'] as const).map((tipo): [string, number] =>
        [tipo.replace('_', '/'), comparacao.encontrados.filter((p) => p.har.classificacao === tipo).length]),
    ] as [string, number][] : []),
  ] : []

  return <section className="extrair-card har-revisao" aria-labelledby="har-titulo">
    <h3 id="har-titulo">Revisão por HAR do Hub de Afiliados</h3>
    <p>Importe capturas manuais para comparar preços por ITEM_ID. A importação não grava dados; atualizar exige revalidação pela API e confirmação explícita.</p>
    <p className="har-privacidade">O arquivo HAR é processado localmente para extrair apenas dados de produtos. Cookies, tokens e headers não são armazenados nem exibidos.</p>
    <label htmlFor="har-fonte-catalogo">Fonte do catálogo</label>
    <select id="har-fonte-catalogo" value={fonte} onChange={(e) => { previaAutorizada.current = null; setFonte(e.target.value as 'api' | 'csv'); setFiltro('Todos') }}>
      <option value="api">API da vitrine</option><option value="csv">CSV local</option>
    </select>
    <p><strong>Fonte do catálogo: {fonte === 'csv' ? 'CSV local' : 'API da vitrine'}</strong></p>
    <label htmlFor="har-catalogo-csv">Carregar catálogo CSV</label>
    <input ref={inputCsv} id="har-catalogo-csv" type="file" accept=".csv" disabled={lendoCsv}
      onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void carregarCsv(arquivo) }} />
    <p>O CSV é processado somente neste navegador, sem envio à API e sem persistência. Ao carregar, a fonte CSV local será selecionada; os catálogos não são misturados.</p>
    {lendoCsv && <p role="status">Lendo CSV local…</p>}
    {erroCsv && <p role="alert">{erroCsv} O catálogo CSV não foi carregado.</p>}
    {csv && <div className="har-cards" aria-label="Resumo do catálogo CSV">
      <div><strong>{csv.nome}</strong><span>CSV carregado</span></div>
      <div><strong>{csv.dados.registrosLidos}</strong><span>Registros lidos</span></div>
      <div><strong>{csv.dados.ativosValidos}</strong><span>Ativos com ITEM_ID e preço válidos, sem duplicidade</span></div>
      <div><strong>{csv.dados.precosInvalidos}</strong><span>Preços inválidos: bloqueados na prévia</span></div>
      <div><strong>{csv.dados.inativosIgnorados}</strong><span>Inativos ignorados</span></div>
      <div><strong>{csv.dados.idsInvalidos + csv.dados.statusInvalidos}</strong><span>ITEM_ID ou status ativo inválidos: ignorados</span></div>
      <div><strong>{csv.dados.idsDuplicados}</strong><span>ITEM_IDs duplicados: revisar</span></div>
      <div><strong>{csv.dados.ofertasIncompletas}</strong><span>Flag de oferta ausente/inválida: protegidos para revisão</span></div>
    </div>}
    <label htmlFor="har-arquivos">Selecionar HARs ou documentos de listas de afiliados</label>
    <input ref={input} id="har-arquivos" type="file" accept=".har,.json,.html,.htm,.html.txt,.htm.txt" multiple disabled={analisando}
      onChange={(e) => { previaAutorizada.current = null; setArquivos(Array.from(e.target.files ?? [])); setErro('') }} />
    <p>Até 50 MB por arquivo e 100 MB por lote. Novas análises são combinadas nesta sessão; limpar ou sair da página descarta os dados.</p>
    {arquivos.length > 0 && <ul aria-label="Arquivos selecionados">{arquivos.map((f, i) => <li key={i}>{f.name}</li>)}</ul>}
    <div className="har-acoes">
      <button type="button" disabled={!arquivos.length || analisando} onClick={() => void analisar()}>{analisando ? 'Analisando…' : 'Analisar HAR'}</button>
      <button type="button" onClick={limpar}>Limpar análise</button>
    </div>
    {erro && <p role="alert">{erro} O lote não foi incorporado; a análise anterior, se houver, foi preservada.</p>}
    {resultado && <>
      <p role="status">Análise local concluída. Nenhuma alteração foi enviada.</p>
      {resultado.listas.length > 0 && <section className="har-listas-detectadas" aria-label="Resumo das listas de afiliados">
        <h4>LISTAS DETECTADAS</h4>
        <div className="har-listas-grade">{resultado.listas.map((lista) => <article className="har-lista" key={lista.id}>
          <h5>{lista.nome}</h5>
          <p className="har-lista-id">ID da lista: {lista.id}</p>
          <dl>
            <div><dt>Esperados</dt><dd>{lista.totalEsperado ?? 'Não informado'}</dd></div>
            <div><dt>Extraídos</dt><dd>{lista.extraidos}</dd></div>
            <div><dt>Encontrados no Valiô</dt><dd>{comparacao ? lista.itemIds.filter((id) => idsEncontrados.has(id)).length : 'Aguardando catálogo'}</dd></div>
            <div><dt>Status</dt><dd className={`har-lista-status har-lista-status--${lista.status.toLowerCase()}`}>{lista.status}</dd></div>
          </dl>
          {lista.status !== 'COMPLETA' && <p className="har-lista-aviso">A captura não comprova a cobertura total da lista.</p>}
        </article>)}</div>
      </section>}
      <details><summary>Arquivos importados ({resultado.arquivos.length})</summary>
        <ul>{resultado.arquivos.map((nome, i) => <li key={i}>{nome}</li>)}</ul>
      </details>
      <div className="har-cards">{cards.map(([label, n]) => <div key={label}><strong>{n}</strong><span>{label}</span></div>)}</div>
      {resultado.chamadasSearch === 0 && resultado.documentosLista === 0 && <p role="alert">Nenhuma resposta HTTP 200 de busca de afiliados ou documento de lista foi identificado neste lote.</p>}
    </>}
    {fonte === 'api' && erroCatalogo && <p role="alert">Catálogo indisponível: {erroCatalogo} A comparação está bloqueada. Verifique a autorização e a configuração do Supabase; HTTP 401 indica autenticação recusada. Nenhuma escrita é realizada por esta seção.</p>}
    {!comparacao && <p>{fonte === 'csv' ? 'Carregue um CSV e analise os HARs para visualizar o cruzamento local.'
      : carregandoCatalogo ? 'Aguardando o carregamento do catálogo.' : 'Use “Carregar catálogo” acima para cruzar os HARs com os produtos ativos.'}</p>}
    {comparacao && <>
      <div className="har-acoes">
        <button type="button" disabled={!candidatos.length || analisando || lendoCsv || arquivos.length > 0}
          onClick={() => selecionar(candidatos)}>Selecionar todos os candidatos seguros</button>
        <button type="button" onClick={() => selecionar([])}>Limpar seleção</button>
        <button type="button" disabled={!selecionados.length || analisando || lendoCsv || arquivos.length > 0}
          onClick={gerarPrevia}>Gerar prévia de atualização</button>
      </div>
      <p role="status">{selecionados.length} produtos selecionados de {candidatos.length} candidatos seguros</p>
      {arquivos.length > 0 && <p>Analise os HARs selecionados antes de fazer uma nova seleção.</p>}
      <label htmlFor="har-filtro">Filtrar prévia</label>
      <select id="har-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroHar)}>
        {filtrosHar.map((f) => <option key={f}>{f}</option>)}
      </select>
      <p>{filtrados.length} produtos neste filtro. Preços iguais/diferentes incluem condições de pagamento e ofertas protegidas; não indicam autorização de atualização.</p>
      <div className="har-tabela" role="region" aria-label="Comparação HAR com Valiô" tabIndex={0}>
        <table><thead><tr>{['Seleção / bloqueio', 'ITEM_ID', 'Título', 'Preço no Valiô', 'Preço no HAR', 'Diferença R$', 'Diferença %', 'Classificação', 'Discount label', 'Arquivo origem', 'Status', 'Oferta Relâmpago'].map((t) => <th key={t} scope="col">{t}</th>)}</tr></thead>
          <tbody>{filtrados.map((linha, i) => <tr key={`${linha.har.itemId}-${i}`}>
            <td>{candidatoSeguroHar(linha) ? <input type="checkbox" aria-label={`Selecionar ${linha.har.itemId}`}
              disabled={analisando || lendoCsv || arquivos.length > 0} checked={selecionados.includes(linha.har.itemId)}
              onChange={(e) => selecionarItem(linha.har.itemId, e.target.checked)} />
              : <span>{motivosBloqueioHar(linha).join(' · ')}</span>}</td>
            <td>{linha.har.itemId}</td><td>{linha.produto.titulo}</td>
            <td>{reais(Number.isFinite(linha.produto.preco) && linha.produto.preco > 0 ? linha.produto.preco : null)}</td>
            <td>{linha.har.conflito ? linha.har.conflito.precos.map(reais).join(' / ') : reais(linha.har.precoAtual)}</td>
            <td>{reais(linha.diferenca)}</td><td>{linha.diferencaPercentual === null ? '—' : `${linha.diferencaPercentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`}</td>
            <td>{linha.har.classificacao.replace('_', '/')}</td>
            <td>{[...new Set(linha.har.capturas.map((p) => p.discountLabel ?? '—'))].join(' / ')}</td>
            <td>{[...new Set(linha.har.capturas.map((p) => p.listaId
              ? `${p.arquivoOrigem} · ${p.listaNome} (${p.listaId})` : p.arquivoOrigem))].join(', ')}
              {linha.har.conflito && <ul>{linha.har.capturas.map((p, indice) => <li key={indice}>{p.arquivoOrigem}: {reais(p.precoAtual)} ({p.moeda ?? 'sem moeda'})</li>)}</ul>}</td>
            <td><strong>{linha.status}</strong>{linha.har.conflito && <p>CONFLITO ENTRE CAPTURAS</p>}
              {linha.ofertaProtegida && <p className="har-protegida">OFERTA_PROTEGIDA</p>}</td>
            <td>{linha.produto.ofertaRelampago ? 'Sim' : 'Não'} — {linha.oferta}
              <p>Início: {linha.produto.ofertaInicio || '—'}<br />Fim: {linha.produto.ofertaFim || '—'}</p></td>
          </tr>)}</tbody>
        </table>
      </div>
      {filtrados.length === 0 && <p>Nenhum produto encontrado neste filtro.</p>}
    </>}
    {previa && <section className="har-previa-final" aria-labelledby="har-previa-final-titulo">
      <h4 id="har-previa-final-titulo">Prévia final de atualização</h4>
      <p>Fonte: {previa.fonte === 'csv' ? 'CSV local' : 'API da vitrine'}. O preço-base foi preservado. Gerar esta prévia não grava preços; a confirmação exige revalidação pelo backend.</p>
      <div className="har-cards">
        <div><strong>{previa.resumo.selecionados}</strong><span>Selecionados</span></div>
        <div><strong>{previa.resumo.aumentos}</strong><span>Aumentos de preço</span></div>
        <div><strong>{previa.resumo.reducoes}</strong><span>Reduções de preço</span></div>
        <div><strong>{percentual(previa.resumo.mediaPercentual)}</strong><span>Média da variação percentual (com sinal)</span></div>
        <div><strong>{percentual(previa.resumo.maiorAumentoPercentual)}</strong><span>Maior aumento percentual</span></div>
        <div><strong>{percentual(previa.resumo.maiorReducaoPercentual)}</strong><span>Maior redução percentual</span></div>
      </div>
      <div className="har-tabela" role="region" aria-label="Prévia final dos selecionados" tabIndex={0}>
        <table><thead><tr>{['ITEM_ID', 'Título', 'Preço atual no Valiô (base)', 'Novo preço do HAR', 'Diferença R$', 'Diferença %', 'Classificação', 'Discount label', 'Origem HAR'].map((t) => <th key={t} scope="col">{t}</th>)}</tr></thead>
          <tbody>{previa.itens.map((p) => <tr key={p.itemId}>
            <td>{p.itemId}</td><td>{p.titulo}</td><td>{reais(p.precoBase)}</td><td>{reais(p.novoPreco)}</td>
            <td>{reais(p.diferenca)}</td><td>{percentual(p.diferencaPercentual)}</td><td>{p.classificacao}</td>
            <td>{p.discountLabels.join(' / ')}</td><td>{p.arquivosOrigem.join(', ')}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {comparacao && <ConfirmacaoPrecosHar previa={previa} linhas={comparacao.encontrados} token={token}
        validarPreviaAtual={(p) => previaAutorizada.current?.previa === p && previaAutorizada.current.contexto === contexto} />}
    </section>}
  </section>
}
