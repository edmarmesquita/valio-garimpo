import { useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import { CATEGORIAS_VALIO, type CategoriaValio } from '../../lib/produtosGarimpados'
import { enviarSelecionadosValio, type ResumoEnvio } from '../../lib/publicarProdutosValio'
import { verificarIdsValio } from '../../lib/verificarProdutosValio'
import './ImportarLinksAfiliadosPanel.css'

export type LinkResolvido = { linkOriginal: string; itemId: string | null; titulo: string | null; preco: number | null;
  moeda: string | null; imagem: string | null; urlProduto: string | null; productId: string | null;
  userProductId: string | null; status: 'novo' | 'ja_existe' | 'erro' | 'link_nao_validado'; erro: string | null }

function produtoAfiliado(item: LinkResolvido): ProdutoAfiliado {
  return { itemId: item.itemId, productId: item.productId, userProductId: item.userProductId,
    variationId: null, titulo: item.titulo, precoAtual: item.preco, precoAnterior: null,
    moeda: item.moeda, desconto: null, parcelas: null, valorParcela: null, semJuros: null,
    avaliacao: null, vendidosTexto: null, comissaoTexto: null, comissaoPercentual: null,
    destaque: null, imagemId: null, imagemUrl: item.imagem, linkOriginal: item.linkOriginal,
    extraCommission: null, brandCommission: null, tipoOrigem: 'item' }
}

export default function ImportarLinksAfiliadosPanel() {
  const { token } = useSessaoOperacional()
  const [texto, setTexto] = useState('')
  const [itens, setItens] = useState<LinkResolvido[]>([])
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [categorias, setCategorias] = useState<Map<number, CategoriaValio>>(new Map())
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [resumo, setResumo] = useState<ResumoEnvio | null>(null)
  const aptos = [...selecionados].filter((indice) => itens[indice]?.status === 'novo')
  const podePublicar = !ocupado && aptos.length > 0 && aptos.length === selecionados.size &&
    aptos.every((indice) => categorias.has(indice)) && Boolean(token.trim())

  async function resolver() {
    const links = texto.split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean)
    if (!links.length || links.length > 30) { setErro('Cole de 1 a 30 links, um por linha.'); return }
    if (!token.trim()) { setErro('Informe o token em Acesso à vitrine.'); return }
    setOcupado(true); setErro(''); setResumo(null); setItens([]); setSelecionados(new Set()); setCategorias(new Map())
    try {
      const resposta = await fetch('/api/valio/afiliados/resolver-links', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({ links }), cache: 'no-store' })
      const dados = await resposta.json()
      if (!resposta.ok || dados.ok !== true || !Array.isArray(dados.produtos)) throw new Error(dados.erro ?? 'Falha ao resolver links.')
      setItens(dados.produtos)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha ao resolver links.') }
    finally { setOcupado(false) }
  }

  async function publicar() {
    if (!podePublicar) return
    setOcupado(true); setErro(''); setResumo(null)
    try {
      const ids = aptos.map((indice) => itens[indice].itemId!).filter(Boolean)
      const existentes = await verificarIdsValio(ids, token)
      if (existentes.size) {
        setItens((atuais) => atuais.map((item) => item.itemId && existentes.has(item.itemId)
          ? { ...item, status: 'ja_existe', erro: 'JÁ EXISTE no Valiô.' } : item))
        setSelecionados((atuais) => new Set([...atuais].filter((indice) => !existentes.has(itens[indice]?.itemId ?? ''))))
      }
      const novos = new Set(aptos.filter((indice) => !existentes.has(itens[indice].itemId!)))
      if (!novos.size) { setErro('Os selecionados já existem no Valiô.'); return }
      const resultado = await enviarSelecionadosValio(itens.map(produtoAfiliado), novos, categorias, token, fetch,
        { somenteCriar: true, origemLink: 'importacao-meli-la' })
      setResumo(resultado)
      if (resultado.criados) {
        const publicados = new Set(ids.filter((id) => !resultado.erros.some((falha) => falha.id === id)))
        setItens((atuais) => atuais.map((item) => item.itemId && publicados.has(item.itemId)
          ? { ...item, status: 'ja_existe', erro: 'JÁ EXISTE no Valiô.' } : item))
        setSelecionados((atuais) => new Set([...atuais].filter((indice) => !publicados.has(itens[indice]?.itemId ?? ''))))
      }
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha ao publicar.') }
    finally { setOcupado(false) }
  }

  return <section className="extrair-card importar-links" aria-labelledby="importar-links-titulo">
    <h2 id="importar-links-titulo">Importar por links afiliados</h2>
    <p>Cole links oficiais meli.la para resolver os anúncios. A resolução não publica produtos.</p>
    <label htmlFor="links-meli">Cole um ou vários links meli.la, um por linha</label>
    <textarea id="links-meli" value={texto} onChange={(event) => setTexto(event.target.value)} rows={5} />
    <button type="button" disabled={ocupado} onClick={() => void resolver()}>{ocupado ? 'Aguarde...' : 'Resolver produtos'}</button>
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    {itens.length > 0 && <>
      <p>{itens.filter((item) => item.status === 'novo').length} novos · {itens.filter((item) => item.status === 'ja_existe').length} já existentes · {itens.filter((item) => item.status === 'erro' || item.status === 'link_nao_validado').length} com erro</p>
      <button type="button" className="extrair-secundario" onClick={() => setSelecionados(new Set(itens.flatMap((item, indice) => item.status === 'novo' ? [indice] : [])))}>Selecionar todos os novos</button>
      <div className="importar-links-lista">{itens.map((item, indice) => <article key={`${indice}-${item.linkOriginal}`} className="importar-links-card">
        <label><input type="checkbox" checked={selecionados.has(indice)} disabled={item.status !== 'novo'} onChange={() => setSelecionados((atuais) => { const proximo = new Set(atuais); if (proximo.has(indice)) proximo.delete(indice); else proximo.add(indice); return proximo })} /> Selecionar produto</label>
        <strong>{({ novo: 'Novo', ja_existe: 'JÁ EXISTE', erro: 'Erro', link_nao_validado: 'Link não validado' })[item.status]}</strong>
        {item.erro && <p role="alert">{item.erro}</p>}
        {item.imagem && <img src={item.imagem} alt={item.titulo ?? 'Produto'} />}
        <h3>{item.titulo ?? 'Produto não identificado'}</h3>
        <p>ITEM_ID: {item.itemId ?? '—'} · Preço: {item.preco && item.moeda === 'BRL' ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.preco) : '—'}</p>
        <p>URL normal: {item.urlProduto ? <a href={item.urlProduto} target="_blank" rel="noreferrer">{item.urlProduto}</a> : '—'}</p>
        <p>Link meli.la: {item.linkOriginal}</p>
        <label>Categoria<select value={categorias.get(indice) ?? ''} disabled={item.status !== 'novo'} onChange={(event) => setCategorias((atuais) => { const proximo = new Map(atuais); if (event.target.value) proximo.set(indice, event.target.value as CategoriaValio); else proximo.delete(indice); return proximo })}>
          <option value="">Escolha uma categoria</option>{CATEGORIAS_VALIO.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
        </select></label>
      </article>)}</div>
      <button type="button" disabled={!podePublicar} onClick={() => void publicar()}>Publicar somente os selecionados</button>
      {resumo && <p role="status">{resumo.criados} criados · {resumo.erros.length} erros{resumo.erros.length ? `: ${resumo.erros.map((falha) => `${falha.id}: ${falha.motivo}`).join('; ')}` : ''}</p>}
    </>}
  </section>
}
