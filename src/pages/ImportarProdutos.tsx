import { useState } from 'react'
import { processarLinks } from '../lib/processarLinks'
import type { OrigemProduto, ProdutoConsultado } from '../types/produtoImportado'
import './ImportarProdutos.css'

export default function ImportarProdutos() {
  const [texto, setTexto] = useState('')
  const [produto, setProduto] = useState<ProdutoConsultado | null>(null)
  const [origem, setOrigem] = useState<OrigemProduto | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function processar() {
    setProduto(null)
    setOrigem(null)
    setErro('')
    const links = processarLinks(texto)
    if (links.length !== 1) {
      setErro('Cole exatamente um link de produto para consultar.')
      return
    }
    if (links[0].status === 'invalido') {
      setErro(links[0].motivo ?? 'Link inválido.')
      return
    }
    setCarregando(true)
    try {
      const resposta = await fetch('/api/mercadolivre/produto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ link: links[0].linkOriginal }),
      })
      const resultado = await resposta.json()
      if (!resposta.ok) throw new Error(resultado.error ?? 'Não foi possível consultar o produto.')
      setProduto(resultado.produto)
      setOrigem(resultado.source)
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível consultar o produto.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <main className="importar-produtos">
      <a className="importar-voltar" href="/">← Voltar ao Valiô Garimpo</a>
      <header>
        <p className="importar-marca">VALIÔ GARIMPO</p>
        <h1>Importar produtos</h1>
        <p>Cole um link de anúncio do Mercado Livre para consultar os dados do produto.</p>
      </header>

      <section className="importar-card" aria-labelledby="links-titulo">
        <h2 id="links-titulo">Link do produto</h2>
        <label htmlFor="links-produtos">Link do produto</label>
        <textarea
          id="links-produtos"
          value={texto}
          onChange={(event) => {
            setTexto(event.target.value)
            setProduto(null)
            setOrigem(null)
            setErro('')
          }}
          rows={3}
          spellCheck={false}
          aria-describedby="links-ajuda"
          placeholder="https://produto.mercadolivre.com.br/MLB-1234567890-..."
        />
        <p id="links-ajuda">Use um link de anúncio com ID MLB, inclusive com parâmetros de afiliado ou wid=MLB. Links de catálogo sem ID de anúncio precisam ser abertos em um anúncio específico.</p>
        <button type="button" onClick={processar} disabled={carregando}>{carregando ? 'Consultando...' : 'Consultar produto'}</button>
        <p className="importar-nota">Os dados serão consultados no Mercado Livre e não serão salvos.</p>
      </section>

      {erro && <p role="alert" className="importar-motivo">{erro}</p>}
      {produto && (
        <section className="importar-card" aria-labelledby="previa-titulo">
          <h2 id="previa-titulo">Produto consultado</h2>
          {origem === 'public-page-fallback' && <p className="importar-nota">Dados da página pública do anúncio. Disponibilidade e status não foram verificados.</p>}
          {produto.imagemPrincipal && <img className="importar-imagem" src={produto.imagemPrincipal} alt={produto.titulo} />}
          <h3>{produto.titulo}</h3>
          <p>ID: {produto.id}</p>
          <p>Preço: {produto.moeda ? `${produto.moeda} ` : ''}{produto.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          {produto.status && <p>Status: {produto.status}</p>}
          {produto.quantidadeDisponivel !== null && <p>Quantidade disponível: {produto.quantidadeDisponivel}</p>}
          {produto.permalink && <p><a href={produto.permalink} target="_blank" rel="noopener noreferrer">Ver no Mercado Livre</a></p>}
        </section>
      )}
    </main>
  )
}
