import { useState } from 'react'
import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import AreaOperacional from '../components/AreaOperacional'
import { carregarCatalogo } from '../lib/manutencaoVitrine'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import type { EntradaPreco, ResultadoPreco } from '../lib/revisaoPrecosLote'
import FilaRevisaoPrecos from './FilaRevisaoPrecos'
import './PrecosPage.css'

export default function PrecosPage() {
  const { token } = useSessaoOperacional()
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true); setErro('')
    try { setCatalogo(await carregarCatalogo(token)) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o catálogo.') }
    finally { setCarregando(false) }
  }

  function aplicarPrecos(resultados: ResultadoPreco[], entradas: EntradaPreco[]) {
    const porId = new Map(entradas.map((item) => [item.mercadoLivreId, item]))
    const exitos = new Map(resultados.filter((item) => item.status !== 'erro').map((item) => [item.mercadoLivreId, item]))
    setCatalogo((atual) => atual?.map((produto) => {
      const resultado = exitos.get(produto.mercadoLivreId)
      const entrada = porId.get(produto.mercadoLivreId)
      if (!resultado || !entrada) return produto
      return { ...produto, preco: entrada.atualizarPreco ? entrada.preco : produto.preco,
        dataPreco: resultado.dataPreco ?? produto.dataPreco, updatedAt: resultado.updatedAt ?? produto.updatedAt }
    }) ?? null)
  }

  return <AreaOperacional titulo="Preços" descricao="Revise preços do catálogo com os JSONs da Central de Afiliados.">
    <section className="extrair-card precos-acesso" aria-label="Revisão de preços">
      <button type="button" disabled={!token.trim() || carregando} onClick={() => void carregar()}>
        {carregando ? 'Carregando...' : 'Carregar catálogo'}
      </button>
      {!token.trim() && <p className="extrair-aviso">Informe o token de publicação acima para consultar a vitrine.</p>}
      {erro && <p role="alert" className="extrair-erro">{erro}</p>}
      {catalogo && <FilaRevisaoPrecos catalogo={catalogo} token={token} onResultados={aplicarPrecos} />}
    </section>
  </AreaOperacional>
}
