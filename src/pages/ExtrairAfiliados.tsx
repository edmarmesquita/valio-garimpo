import { useEffect, useRef, useState } from 'react'
import { extrairProdutosAfiliados } from '../lib/extrairProdutosAfiliados'
import type { ProdutoAfiliado } from '../lib/extrairProdutosAfiliados'
import { alternarSelecao, CATEGORIAS_VALIO, filtrarEOrdenarProdutos, gerarProdutosValio, selecionarTodos } from '../lib/produtosGarimpados'
import type { CategoriaValio, Filtros, Ordenacao } from '../lib/produtosGarimpados'
import './ExtrairAfiliados.css'

const filtrosIniciais: Filtros = { somenteComPreco: false, somenteComissaoExtra: false, comissaoMinima: null, avaliacaoMinima: null }
const dinheiro = (valor: number, codigo: string | null) => {
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: codigo || 'BRL' }).format(valor) }
  catch { return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }
}
const media = (valores: number[]) => valores.length ? valores.reduce((soma, valor) => soma + valor, 0) / valores.length : null
const numero = (texto: string) => texto.trim() === '' ? null : Number(texto.replace(',', '.'))

export default function ExtrairAfiliados() {
  const [entrada, setEntrada] = useState('')
  const [produtos, setProdutos] = useState<ProdutoAfiliado[] | null>(null)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [categorias, setCategorias] = useState<Map<number, CategoriaValio>>(new Map())
  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciais)
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('original')
  const [resultadoValio, setResultadoValio] = useState<{ json: string; quantidade: number } | null>(null)
  const [erroExportacao, setErroExportacao] = useState('')
  const resultadoRef = useRef<HTMLElement>(null)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const visiveis = produtos ? filtrarEOrdenarProdutos(produtos, filtros, ordenacao) : []
  const escolhidos = produtos?.filter((_, indice) => selecionados.has(indice)) ?? []
  const comissaoMedia = media(escolhidos.flatMap((p) => p.comissaoPercentual === null ? [] : [p.comissaoPercentual]))
  const precoMedio = media(escolhidos.flatMap((p) => p.precoAtual === null ? [] : [p.precoAtual]))

  useEffect(() => {
    if (resultadoValio) resultadoRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [resultadoValio])

  function invalidarResultado() { setResultadoValio(null); setErroExportacao(''); setMensagem(''); setErro('') }
  function extrair() {
    invalidarResultado()
    try {
      const encontrados = extrairProdutosAfiliados(JSON.parse(entrada))
      setProdutos(encontrados); setSelecionados(new Set()); setCategorias(new Map())
      setFiltros(filtrosIniciais); setOrdenacao('original')
      setMensagem(`${encontrados.length} produto${encontrados.length === 1 ? '' : 's'} encontrado${encontrados.length === 1 ? '' : 's'}.`)
    } catch { setProdutos(null); setErro('JSON inválido. Confira o conteúdo colado e tente novamente.') }
  }
  async function copiar(conteudo: string) {
    try { await navigator.clipboard.writeText(conteudo); setErro(''); setMensagem('JSON copiado.') }
    catch { setErro('Não foi possível copiar automaticamente. Selecione o JSON abaixo para copiar.') }
  }
  function gerar() {
    if (!produtos) return
    try {
      const gerados = gerarProdutosValio(produtos, selecionados, categorias)
      setResultadoValio({ json: JSON.stringify(gerados, null, 2), quantidade: gerados.length })
      setErroExportacao(''); setErro(''); setMensagem('')
    } catch (falha) {
      setResultadoValio(null)
      setErroExportacao(falha instanceof Error ? falha.message : 'Não foi possível gerar o JSON.')
    }
  }
  function categoria(indice: number, valor: string) {
    const proximas = new Map(categorias)
    if (valor) proximas.set(indice, valor as CategoriaValio)
    else proximas.delete(indice)
    setCategorias(proximas); invalidarResultado()
  }
  return <main className="extrair-afiliados">
    <a href="/">← Voltar ao Valiô Garimpo</a>
    <header><p className="extrair-marca">VALIÔ GARIMPO</p><h1>Produtos garimpados</h1><p>Cole o JSON da Central de Afiliados, revise os produtos e prepare uma lista para o Valiô.</p></header>
    <section className="extrair-card" aria-labelledby="entrada-titulo">
      <h2 id="entrada-titulo">JSON bruto</h2>
      <label htmlFor="json-afiliados">Cole a resposta JSON</label>
      <textarea id="json-afiliados" value={entrada} onChange={(e) => { setEntrada(e.target.value); setProdutos(null); setSelecionados(new Set()); setCategorias(new Map()); invalidarResultado() }} rows={9} spellCheck={false} placeholder='{"results": [...]}' />
      <button type="button" onClick={extrair}>Extrair produtos</button>
      <p>O processamento acontece no navegador. Esta tela não envia nem salva o JSON.</p>
    </section>
    {mensagem && <p role="status" className="extrair-notificacao">{mensagem}</p>}
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {produtos && <>
      <section className="extrair-card" aria-labelledby="resumo-titulo"><h2 id="resumo-titulo">Resumo do garimpo</h2>
        <div className="extrair-resumo">
          <div><strong>{produtos.length}</strong><span>produtos encontrados</span></div>
          <div><strong>{selecionados.size}</strong><span>selecionados</span></div>
          <div><strong>{produtos.filter((p) => p.extraCommission).length}</strong><span>com comissão extra</span></div>
          <div><strong>{comissaoMedia === null ? '—' : `${comissaoMedia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</strong><span>comissão média selecionada</span></div>
          <div><strong>{precoMedio === null ? '—' : dinheiro(precoMedio, 'BRL')}</strong><span>preço médio selecionado</span></div>
        </div>
      </section>
      <section className="extrair-card" aria-labelledby="resultado-titulo">
        <div className="extrair-resultado-cabecalho"><div><h2 id="resultado-titulo">Produtos encontrados</h2><p>{selecionados.size} de {produtos.length} produtos selecionados</p></div>
          <div className="extrair-acoes"><button type="button" disabled={!produtos.length} onClick={() => { setSelecionados(selecionarTodos(produtos.length)); invalidarResultado() }}>Selecionar todos</button><button type="button" className="extrair-secundario" disabled={!selecionados.size} onClick={() => { setSelecionados(new Set()); invalidarResultado() }}>Desmarcar todos</button></div>
        </div>
        <div className="extrair-controles">
          <label>Ordenar por<select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}><option value="original">Ordem original</option><option value="comissao">Maior comissão</option><option value="menor-preco">Menor preço</option><option value="maior-preco">Maior preço</option><option value="desconto">Maior desconto</option><option value="avaliacao">Melhor avaliação</option></select></label>
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
          return <article key={indice} className={`extrair-produto ${escolhido ? 'extrair-selecionado' : ''}`}>
            <label className="extrair-selecao"><input type="checkbox" checked={escolhido} onChange={() => { setSelecionados((atual) => alternarSelecao(atual, indice)); invalidarResultado() }} /> Selecionar produto</label>
            <div className="extrair-imagem">{p.imagemUrl ? <img src={p.imagemUrl} alt={p.titulo || 'Imagem do produto'} loading="lazy" /> : <span>Sem imagem</span>}</div>
            <div className="extrair-produto-conteudo">
              <div className="extrair-badges">{p.destaque && <span>{p.destaque}</span>}{p.extraCommission === true && <span>Comissão extra</span>}</div>
              <h3>{p.titulo || 'Produto sem título'}</h3>
              {p.itemId && <p className="extrair-id">ITEM_ID: {p.itemId}</p>}
              {p.precoAtual !== null && <p className="extrair-preco"><strong>{dinheiro(p.precoAtual, p.moeda)}</strong>{p.precoAnterior !== null && <del>{dinheiro(p.precoAnterior, p.moeda)}</del>}{p.desconto && <span>{p.desconto}</span>}</p>}
              {p.parcelas !== null && <p>{p.parcelas}x{p.valorParcela !== null ? ` de ${dinheiro(p.valorParcela, p.moeda)}` : ''}{p.semJuros === true ? ' sem juros' : ''}</p>}
              {(p.avaliacao !== null || p.vendidosTexto) && <p>{p.avaliacao !== null && `★ ${p.avaliacao.toLocaleString('pt-BR')}`}{p.avaliacao !== null && p.vendidosTexto ? ' · ' : ''}{p.vendidosTexto}</p>}
              {p.comissaoTexto && <p className="extrair-comissao">{p.comissaoTexto}</p>}
              {p.linkOriginal && <a className="extrair-link" href={p.linkOriginal} target="_blank" rel="noopener noreferrer">Ver no Mercado Livre ↗</a>}
              {escolhido && <label className="extrair-categoria">Coleção do Valiô<select value={categorias.get(indice) ?? ''} onChange={(e) => categoria(indice, e.target.value)}><option value="">Escolha uma coleção</option>{CATEGORIAS_VALIO.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
            </div>
          </article>
        })}</div>
      </section>
      <section className="extrair-card" aria-labelledby="exportar-titulo"><h2 id="exportar-titulo">Preparar para o Valiô</h2><p>Selecione os produtos e defina uma coleção para cada um. Produtos sem preço, link, ITEM_ID ou título não podem ser exportados.</p><button type="button" onClick={gerar}>Gerar produtos para o Valiô</button>
        {erroExportacao && <p role="alert" className="extrair-erro extrair-erro-exportacao">{erroExportacao}</p>}
      </section>
      {resultadoValio && <section ref={resultadoRef} className="extrair-card extrair-json-resultado" aria-labelledby="json-valio-titulo">
        <div className="extrair-resultado-cabecalho"><div><h2 id="json-valio-titulo">JSON para o Valiô</h2><p>{resultadoValio.quantidade} produto{resultadoValio.quantidade === 1 ? '' : 's'} gerado{resultadoValio.quantidade === 1 ? '' : 's'}</p></div><button type="button" onClick={() => void copiar(resultadoValio.json)}>Copiar JSON para o Valiô</button></div>
        <p role="status" className="extrair-notificacao">JSON para o Valiô gerado com sucesso. Revise antes de usar.</p>
        <pre aria-label="JSON para o Valiô">{resultadoValio.json}</pre>
      </section>}
      <details className="extrair-card extrair-detalhes"><summary>JSON normalizado do Garimpa</summary><p>Dados extraídos da Central de Afiliados, separados do formato para o Valiô.</p><button type="button" onClick={() => void copiar(JSON.stringify(produtos, null, 2))}>Copiar JSON normalizado</button><pre aria-label="JSON normalizado do Garimpa">{JSON.stringify(produtos, null, 2)}</pre></details>
    </>}
  </main>
}
