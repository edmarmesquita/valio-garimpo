import { useEffect, useState } from 'react'
import type { ProdutoAfiliado } from '../lib/extrairProdutosAfiliados'
import { CATEGORIAS_VALIO } from '../lib/produtosGarimpados'
import type { CategoriaValio } from '../lib/produtosGarimpados'
import { alterarCategoriaProduto, alterarStatusProduto, analisarCatalogo, carregarCatalogo, filtrarCatalogo, resumirCatalogo } from '../lib/manutencaoVitrine'
import type { FiltroVitrine, OrdemVitrine, ProdutoCatalogo } from '../lib/manutencaoVitrine'
import './ManutencaoVitrine.css'

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
const dataAtualizacao = (valor: string) => {
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString('pt-BR')
}

type Props = { token: string; lote: ProdutoAfiliado[] | null; categorias: ReadonlyMap<number, CategoriaValio> }

export default function ManutencaoVitrine({ token, lote, categorias }: Props) {
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [ocupadoId, setOcupadoId] = useState('')
  const [confirmarId, setConfirmarId] = useState('')
  const [rascunhos, setRascunhos] = useState<Map<string, CategoriaValio>>(new Map())
  const [filtro, setFiltro] = useState<FiltroVitrine>('todos')
  const [ordem, setOrdem] = useState<OrdemVitrine>('antigos')
  const [paginaCatalogo, setPaginaCatalogo] = useState(1)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const analisados = analisarCatalogo(catalogo ?? [], lote, categorias)
  const resumo = resumirCatalogo(analisados)
  const visiveis = filtrarCatalogo(analisados, filtro, ordem)
  const paginaAtual = Math.min(paginaCatalogo, Math.max(1, Math.ceil(visiveis.length / 40)))
  const exibidos = visiveis.slice((paginaAtual - 1) * 40, paginaAtual * 40)

  useEffect(() => {
    if (!mensagem) return
    const temporizador = window.setTimeout(() => setMensagem(''), 5000)
    return () => window.clearTimeout(temporizador)
  }, [mensagem])

  async function carregar() {
    setCarregando(true); setErro(''); setMensagem('')
    try { setCatalogo(await carregarCatalogo(token)) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o catálogo.') }
    finally { setCarregando(false) }
  }

  async function status(id: string, ativo: boolean) {
    setOcupadoId(id); setErro(''); setConfirmarId('')
    try {
      await alterarStatusProduto(id, ativo, token)
      setCatalogo((atual) => atual?.map((produto) => produto.mercadoLivreId === id ? { ...produto, ativo } : produto) ?? null)
      setMensagem(ativo ? 'Produto reativado.' : 'Produto desativado.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível alterar o status.') }
    finally { setOcupadoId('') }
  }

  async function salvarCategoria(id: string, categoria: CategoriaValio) {
    setOcupadoId(id); setErro('')
    try {
      await alterarCategoriaProduto(id, categoria, token)
      setCatalogo((atual) => atual?.map((produto) => produto.mercadoLivreId === id
        ? { ...produto, categoria, updatedAt: new Date().toISOString() } : produto) ?? null)
      setRascunhos((atual) => { const proximo = new Map(atual); proximo.delete(id); return proximo })
      setMensagem('Categoria atualizada.')
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível alterar a categoria.') }
    finally { setOcupadoId('') }
  }

  return <section className="extrair-card vitrine-manutencao" aria-labelledby="vitrine-titulo">
    <div className="extrair-resultado-cabecalho"><div><h2 id="vitrine-titulo">Manutenção da vitrine</h2>
      <p>Consulte o catálogo do Supabase, revise preços e gerencie a visibilidade dos produtos.</p></div>
      <button type="button" disabled={!token.trim() || carregando} onClick={() => void carregar()}>{carregando ? 'Carregando...' : 'Carregar catálogo'}</button>
    </div>
    {!token.trim() && <p className="extrair-aviso">Informe o token de publicação acima para consultar a vitrine.</p>}
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {mensagem && <p role="status" className="extrair-notificacao">{mensagem}</p>}
    {catalogo && <>
      <div className="vitrine-resumo" role="status">
        <div><strong>{resumo.ativos}</strong><span>Produtos ativos</span></div>
        <div><strong>{resumo.inativos}</strong><span>Produtos inativos</span></div>
        <div><strong>{resumo.atualizados}</strong><span>Preço atualizado recentemente</span></div>
        <div><strong>{resumo.precisamRevisao}</strong><span>Precisam revisão</span></div>
        <div><strong>{resumo.precosAlterados}</strong><span>Preço alterado detectado</span></div>
      </div>
      <section className="vitrine-filtros" aria-label="Filtros do catálogo"><h3>Filtros e ordenação</h3><div className="vitrine-controles">
        <label>Mostrar<select aria-label="Filtrar vitrine" value={filtro} onChange={(evento) => { setFiltro(evento.target.value as FiltroVitrine); setPaginaCatalogo(1) }}>
          <option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option>
          <option value="atualizados">Atualizados</option><option value="revisar-breve">Revisar em breve</option>
          <option value="precisa-revisao">Precisa revisão</option><option value="revisar-catalogo">Revisar catálogo</option>
        </select></label>
        <label>Ordenar<select aria-label="Ordenar vitrine" value={ordem} onChange={(evento) => setOrdem(evento.target.value as OrdemVitrine)}>
          <option value="antigos">Mais antigos primeiro</option><option value="recentes">Mais recentes primeiro</option>
          <option value="menor-preco">Menor preço</option><option value="maior-preco">Maior preço</option><option value="categoria">Categoria</option>
        </select></label>
      </div></section>
      <div className="vitrine-lista-cabecalho"><h3>Catálogo</h3><p className="extrair-contagem">{visiveis.length} de {catalogo.length} produtos exibidos.</p></div>
      {visiveis.length === 0 && <p>Nenhum produto corresponde ao filtro.</p>}
      <div className="vitrine-lista">{exibidos.map(({ produto, idade, encontrado, precoAlterado, camposAlterados }) => {
        const indice = lote?.findIndex((item) => item.itemId === produto.mercadoLivreId) ?? -1
        const extraido = indice >= 0 ? lote?.[indice] : undefined
        const categoriaRascunho = rascunhos.get(produto.mercadoLivreId) ?? produto.categoria
        return <article key={produto.mercadoLivreId} className="vitrine-produto">
          <img src={produto.imagem} alt={produto.titulo} loading="lazy" />
          <div className="vitrine-dados"><div className="vitrine-badges"><span className={produto.ativo ? 'badge--ativo' : 'badge--inativo'}>{produto.ativo ? 'Ativo' : 'Inativo'}</span><span>{idade}</span>
            {precoAlterado && <span>Preço alterado</span>}{camposAlterados.length > 0 && <span>Outros dados alterados</span>}
          </div><h3>{produto.titulo}</h3><p className="extrair-id">ITEM_ID: {produto.mercadoLivreId}</p>
            <p><strong>{moeda(produto.preco)}</strong> · Preço de {produto.dataPreco}</p>
            <p>Categoria: {produto.categoria} · Avaliação: {produto.rating ?? 'não informada'}</p>
            <p>Atualizado em: {dataAtualizacao(produto.updatedAt)}</p>
            <p>{lote === null ? 'Cole um lote da Central para comparar dados.' : encontrado ? 'Encontrado no lote' : 'Não encontrado no lote (informativo)'}</p>
            {precoAlterado && extraido?.precoAtual !== null && <p className="extrair-alteracao">Preço alterado · Valiô: {moeda(produto.preco)} · Agora: {moeda(extraido!.precoAtual!)}</p>}
            {camposAlterados.length > 0 && <p className="extrair-alteracao">Campos alterados: {camposAlterados.join(', ')}</p>}
            {encontrado && !precoAlterado && camposAlterados.length === 0 && <p className="extrair-sem-alteracoes">Sem alterações relevantes</p>}
            <a href={produto.linkAfiliado} target="_blank" rel="noopener noreferrer">Ver link afiliado ↗</a>
          </div>
          <div className="vitrine-acoes">
            <label>Categoria<select aria-label={`Categoria de ${produto.titulo}`} value={categoriaRascunho}
              onChange={(evento) => setRascunhos((atual) => new Map(atual).set(produto.mercadoLivreId, evento.target.value as CategoriaValio))}>
              {CATEGORIAS_VALIO.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
            </select></label>
            <button type="button" className="extrair-secundario" disabled={categoriaRascunho === produto.categoria || ocupadoId === produto.mercadoLivreId}
              onClick={() => void salvarCategoria(produto.mercadoLivreId, categoriaRascunho)}>Salvar categoria</button>
            {produto.ativo ? confirmarId === produto.mercadoLivreId ? <div className="vitrine-confirmacao">
              <p>Desativar este produto? Ele deixará de aparecer na vitrine.</p>
              <button type="button" disabled={ocupadoId === produto.mercadoLivreId} onClick={() => void status(produto.mercadoLivreId, false)}>Confirmar desativação</button>
              <button type="button" className="extrair-secundario" onClick={() => setConfirmarId('')}>Cancelar</button>
            </div> : <button type="button" className="extrair-secundario" disabled={ocupadoId === produto.mercadoLivreId}
              onClick={() => setConfirmarId(produto.mercadoLivreId)}>Desativar</button>
              : <button type="button" disabled={ocupadoId === produto.mercadoLivreId} onClick={() => void status(produto.mercadoLivreId, true)}>Reativar</button>}
          </div>
        </article>
      })}</div>
      {visiveis.length > 40 && <div className="fila-paginas vitrine-paginacao"><button type="button" className="extrair-secundario" disabled={paginaAtual === 1} onClick={() => setPaginaCatalogo(paginaAtual - 1)}>Anterior</button>
        <span>Página {paginaAtual} de {Math.ceil(visiveis.length / 40)}</span>
        <button type="button" className="extrair-secundario" disabled={paginaAtual * 40 >= visiveis.length} onClick={() => setPaginaCatalogo(paginaAtual + 1)}>Próxima</button></div>}
      {lote && <p className="extrair-aviso">A ausência de um produto neste lote é apenas informativa. Para aplicar dados extraídos a produtos existentes, selecione-os acima e use “Atualizar existentes”.</p>}
    </>}
  </section>
}
