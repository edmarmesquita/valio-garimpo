import { useEffect, useState } from 'react'
import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import AreaOperacional from '../components/AreaOperacional'
import { carregarCatalogo } from '../lib/manutencaoVitrine'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import type { EntradaPreco, ResultadoPreco } from '../lib/revisaoPrecosLote'
import FilaRevisaoPrecos from './FilaRevisaoPrecos'
import RevisaoAutomaticaPrecos from './RevisaoAutomaticaPrecos'
import RevisaoHarAfiliados from './RevisaoHarAfiliados'
import './PrecosPage.css'

async function lerConexaoMercadoLivre(): Promise<{ connected?: boolean; requiresReconnect?: boolean }> {
  const resposta = await fetch('/api/mercadolivre/status', { credentials: 'same-origin', cache: 'no-store' })
  if (!resposta.ok) throw new Error('Conexão OAuth indisponível')
  return resposta.json()
}

function mensagemConexao(status: { connected?: boolean; requiresReconnect?: boolean }, retorno: string | null) {
  return status.requiresReconnect ? 'A sessão expirou. Conecte sua conta novamente.'
    : !status.connected && retorno === 'negado' ? 'A autorização foi negada pelo Mercado Livre (access_denied). Confira a conta, o aplicativo e a redirect URI cadastrada.'
      : !status.connected && retorno === 'erro' ? 'A conexão OAuth não foi concluída. Confira a configuração e tente novamente.' : ''
}

export default function PrecosPage() {
  const { token } = useSessaoOperacional()
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [mercadoLivreStatus, setMercadoLivreStatus] = useState<'carregando' | 'conectado' | 'desconectado' | 'erro'>('carregando')
  const [mensagemMercadoLivre, setMensagemMercadoLivre] = useState('')
  const [retornoOAuth] = useState(() => new URLSearchParams(window.location.search).get('meli'))

  async function consultarConexaoMercadoLivre() {
    try {
      const status = await lerConexaoMercadoLivre()
      setMercadoLivreStatus(status.connected ? 'conectado' : 'desconectado')
      setMensagemMercadoLivre(mensagemConexao(status, retornoOAuth))
    } catch {
      setMercadoLivreStatus('erro')
      setMensagemMercadoLivre('Não foi possível verificar a conexão OAuth no backend.')
    }
  }

  useEffect(() => {
    const retorno = new URLSearchParams(window.location.search).get('meli')
    if (retorno) {
      const url = new URL(window.location.href)
      url.searchParams.delete('meli')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    async function carregarStatusInicial() {
      try {
        const status = await lerConexaoMercadoLivre()
        setMercadoLivreStatus(status.connected ? 'conectado' : 'desconectado')
        setMensagemMercadoLivre(mensagemConexao(status, retornoOAuth))
      } catch {
        setMercadoLivreStatus('erro')
        setMensagemMercadoLivre('Não foi possível verificar a conexão OAuth no backend.')
      }
    }
    void carregarStatusInicial()
  }, [retornoOAuth])

  async function carregar() {
    setCarregando(true); setErro(''); setCatalogo(null)
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

  return <AreaOperacional titulo="Preços" descricao="Revise preços do catálogo com JSON da Central ou HTML estruturado do Mercado Livre.">
    <section className="extrair-card precos-acesso" aria-label="Revisão de preços">
      <div className="fila-revisao" aria-label="Conexão Mercado Livre para preços">
        <h3>Conexão Mercado Livre</h3>
        <p role="status">Mercado Livre: {mercadoLivreStatus === 'conectado' ? 'CONECTADO'
          : mercadoLivreStatus === 'desconectado' ? 'DESCONECTADO' : mercadoLivreStatus === 'carregando' ? 'VERIFICANDO' : 'ERRO'}</p>
        {mensagemMercadoLivre && <p role="alert">{mensagemMercadoLivre}</p>}
        <button type="button" onClick={() => { window.location.assign('/api/mercadolivre/auth/iniciar?retorno=precos') }}>
          Conectar Mercado Livre
        </button>
        <button type="button" onClick={() => { setMercadoLivreStatus('carregando'); void consultarConexaoMercadoLivre() }}>Atualizar conexão</button>
      </div>
      <button type="button" disabled={!token.trim() || carregando} onClick={() => void carregar()}>
        {carregando ? 'Carregando...' : 'Carregar catálogo'}
      </button>
      {!token.trim() && <p className="extrair-aviso">Informe o token de publicação acima para consultar a vitrine.</p>}
      {erro && <p role="alert" className="extrair-erro">{erro}</p>}
      {catalogo && <FilaRevisaoPrecos catalogo={catalogo} token={token} onResultados={aplicarPrecos} />}
      {catalogo && <RevisaoAutomaticaPrecos catalogo={catalogo} token={token}
        mercadoLivreConectado={mercadoLivreStatus === 'conectado'}
        onSessaoExpirada={() => { setMercadoLivreStatus('desconectado'); setMensagemMercadoLivre('A sessão expirou. Conecte sua conta novamente.') }}
        onResultados={aplicarPrecos} />}
    </section>
    <RevisaoHarAfiliados catalogo={catalogo} erroCatalogo={erro} carregandoCatalogo={carregando} token={token} />
  </AreaOperacional>
}
