import { useEffect, useState } from 'react'
import './App.css'

type GarimpoStatus = {
  ok: boolean
  garimpo: string
  status: string
}

type MercadoLivreStatus = 'carregando' | 'conectado' | 'desconectado' | 'erro'

function App() {
  const [status, setStatus] = useState<GarimpoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mercadoLivreStatus, setMercadoLivreStatus] = useState<MercadoLivreStatus>('carregando')
  const [retornoOAuth] = useState(() => new URLSearchParams(window.location.search).get('meli'))

  async function verificarBackend() {
    try {
      setLoading(true)
      setError('')

      const resposta = await fetch(
        '/api/garimpo/status'
      )

      if (!resposta.ok) {
        throw new Error('Erro ao consultar o backend.')
      }

      const dados: GarimpoStatus = await resposta.json()

      setStatus(dados)
    } catch {
      setStatus(null)
      setError('Não foi possível conectar ao backend.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function carregarStatusInicial() {
      try {
        const resposta = await fetch('/api/garimpo/status')
        if (!resposta.ok) throw new Error('Erro ao consultar o backend.')
        const dados: GarimpoStatus = await resposta.json()
        setStatus(dados)
      } catch {
        setError('Não foi possível conectar ao backend.')
      } finally {
        setLoading(false)
      }
    }

    void carregarStatusInicial()
  }, [])

  useEffect(() => {
    async function carregarConexaoMercadoLivre() {
      try {
        const resposta = await fetch('/api/mercadolivre/status', { cache: 'no-store' })
        if (!resposta.ok) throw new Error('Erro ao consultar a conexão.')

        const dados: { connected: boolean } = await resposta.json()
        setMercadoLivreStatus(dados.connected ? 'conectado' : 'desconectado')
      } catch {
        setMercadoLivreStatus('erro')
      }
    }

    void carregarConexaoMercadoLivre()

    if (retornoOAuth) {
      const url = new URL(window.location.href)
      url.searchParams.delete('meli')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [retornoOAuth])

  return (
    <main className="garimpo">
      <section className="painel">
        <div className="cabecalho">
          <span className="icone">🔎</span>

          <div>
            <h1>Valiô Garimpo</h1>
            <p>
              Sua central de seleção de produtos
            </p>
          </div>
        </div>

        <div className="status-card">
          <h2>Status do sistema</h2>

          {loading && (
            <p className="status-loading">
              Verificando conexão...
            </p>
          )}

          {!loading && status && (
            <>
              <p className="status-ok">
                🟢 Backend conectado
              </p>

              <div className="status-info">
                <strong>{status.garimpo}</strong>
                <span>
                  Sistema: {status.status}
                </span>
              </div>
            </>
          )}

          {!loading && error && (
            <p className="status-error">
              🔴 {error}
            </p>
          )}

          <button
            type="button"
            onClick={verificarBackend}
            disabled={loading}
          >
            {loading
              ? 'Verificando...'
              : 'Atualizar status'}
          </button>
        </div>

        <div className="status-card mercado-livre-card">
          <h2>Mercado Livre</h2>

          <p className={retornoOAuth === 'erro' || mercadoLivreStatus === 'erro'
            ? 'status-error'
            : mercadoLivreStatus === 'conectado' ? 'status-ok' : 'status-loading'}
            role="status"
          >
            {retornoOAuth === 'erro'
              ? 'Erro na conexão com o Mercado Livre. Tente novamente.'
              : mercadoLivreStatus === 'carregando'
                ? 'Verificando conexão com o Mercado Livre...'
                : mercadoLivreStatus === 'conectado'
                  ? 'Mercado Livre conectado'
                  : retornoOAuth === 'conectado'
                    ? 'Não foi possível confirmar a conexão com o Mercado Livre.'
                    : mercadoLivreStatus === 'erro'
                      ? 'Erro ao verificar a conexão com o Mercado Livre.'
                      : 'Mercado Livre não conectado.'}
          </p>

          <button
            type="button"
            onClick={() => { window.location.assign('/api/mercadolivre/auth/iniciar') }}
          >
            Conectar Mercado Livre
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
