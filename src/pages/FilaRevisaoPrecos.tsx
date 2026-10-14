import { useState } from 'react'
import { extrairProdutosAfiliados } from '../lib/extrairProdutosAfiliados'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { adicionarLote, enviarPrecosEmBlocos, filtrarFila, lotesVazios, montarFila, selecionarFila } from '../lib/revisaoPrecosLote'
import type { EntradaPreco, FiltroFila, OrdemFila, ResultadoPreco } from '../lib/revisaoPrecosLote'
import './FilaRevisaoPrecos.css'

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
type Props = { catalogo: ProdutoCatalogo[]; token: string; onResultados: (resultados: ResultadoPreco[], entradas: EntradaPreco[]) => void }

export default function FilaRevisaoPrecos({ catalogo, token, onResultados }: Props) {
  const [texto, setTexto] = useState('')
  const [lotes, setLotes] = useState(lotesVazios)
  const [incluirAtualizados, setIncluirAtualizados] = useState(false)
  const [filtro, setFiltro] = useState<FiltroFila>('todos')
  const [ordem, setOrdem] = useState<OrdemFila>('antigos')
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<ResultadoPreco[] | null>(null)
  const fila = montarFila(catalogo, lotes, incluirAtualizados)
  const visiveis = filtrarFila(fila, filtro, ordem)
  const paginaAtual = Math.min(pagina, Math.max(1, Math.ceil(visiveis.length / 40)))
  const exibidos = visiveis.slice((paginaAtual - 1) * 40, paginaAtual * 40)
  const encontrados = fila.filter((item) => item.extraido).length
  const alterados = fila.filter((item) => item.diferencaCentavos !== null && item.diferencaCentavos !== 0).length
  const iguais = fila.filter((item) => item.diferencaCentavos === 0).length
  const selecionadosAlterados = fila.filter((item) => selecionados.has(item.produto.mercadoLivreId) && item.diferencaCentavos !== null && item.diferencaCentavos !== 0)
  const selecionadosIguais = fila.filter((item) => selecionados.has(item.produto.mercadoLivreId) && item.diferencaCentavos === 0)

  function adicionar() {
    setErro(''); setResultado(null)
    try {
      const extraidos = extrairProdutosAfiliados(JSON.parse(texto))
      if (!extraidos.length) { setErro('Nenhum produto encontrado nesse JSON.'); return }
      setLotes((atual) => adicionarLote(atual, extraidos))
      setTexto('')
      setPagina(1)
    } catch { setErro('JSON inválido. Confira o lote e tente novamente.') }
  }

  async function atualizar(modo: 'atualizar' | 'confirmar') {
    const itens = modo === 'atualizar' ? selecionadosAlterados : selecionadosIguais
    const entradas: EntradaPreco[] = itens.map((item) => ({ mercadoLivreId: item.produto.mercadoLivreId,
      preco: modo === 'atualizar' ? item.extraido!.precoAtual! : item.produto.preco,
      atualizarPreco: modo === 'atualizar' }))
    if (!entradas.length) return
    setEnviando(true); setErro(''); setResultado(null)
    try {
      const resultados = await enviarPrecosEmBlocos(entradas, token)
      setResultado(resultados)
      onResultados(resultados, entradas)
      const bemSucedidos = new Set(resultados.filter((item) => item.status !== 'erro').map((item) => item.mercadoLivreId))
      setSelecionados((atual) => new Set([...atual].filter((id) => !bemSucedidos.has(id))))
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível atualizar os preços.') }
    finally { setEnviando(false) }
  }

  return <section className="fila-revisao" aria-labelledby="fila-titulo">
    <h3 id="fila-titulo">Fila de revisão de preços</h3>
    <p>Importe vários JSONs da Central e compare por ITEM_ID. Nenhum preço é alterado ao adicionar lotes.</p>
    <div className="fila-contadores">
      <span>{catalogo.length} produtos no catálogo</span><span>{fila.filter((item) => item.idade === 'Precisa revisão').length} precisam revisão</span>
      <span>{fila.filter((item) => item.idade === 'Revisar em breve').length} revisar em breve</span>
      <span>{catalogo.length - fila.filter((item) => item.idade !== 'Atualizado').length} atualizados</span>
    </div>
    <label htmlFor="json-lote-revisao">JSON da Central para revisão</label>
    <textarea id="json-lote-revisao" value={texto} onChange={(evento) => setTexto(evento.target.value)} placeholder="Cole um lote JSON da Central de Afiliados" />
    <div className="fila-acoes"><button type="button" disabled={!texto.trim() || enviando} onClick={adicionar}>Adicionar lote</button>
      <button type="button" className="extrair-secundario" disabled={!lotes.lotes || enviando} onClick={() => { setLotes(lotesVazios()); setSelecionados(new Set()); setResultado(null); setErro(''); setPagina(1) }}>Limpar lotes de revisão</button></div>
    <p className="fila-estatisticas">Lotes adicionados: {lotes.lotes} · Produtos brutos encontrados: {lotes.brutos} · Produtos únicos acumulados: {lotes.produtos.size} · Duplicados ignorados: {lotes.duplicados}</p>
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
    <div className="fila-acoes"><button type="button" className="extrair-secundario" disabled={enviando} onClick={() => setSelecionados(selecionarFila(fila, 'alterados'))}>Selecionar todos com preço alterado</button>
      <button type="button" className="extrair-secundario" disabled={enviando} onClick={() => setSelecionados(selecionarFila(fila, 'encontrados'))}>Selecionar todos encontrados</button>
      <button type="button" className="extrair-secundario" disabled={enviando} onClick={() => setSelecionados(selecionarFila(fila, 'limpar'))}>Desmarcar todos</button></div>
    <p>{selecionados.size} produtos selecionados · {selecionadosAlterados.length} selecionados para atualizar · {selecionadosIguais.length} selecionados para confirmar</p>
    <div className="fila-acoes"><button type="button" disabled={!token.trim() || !selecionadosAlterados.length || enviando} onClick={() => void atualizar('atualizar')}>{enviando ? 'Processando...' : 'Atualizar preços selecionados'}</button>
      <button type="button" disabled={!token.trim() || !selecionadosIguais.length || enviando} onClick={() => void atualizar('confirmar')}>Confirmar preços iguais selecionados</button></div>
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {resultado && <div role="status" className="extrair-resumo-envio"><strong>{resultado.filter((item) => item.status === 'atualizado').length} preços atualizados · {resultado.filter((item) => item.status === 'confirmado').length} confirmados · {resultado.filter((item) => item.status === 'erro').length} erros</strong>
      {resultado.filter((item) => item.status === 'erro').map((item) => <p key={item.mercadoLivreId}>{item.mercadoLivreId}: {item.erro}</p>)}</div>}
    <p className="extrair-contagem">{visiveis.length} produtos · Página {paginaAtual} de {Math.max(1, Math.ceil(visiveis.length / 40))}</p>
    <div className="fila-lista">{exibidos.map((item) => <div className="fila-item" key={item.produto.mercadoLivreId}>
      <label className="fila-selecao"><input type="checkbox" disabled={item.diferencaCentavos === null || enviando} checked={selecionados.has(item.produto.mercadoLivreId)} onChange={(evento) => setSelecionados((atual) => { const proximo = new Set(atual); if (evento.target.checked) proximo.add(item.produto.mercadoLivreId); else proximo.delete(item.produto.mercadoLivreId); return proximo })} />
        <span><strong>{item.produto.titulo}</strong><small>{item.produto.mercadoLivreId} · {item.produto.categoria} · {item.idade}</small></span></label>
      <div><strong>Preço</strong><span>Valiô: {moeda(item.produto.preco)}</span>
        <span>{item.diferencaCentavos === null ? item.extraido ? 'Preço ausente no lote' : 'Ainda não encontrado' : <>Central: {moeda(item.extraido!.precoAtual!)} · {item.diferencaCentavos === 0 ? 'Preço igual' : `Diferença: ${moeda(item.diferencaCentavos / 100)}`}</>}</span></div>
      <div><strong>Outros dados</strong><span>{item.outrosCampos.length ? item.outrosCampos.join(', ') : 'Sem alterações detectadas'}</span></div>
    </div>)}</div>
    {visiveis.length > 40 && <div className="fila-paginas"><button type="button" className="extrair-secundario" disabled={paginaAtual === 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
      <button type="button" className="extrair-secundario" disabled={paginaAtual * 40 >= visiveis.length} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button></div>}
    <p className="extrair-aviso">Não encontrado nos lotes é apenas informativo. Atualização completa de título, imagem, link, categoria e rating continua em “Atualizar existentes”.</p>
  </section>
}
