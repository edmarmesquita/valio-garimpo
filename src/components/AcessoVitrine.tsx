import { useSessaoOperacional } from '../app/sessaoOperacionalContext'

export default function AcessoVitrine() {
  const { token, setToken } = useSessaoOperacional()
  return <section className="extrair-card extrair-acesso" aria-labelledby="acesso-titulo">
    <h2 id="acesso-titulo">Acesso à vitrine</h2>
    <label htmlFor="token-publicacao">Token de publicação</label>
    <input id="token-publicacao" type="password" autoComplete="off" value={token}
      onChange={(evento) => setToken(evento.target.value)} placeholder="Token configurado no backend" />
    <p>Use o token de publicação do Garimpo para verificar, enviar e manter produtos. Não informe a Service Role nesta tela.</p>
  </section>
}
