import { useState } from 'react'
import { processarLinks } from '../lib/processarLinks'
import type { ProdutoImportado } from '../types/produtoImportado'
import './ImportarProdutos.css'

export default function ImportarProdutos() {
  const [texto, setTexto] = useState('')
  const [produtos, setProdutos] = useState<ProdutoImportado[]>([])
  const [processado, setProcessado] = useState(false)
  const validos = produtos.filter((produto) => produto.status === 'valido').length

  function processar() {
    setProdutos(processarLinks(texto))
    setProcessado(true)
  }

  return (
    <main className="importar-produtos">
      <a className="importar-voltar" href="/">← Voltar ao Valiô Garimpo</a>
      <header>
        <p className="importar-marca">VALIÔ GARIMPO</p>
        <h1>Importar produtos</h1>
        <p>Cole os links do Mercado Livre, incluindo seus links de afiliado, um por linha.</p>
      </header>

      <section className="importar-card" aria-labelledby="links-titulo">
        <h2 id="links-titulo">Seus links</h2>
        <label htmlFor="links-produtos">Links dos produtos</label>
        <textarea
          id="links-produtos"
          value={texto}
          onChange={(event) => {
            setTexto(event.target.value)
            setProcessado(false)
          }}
          rows={8}
          spellCheck={false}
          aria-describedby="links-ajuda"
          placeholder={'https://www.mercadolivre.com.br/...\nhttps://meli.la/...'}
        />
        <p id="links-ajuda">Os links válidos serão preservados, incluindo os parâmetros de afiliado. Apenas espaços nas extremidades, linhas vazias e duplicatas serão removidos.</p>
        <button type="button" onClick={processar}>Processar produtos</button>
        <p className="importar-nota">Nesta etapa, validamos apenas o formato e o domínio. Nenhum dado de produto é consultado ou salvo.</p>
      </section>

      {processado && (
        <section className="importar-card" aria-labelledby="previa-titulo">
          <h2 id="previa-titulo">Prévia da importação</h2>
          <p role="status">{produtos.length} links únicos · {validos} válidos · {produtos.length - validos} inválidos</p>
          {produtos.length === 0 ? (
            <p className="importar-nota">Nenhum link informado. Cole ao menos um link para processar.</p>
          ) : (
            <div className="importar-tabela">
              <table>
                <caption>Links fornecidos e resultado da validação</caption>
                <thead><tr><th scope="col">Número</th><th scope="col">Link original</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {produtos.map((produto) => (
                    <tr key={produto.linkOriginal}>
                      <td>{produto.numero}</td>
                      <td className="importar-link">{produto.linkOriginal}</td>
                      <td>
                        <span className={`importar-status importar-status-${produto.status}`}>
                          {produto.status === 'valido' ? 'Válido' : 'Inválido'}
                        </span>
                        {produto.motivo && <p className="importar-motivo">{produto.motivo}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
