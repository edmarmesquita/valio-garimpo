import { useState } from 'react'
import { extrairProdutosAfiliados } from '../lib/extrairProdutosAfiliados'
import { extrairPrecosHtml } from '../lib/extrairPrecosHtml'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { adicionarLote, enviarPrecosEmBlocos, filtrarFila, lotesVazios, montarFila, selecionarFila } from '../lib/revisaoPrecosLote'
import type { EntradaPreco, FiltroFila, OrdemFila, ResultadoPreco } from '../lib/revisaoPrecosLote'
import './FilaRevisaoPrecos.css'

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
type Props = { catalogo: ProdutoCatalogo[]; token: string; onResultados: (resultados: ResultadoPreco[], entradas: EntradaPreco[]) => void }

export default function FilaRevisaoPrecos({ catalogo, token, onResultados }: Props) {
  const [texto, setTexto] = useState('')
  const [fonte, setFonte] = useState<'json' | 'html'>('json')
  const [origem, setOrigem] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [lotes, setLotes] = useState(lotesVazios)
  const [incluirAtualizados, setIncluirAtualizados] = useState(false)
  const [filtro, setFiltro] = useState<FiltroFila>('todos')
  const [ordem, setOrdem] = useState<OrdemFila>('antigos')
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<ResultadoPreco[] | null>(null)
  const [previa, setPrevia] = useState<{ modo: 'atualizar' | 'confirmar'; entradas: EntradaPreco[]; token: string } | null>(null)
  const fila = montarFila(catalogo, lotes, incluirAtualizados)
  const ativos = catalogo.filter((produto) => produto.ativo)
  const visiveis = filtrarFila(fila, filtro, ordem)
  const paginaAtual = Math.min(pagina, Math.max(1, Math.ceil(visiveis.length / 40)))
  const exibidos = visiveis.slice((paginaAtual - 1) * 40, paginaAtual * 40)
  const encontrados = fila.filter((item) => item.extraido).length
  const alterados = fila.filter((item) => item.diferencaCentavos !== null && item.diferencaCentavos !== 0).length
  const iguais = fila.filter((item) => item.diferencaCentavos === 0).length
  const selecionadosAlterados = fila.filter((item) => selecionados.has(item.produto.mercadoLivreId) && item.diferencaCentavos !== null && item.diferencaCentavos !== 0)
  const selecionadosIguais = fila.filter((item) => selecionados.has(item.produto.mercadoLivreId) && item.diferencaCentavos === 0)
  const comPreco = [...lotes.produtos.values()].filter((item) => item.precoAtual !== null && item.precoAtual > 0).length
  const paraRevisar = lotes.produtos.size - comPreco + lotes.semId

  function adicionar() {
    setErro(''); setResultado(null)
    setPrevia(null)
    try {
      if (fonte === 'html') {
        const extracao = extrairPrecosHtml(texto, origem)
        if (!extracao.encontrados) { setErro('Nenhum card estruturado encontrado nesse HTML.'); return }
        setLotes((atual) => adicionarLote(atual, extracao.produtos, { fonte: 'html', brutos: extracao.encontrados, semId: extracao.semId,
          problemas: extracao.problemas, urls: extracao.urls }))
        const validos = extracao.produtos.filter((item) => item.precoAtual !== null).length
        const noCatalogo = extracao.produtos.filter((item) => ativos.some((salvo) => salvo.mercadoLivreId === item.itemId)).length
        setDiagnostico(`${extracao.encontrados} produtos encontrados · ${validos} com preço válido · ${extracao.encontrados - validos} para revisar · ${noCatalogo} produtos do Valiô encontrados neste lote.`)
      } else {
        const extraidos = extrairProdutosAfiliados(JSON.parse(texto))
        if (!extraidos.length) { setErro('Nenhum produto encontrado nesse JSON.'); return }
        setLotes((atual) => adicionarLote(atual, extraidos))
        setDiagnostico('')
      }
      setTexto('')
      setPagina(1)
    } catch (falha) { setErro(fonte === 'html' && falha instanceof Error ? falha.message : 'JSON inválido. Confira o lote e tente novamente.') }
  }

  function entradasSelecionadas(modo: 'atualizar' | 'confirmar'): EntradaPreco[] {
    const itens = modo === 'atualizar' ? selecionadosAlterados : selecionadosIguais
    return itens.map((item) => ({ mercadoLivreId: item.produto.mercadoLivreId,
      preco: modo === 'atualizar' ? item.extraido!.precoAtual! : item.produto.preco,
      atualizarPreco: modo === 'atualizar', precoEsperado: item.produto.preco }))
  }

  function prepararPrevia(modo: 'atualizar' | 'confirmar') {
    const entradas = entradasSelecionadas(modo)
    if (!entradas.length || !token.trim()) return
    setPrevia({ modo, entradas, token }); setErro(''); setResultado(null)
  }

  async function confirmarPrevia() {
    if (!previa || previa.token !== token || JSON.stringify(entradasSelecionadas(previa.modo)) !== JSON.stringify(previa.entradas)) {
      setPrevia(null); setErro('A seleção ou os preços mudaram. Gere uma nova prévia.'); return
    }
    setEnviando(true); setErro(''); setResultado(null)
    try {
      const resultados = await enviarPrecosEmBlocos(previa.entradas, token)
      setResultado(resultados)
      onResultados(resultados, previa.entradas)
      const bemSucedidos = new Set(resultados.filter((item) => item.status !== 'erro').map((item) => item.mercadoLivreId))
      setSelecionados((atual) => new Set([...atual].filter((id) => !bemSucedidos.has(id))))
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível atualizar os preços.') }
    finally { setEnviando(false); setPrevia(null) }
  }

  return <section className="fila-revisao" aria-labelledby="fila-titulo">
    <h3 id="fila-titulo">Fila de revisão de preços</h3>
    <p>Adicione JSONs da Central ou HTML estruturado do Mercado Livre e compare por ITEM_ID. Adicionar lotes não altera preços.</p>
    <div className="fila-contadores">
      <span>{ativos.length} produtos ativos no catálogo</span><span>{fila.filter((item) => item.idade === 'Precisa revisão').length} precisam revisão</span>
      <span>{fila.filter((item) => item.idade === 'Revisar em breve').length} revisar em breve</span>
      <span>{ativos.length - fila.filter((item) => item.idade !== 'Atualizado').length} atualizados</span>
    </div>
    <fieldset className="fila-fonte"><legend>Fonte da revisão</legend>
      <label><input type="radio" name="fonte-revisao" checked={fonte === 'json'} onChange={() => { setFonte('json'); setTexto(''); setPrevia(null) }} /> JSON DA CENTRAL</label>
      <label><input type="radio" name="fonte-revisao" checked={fonte === 'html'} onChange={() => { setFonte('html'); setTexto(''); setPrevia(null) }} /> HTML DA PÁGINA</label>
    </fieldset>
    <label htmlFor="json-lote-revisao">{fonte === 'json' ? 'JSON da Central para revisão' : 'HTML da página para revisão'}</label>
    <textarea id="json-lote-revisao" value={texto} onChange={(evento) => setTexto(evento.target.value)} placeholder={fonte === 'json' ? 'Cole um lote JSON da Central de Afiliados' : 'Cole o HTML completo da página do Mercado Livre'} />
    {fonte === 'html' && <><label htmlFor="origem-html-precos">URL da página de origem (opcional)</label>
      <input id="origem-html-precos" type="url" value={origem} onChange={(evento) => setOrigem(evento.target.value)} /></>}
    <div className="fila-acoes"><button type="button" disabled={!texto.trim() || enviando} onClick={adicionar}>Adicionar lote</button>
      <button type="button" className="extrair-secundario" disabled={!lotes.lotes || enviando} onClick={() => { setLotes(lotesVazios()); setSelecionados(new Set()); setResultado(null); setPrevia(null); setDiagnostico(''); setErro(''); setPagina(1) }}>Limpar lotes de revisão</button></div>
    {diagnostico && <p role="status" className="fila-estatisticas">{diagnostico}</p>}
    <p className="fila-estatisticas">Lotes adicionados: {lotes.lotes} · Produtos brutos encontrados: {lotes.brutos} · Produtos únicos acumulados: {lotes.produtos.size} · Duplicados ignorados: {lotes.duplicados} · Atualizados na sessão: {lotes.atualizadosSessao} · Produtos com preço válido: {comPreco} · Produtos para revisar: {paraRevisar}</p>
    <div className="fila-contadores">
      <span>{fila.length} na fila</span><span>{encontrados} encontrados nos lotes</span><span>{alterados} com preço alterado</span>
      <span>{iguais} com preço igual</span><span>{fila.length - encontrados} ainda não encontrados</span>
    </div>
    <div className="fila-controles">
      <label>Mostrar<select aria-label="Filtrar fila" value={filtro} onChange={(evento) => { setFiltro(evento.target.value as FiltroFila); setPagina(1) }}>
        <option value="todos">Todos</option><option value="preco-alterado">Preço alterado</option><option value="preco-igual">Preço igual</option>
        <option value="nao-encontrados">Ainda não encontrados</option><option value="outros-dados">Outros dados alterados</option>
        <option value="precisa-revisao">Precisa revisão</option><option value="revisar-breve">Revisar em breve</option>
      </select></label>
      <label>Ordenar<select aria-label="Ordenar fila" value={ordem} onChange={(evento) => setOrdem(evento.target.value as OrdemFila)}>
        <option value="maior-diferenca">Maior diferença de preço</option><option value="maior-reducao">Maior redução</option>
        <option value="maior-aumento">Maior aumento</option><option value="antigos">Preço mais antigo</option>
        <option value="recentes">Mais recente</option><option value="categoria">Categoria</option>
      </select></label>
      <label className="fila-checkbox"><input type="checkbox" checked={incluirAtualizados} onChange={(evento) => { setIncluirAtualizados(evento.target.checked); setPagina(1) }} /> Incluir atualizados</label>
    </div>
    <div className="fila-acoes"><button type="button" className="extrair-secundario" disabled={enviando} onClick={() => { setSelecionados(selecionarFila(fila, 'alterados')); setPrevia(null) }}>Selecionar todos com preço alterado</button>
      <button type="button" className="extrair-secundario" disabled={enviando} onClick={() => { setSelecionados(selecionarFila(fila, 'encontrados')); setPrevia(null) }}>Selecionar todos encontrados</button>
      <button type="button" className="extrair-secundario" disabled={enviando} onClick={() => { setSelecionados(selecionarFila(fila, 'limpar')); setPrevia(null) }}>Desmarcar todos</button></div>
    <p>{selecionados.size} produtos selecionados · {selecionadosAlterados.length} selecionados para atualizar · {selecionadosIguais.length} selecionados para confirmar</p>
    <div className="fila-acoes"><button type="button" disabled={!token.trim() || !selecionadosAlterados.length || enviando} onClick={() => prepararPrevia('atualizar')}>Prévia dos preços selecionados</button>
      <button type="button" disabled={!token.trim() || !selecionadosIguais.length || enviando} onClick={() => prepararPrevia('confirmar')}>Prévia dos preços iguais selecionados</button></div>
    {previa && <section className="fila-previa" aria-label="Prévia de revisão de preços">
      <h4>Prévia — {previa.entradas.length} produto(s)</h4>
      <ul>{previa.entradas.map((entrada) => <li key={entrada.mercadoLivreId}>{entrada.mercadoLivreId}: {moeda(entrada.precoEsperado!)} → {moeda(entrada.preco)}</li>)}</ul>
      <button type="button" disabled={enviando} onClick={() => void confirmarPrevia()}>{enviando ? 'Processando...' : 'Confirmar revisão de preços'}</button>
    </section>}
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {resultado && <div role="status" className="extrair-resumo-envio"><strong>{resultado.filter((item) => item.status === 'atualizado').length} preços atualizados · {resultado.filter((item) => item.status === 'confirmado').length} confirmados · {resultado.filter((item) => item.status === 'erro').length} erros</strong>
      {resultado.filter((item) => item.status === 'erro').map((item) => <p key={item.mercadoLivreId}>{item.mercadoLivreId}: {item.erro}</p>)}</div>}
    <p className="extrair-contagem">{visiveis.length} produtos · Página {paginaAtual} de {Math.max(1, Math.ceil(visiveis.length / 40))}</p>
    <div className="fila-lista">{exibidos.map((item) => <div className="fila-item" key={item.produto.mercadoLivreId}>
      <label className="fila-selecao"><input type="checkbox" disabled={item.diferencaCentavos === null || enviando} checked={selecionados.has(item.produto.mercadoLivreId)} onChange={(evento) => { setPrevia(null); setSelecionados((atual) => { const proximo = new Set(atual); if (evento.target.checked) proximo.add(item.produto.mercadoLivreId); else proximo.delete(item.produto.mercadoLivreId); return proximo }) }} />
        <span><strong>{item.produto.titulo}</strong><small>{item.produto.mercadoLivreId} · {item.produto.categoria} · {item.idade}</small>
          {item.fonte === 'html' && <small>HTML: {item.extraido?.titulo ?? 'Título ausente'}{item.url ? ` · ${item.url}` : ''}
            {item.extraido?.precoAnterior ? ` · Antes: ${moeda(item.extraido.precoAnterior)}` : ''}
            {item.extraido?.desconto ? ` · ${item.extraido.desconto}` : ''}</small>}</span></label>
      <div><strong>Preço</strong><span>Valiô: {moeda(item.produto.preco)}</span>
        <span>{item.diferencaCentavos === null ? item.extraido ? `REVISAR · ${item.problema ?? 'Preço ausente no lote'}` : 'NÃO ENCONTRADO' : <>{item.fonte === 'html' ? 'HTML' : 'Central'}: {moeda(item.extraido!.precoAtual!)} · {item.diferencaCentavos === 0 ? 'PREÇO IGUAL' : `PREÇO ALTERADO · Diferença: ${moeda(item.diferencaCentavos / 100)} (${(item.diferencaCentavos / Math.round(item.produto.preco * 100) * 100).toFixed(1)}%)`}</>}</span></div>
      <div><strong>Outros dados</strong><span>{item.outrosCampos.length ? item.outrosCampos.join(', ') : 'Sem alterações detectadas'}</span></div>
    </div>)}</div>
    {visiveis.length > 40 && <div className="fila-paginas"><button type="button" className="extrair-secundario" disabled={paginaAtual === 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
      <button type="button" className="extrair-secundario" disabled={paginaAtual * 40 >= visiveis.length} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button></div>}
    <p className="extrair-aviso">Não encontrado nos lotes é apenas informativo. Atualização completa de título, imagem, link, categoria e rating continua em “Atualizar existentes”.</p>
  </section>
}
