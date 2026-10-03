import { useEffect, useState } from 'react'
import './App.css'

type GarimpoStatus = {
  ok: boolean
  garimpo: string
  status: string
}

function App() {
  const [status, setStatus] = useState<GarimpoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
      </section>
    </main>
  )
}

export default App
