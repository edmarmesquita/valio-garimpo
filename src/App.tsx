import { useEffect, useState } from 'react'
import './App.css'

type GarimpoStatus = {
  ok: boolean
  garimpo: string
  status: string
}

type MercadoLivreStatus = 'carregando' | 'conectado' | 'desconectado' | 'erro'

const acessos = [
  { href: '/extrair-afiliados', titulo: 'Importação / Publicação', descricao: 'Prepare produtos e envie os selecionados para o Valiô.', acao: 'Abrir importação' },
  { href: '/manutencao', titulo: 'Manutenção', descricao: 'Consulte o catálogo e gerencie visibilidade e categorias.', acao: 'Abrir manutenção' },
  { href: '/links-afiliados', titulo: 'Links afiliados', descricao: 'Atualize links oficiais individualmente ou em lote.', acao: 'Gerenciar links' },
  { href: '/precos', titulo: 'Preços', descricao: 'Revise e atualize preços com os dados da Central.', acao: 'Revisar preços' },
  { href: '/diagnostico', titulo: 'Diagnóstico', descricao: 'Acompanhe o status e as métricas disponíveis.', acao: 'Ver diagnóstico' },
] as const

function App({ componente = 'main' }: { componente?: 'main' | 'section' }) {
  const Container = componente
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
    <Container className={`garimpo${componente === 'section' ? ' garimpo--diagnostico' : ''}`}>
      <section className="painel">
        {componente === 'main' && <>
          <header className="cabecalho">
            <p className="garimpo-sobretitulo">CENTRAL DE OPERAÇÕES</p>
            <h1>Valiô Garimpo</h1>
            <p>Painel administrativo para importar, publicar e manter a vitrine.</p>
          </header>
          <section className="garimpo-acessos" aria-labelledby="garimpo-acessos-titulo">
            <div className="garimpo-secao-cabecalho"><div><p className="garimpo-sobretitulo">NAVEGAÇÃO RÁPIDA</p><h2 id="garimpo-acessos-titulo">Áreas de trabalho</h2></div>
              <p>Escolha uma área para continuar a operação.</p></div>
            <div className="garimpo-acessos-grid">{acessos.map((acesso, indice) => <article className="garimpo-acesso-card" key={acesso.href}>
              <span className="garimpo-acesso-numero" aria-hidden="true">{String(indice + 1).padStart(2, '0')}</span>
              <h3>{acesso.titulo}</h3><p>{acesso.descricao}</p>
              <a className="garimpo-link" href={acesso.href}>{acesso.acao} <span aria-hidden="true">↗</span></a>
            </article>)}</div>
          </section>
        </>}

        <section className="garimpo-status" aria-label="Estado das integrações">
          <div className="garimpo-secao-cabecalho"><div><p className="garimpo-sobretitulo">ACOMPANHAMENTO</p><h2>Estado das integrações</h2></div></div>
          <div className="garimpo-status-grid">
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
                  : mercadoLivreStatus === 'erro'
                    ? 'Erro ao verificar a conexão com o Mercado Livre. Tente novamente.'
                    : retornoOAuth === 'conectado'
                      ? 'Não foi possível confirmar a conexão com o Mercado Livre.'
                      : 'Mercado Livre não conectado.'}
          </p>

          <button
            type="button"
            onClick={() => { window.location.assign('/api/mercadolivre/auth/iniciar') }}
          >
            Conectar Mercado Livre
          </button>
        </div>

          </div>
        </section>
      </section>
    </Container>
  )
}

export default App
