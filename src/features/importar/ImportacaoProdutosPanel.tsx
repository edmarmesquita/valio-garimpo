import { useState } from 'react'
import type { ReactNode } from 'react'
import { extrairProdutosAfiliados } from '../../lib/extrairProdutosAfiliados'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import { extrairProdutoHtml } from '../../lib/extrairProdutoHtml'
import { filtrarEOrdenarProdutos } from '../../lib/produtosGarimpados'
import type { CategoriaValio, Filtros, Ordenacao } from '../../lib/produtosGarimpados'
import { compararProdutoComValio } from '../../lib/verificarProdutosValio'
import type { ProdutoExistente } from '../../lib/verificarProdutosValio'
import './ImportacaoProdutosPanel.css'

const filtrosIniciais: Filtros = { somenteComPreco: false, somenteComissaoExtra: false, comissaoMinima: null, avaliacaoMinima: null }
const numero = (texto: string) => texto.trim() === '' ? null : Number(texto.replace(',', '.'))
const dinheiro = (valor: number, codigo: string | null) => {
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: codigo || 'BRL' }).format(valor) }
  catch { return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }
}

type Props = {
  visivel: boolean
  produtos: ProdutoAfiliado[] | null
  selecionados: Set<number>
  categorias: Map<number, CategoriaValio>
  origemHtml: boolean
  existentes: Map<string, ProdutoExistente>
  estadoVerificacao: 'pendente' | 'consultando' | 'pronto' | 'erro'
  totalCadastrados: number
  mensagem: string
  erro: string
  resumo: ReactNode
  publicacao: ReactNode
  onImportar: (produtos: ProdutoAfiliado[], origemHtml: boolean, mensagem: string) => void
  onLimparJson: () => void
  onLimparHtml: () => void
  onErroJson: (mensagem: string) => void
  onErroHtml: () => void
  onSelecionar: (indice: number) => void
  onSelecionarTodos: (quantidade: number) => void
  onDesmarcarTodos: () => void
  renderCategoria: (indice: number) => ReactNode
  onLinkOficial: (indice: number, link: string) => boolean
  onCopiar: (conteudo: string) => void
}

export default function ImportacaoProdutosPanel({ visivel, produtos, selecionados, categorias, origemHtml, existentes,
  estadoVerificacao, totalCadastrados, mensagem, erro, resumo, publicacao, onImportar, onLimparJson,
  onLimparHtml, onErroJson, onErroHtml, onSelecionar, onSelecionarTodos, onDesmarcarTodos,
  renderCategoria, onLinkOficial, onCopiar }: Props) {
  const [entrada, setEntrada] = useState('')
  const [htmlEntrada, setHtmlEntrada] = useState('')
  const [urlPaginaHtml, setUrlPaginaHtml] = useState('')
  const [linkHtml, setLinkHtml] = useState('')
  const [erroHtml, setErroHtml] = useState('')
  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciais)
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('original')
  const [filtroCadastro, setFiltroCadastro] = useState<'todos' | 'novos' | 'cadastrados'>('todos')
  const visiveis = produtos ? filtrarEOrdenarProdutos(produtos, filtros, ordenacao).filter((indice) =>
    filtroCadastro === 'todos' || estadoVerificacao !== 'pronto' ||
    (filtroCadastro === 'cadastrados' ? existentes.has(produtos[indice].itemId ?? '') : !existentes.has(produtos[indice].itemId ?? ''))) : []

  function preparar(produtosImportados: ProdutoAfiliado[], html: boolean, mensagem: string) {
    setFiltros(filtrosIniciais); setOrdenacao('original'); setFiltroCadastro('todos')
    onImportar(produtosImportados, html, mensagem)
  }
  function invalidarHtmlResultado() {
    setErroHtml('')
    if (origemHtml) onLimparHtml()
  }
  function extrair() {
    try {
      const encontrados = extrairProdutosAfiliados(JSON.parse(entrada))
      preparar(encontrados, false, `${encontrados.length} produto${encontrados.length === 1 ? '' : 's'} encontrado${encontrados.length === 1 ? '' : 's'}.`)
    } catch { onErroJson('JSON inválido. Confira o conteúdo colado e tente novamente.') }
  }
  function importarHtml() {
    setErroHtml('')
    try {
      const produto = extrairProdutoHtml(htmlEntrada, linkHtml, urlPaginaHtml)
      preparar([produto], true, 'Produto extraído do HTML. Revise os dados e escolha uma coleção antes de enviar.')
    } catch (falha) {
      onErroHtml()
      setErroHtml(falha instanceof Error ? falha.message : 'Não foi possível extrair o produto do HTML.')
    }
  }

  if (!visivel) return null
  return <>
    <section className="extrair-card extrair-entrada-json" aria-labelledby="entrada-titulo">
      <h2 id="entrada-titulo">JSON bruto</h2>
      <label htmlFor="json-afiliados">Cole a resposta JSON</label>
      <textarea id="json-afiliados" value={entrada} onChange={(e) => { setEntrada(e.target.value); onLimparJson() }} rows={9} spellCheck={false} placeholder='{"results": [...]}' />
      <button type="button" onClick={extrair}>Extrair produtos</button>
      <p>O processamento acontece no navegador. Esta tela não envia nem salva o JSON.</p>
      <p>Se você tiver um link afiliado oficial, cole-o no campo do produto antes de enviar ao Valiô.</p>
    </section>
    <section className="extrair-card extrair-html-entrada" aria-labelledby="html-titulo">
      <h2 id="html-titulo">Importar por HTML da página</h2>
      <p>Cole o HTML/Response copiado manualmente da página do produto.</p>
      <label htmlFor="url-pagina-html">URL da página do produto</label>
      <input id="url-pagina-html" type="url" value={urlPaginaHtml} onChange={(e) => { setUrlPaginaHtml(e.target.value); invalidarHtmlResultado() }} placeholder="https://www.mercadolivre.com.br/..." />
      <label htmlFor="html-produto">HTML da página</label>
      <textarea id="html-produto" value={htmlEntrada} onChange={(e) => { setHtmlEntrada(e.target.value); invalidarHtmlResultado() }} rows={9} spellCheck={false} />
      <label htmlFor="link-html-produto">Link afiliado</label>
      <input id="link-html-produto" type="url" value={linkHtml} onChange={(e) => { setLinkHtml(e.target.value); invalidarHtmlResultado() }} placeholder="https://meli.la/..." />
      <button type="button" onClick={importarHtml}>Extrair produto do HTML</button>
      <p>O HTML é processado somente no navegador. Nenhum recurso da página é carregado automaticamente.</p>
      {erroHtml && <p role="alert" className="extrair-erro">{erroHtml}</p>}
    </section>
    {mensagem && <p role="status" className="extrair-notificacao">{mensagem}</p>}
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {produtos && <>
      {resumo}
      <section className="extrair-card extrair-preparacao" aria-labelledby="resultado-titulo">
        <div className="extrair-resultado-cabecalho"><div><h2 id="resultado-titulo">Produtos encontrados</h2><p>{selecionados.size} de {produtos.length} produtos selecionados</p></div>
          <div className="extrair-acoes"><button type="button" disabled={!produtos.length || origemHtml && totalCadastrados > 0} onClick={() => onSelecionarTodos(produtos.length)}>Selecionar todos</button><button type="button" className="extrair-secundario" disabled={!selecionados.size} onClick={onDesmarcarTodos}>Desmarcar todos</button></div>
        </div>
        <div className="extrair-controles">
          <label>Ordenar por<select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}><option value="original">Ordem original</option><option value="comissao">Maior comissão</option><option value="menor-preco">Menor preço</option><option value="maior-preco">Maior preço</option><option value="desconto">Maior desconto</option><option value="avaliacao">Melhor avaliação</option></select></label>
          <label>Cadastro no Valiô<select value={filtroCadastro} onChange={(e) => setFiltroCadastro(e.target.value as typeof filtroCadastro)}><option value="todos">Todos</option><option value="novos">Novos</option><option value="cadastrados">Já cadastrados</option></select></label>
          <label>Comissão mínima (%)<input type="number" min="0" max="100" step="0.1" value={filtros.comissaoMinima ?? ''} onChange={(e) => setFiltros({ ...filtros, comissaoMinima: numero(e.target.value) })} /></label>
          <label>Avaliação mínima<input type="number" min="0" max="5" step="0.1" value={filtros.avaliacaoMinima ?? ''} onChange={(e) => setFiltros({ ...filtros, avaliacaoMinima: numero(e.target.value) })} /></label>
          <label className="extrair-filtro-check"><input type="checkbox" checked={filtros.somenteComPreco} onChange={(e) => setFiltros({ ...filtros, somenteComPreco: e.target.checked })} /> Somente com preço</label>
          <label className="extrair-filtro-check"><input type="checkbox" checked={filtros.somenteComissaoExtra} onChange={(e) => setFiltros({ ...filtros, somenteComissaoExtra: e.target.checked })} /> Somente comissão extra</label>
        </div>
        <p className="extrair-contagem">{visiveis.length} produto{visiveis.length === 1 ? '' : 's'} exibido{visiveis.length === 1 ? '' : 's'}</p>
        {produtos.length === 0 && <p>Nenhum card de produto foi encontrado.</p>}
        {produtos.length > 0 && visiveis.length === 0 && <p>Nenhum produto corresponde aos filtros.</p>}
        <div className="extrair-grid">{visiveis.map((indice) => {
          const p = produtos[indice]; const escolhido = selecionados.has(indice)
          const existente = estadoVerificacao === 'pronto' ? existentes.get(p.itemId ?? '') : undefined
          const comparacao = compararProdutoComValio(p, categorias.get(indice), existente)
          return <article key={indice} className={`extrair-produto ${escolhido ? 'extrair-selecionado' : ''}`}>
            <label className="extrair-selecao"><input type="checkbox" disabled={origemHtml && !!existente} checked={escolhido} onChange={() => onSelecionar(indice)} /> Selecionar produto</label>
            <div className="extrair-imagem">{origemHtml ? <span>Imagem identificada (prévia desativada)</span> : p.imagemUrl ? <img src={p.imagemUrl} alt={p.titulo || 'Imagem do produto'} loading="lazy" /> : <span>Sem imagem</span>}</div>
            <div className="extrair-produto-conteudo">
              <div className="extrair-badges">{p.destaque && <span>{p.destaque}</span>}{p.extraCommission === true && <span>Comissão extra</span>}</div>
              {estadoVerificacao === 'pronto' && p.itemId && /^MLB\d+$/.test(p.itemId) && <p className={`extrair-estado ${existente ? 'extrair-existente' : 'extrair-novo'}`}>{existente ? 'Já está no Valiô' : 'Novo'}</p>}
              {existente && comparacao.precoAlterado && <p className="extrair-alteracao">Preço alterado<br />Valiô: {dinheiro(existente.preco, 'BRL')}<br />Agora: {dinheiro(p.precoAtual!, p.moeda)}</p>}
              {existente && !comparacao.dadosAlterados && <p className="extrair-sem-alteracoes">Sem alterações relevantes</p>}
              <h3>{p.titulo || 'Produto sem título'}</h3>
              {p.itemId && <p className="extrair-id">ITEM_ID: {p.itemId}</p>}
              {origemHtml && p.imagemUrl && <p className="extrair-id">Imagem: {p.imagemUrl}</p>}
              {p.precoAtual !== null && <p className="extrair-preco"><strong>{dinheiro(p.precoAtual, p.moeda)}</strong>{p.precoAnterior !== null && <del>{dinheiro(p.precoAnterior, p.moeda)}</del>}{p.desconto && <span>{p.desconto}</span>}</p>}
              {p.parcelas !== null && <p>{p.parcelas}x{p.valorParcela !== null ? ` de ${dinheiro(p.valorParcela, p.moeda)}` : ''}{p.semJuros === true ? ' sem juros' : ''}</p>}
              {(p.avaliacao !== null || p.vendidosTexto) && <p>{p.avaliacao !== null && `★ ${p.avaliacao.toLocaleString('pt-BR')}`}{p.avaliacao !== null && p.vendidosTexto ? ' · ' : ''}{p.vendidosTexto}</p>}
              {p.comissaoTexto && <p className="extrair-comissao">{p.comissaoTexto}</p>}
              {p.linkOriginal && <a className="extrair-link" href={p.linkOriginal} target="_blank" rel="noopener noreferrer">Ver no Mercado Livre ↗</a>}
              <label className="extrair-link-oficial">Link afiliado oficial
                <input key={`${indice}:${p.linkOriginal}`} type="url" defaultValue={p.linkOriginal ?? ''} placeholder="https://meli.la/..." onBlur={(event) => {
                  const link = event.currentTarget.value
                  if (link === p.linkOriginal) return
                  if (!onLinkOficial(indice, link)) event.currentTarget.value = p.linkOriginal ?? ''
                }} />
              </label>
              {escolhido && renderCategoria(indice)}
            </div>
          </article>
        })}</div>
      </section>
      {publicacao}
      <details className="extrair-card extrair-detalhes"><summary>JSON normalizado do Garimpo</summary><p>Dados extraídos da Central de Afiliados, separados do formato para o Valiô.</p><button type="button" onClick={() => onCopiar(JSON.stringify(produtos, null, 2))}>Copiar JSON normalizado</button><pre aria-label="JSON normalizado do Garimpa">{JSON.stringify(produtos, null, 2)}</pre></details>
    </>}
  </>
}
