import { useEffect, useState } from 'react'
import App from '../App'
import ImportarProdutos from '../pages/ImportarProdutos'
import ExtrairAfiliados from '../pages/ExtrairAfiliados'
import ManutencaoPage from '../pages/ManutencaoPage'
import LinksAfiliadosPage from '../pages/LinksAfiliadosPage'
import PrecosPage from '../pages/PrecosPage'
import DiagnosticoPage from '../pages/DiagnosticoPage'
import OfertasRelampagoPage from '../pages/OfertasRelampagoPage'
import Navegacao from './Navegacao'

const caminhoAtual = () => window.location.pathname.replace(/\/$/, '') || '/'
const rotasInternas = new Set(['/', '/importar-produtos', '/extrair-afiliados', '/ofertas-relampago', '/manutencao', '/links-afiliados', '/precos', '/diagnostico'])

export default function Roteador() {
  const [caminho, setCaminho] = useState(caminhoAtual)
  useEffect(() => {
    const atualizar = () => setCaminho(caminhoAtual())
    const seguirLinkInterno = (evento: MouseEvent) => {
      if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return
      const alvo = evento.target
      if (!(alvo instanceof window.Element)) return
      const link = alvo.closest('a[href]')
      if (!(link instanceof window.HTMLAnchorElement) || link.closest('.garimpo-navegacao') || link.target || link.hasAttribute('download')) return
      const destino = new URL(link.href)
      if (destino.origin !== window.location.origin || !rotasInternas.has(destino.pathname)) return
      evento.preventDefault()
      if (destino.pathname === caminhoAtual()) return
      window.history.pushState(null, '', destino.pathname)
      setCaminho(destino.pathname)
    }
    window.addEventListener('popstate', atualizar)
    document.addEventListener('click', seguirLinkInterno)
    return () => { window.removeEventListener('popstate', atualizar); document.removeEventListener('click', seguirLinkInterno) }
  }, [])
  function navegar(destino: string) {
    if (destino === caminho) return
    window.history.pushState(null, '', destino)
    setCaminho(destino)
  }
  const pagina = caminho === '/importar-produtos' ? <ImportarProdutos />
      : caminho === '/extrair-afiliados' ? null
        : caminho === '/ofertas-relampago' ? <OfertasRelampagoPage />
      : caminho === '/manutencao' ? <ManutencaoPage />
        : caminho === '/links-afiliados' ? <LinksAfiliadosPage />
          : caminho === '/precos' ? <PrecosPage />
            : caminho === '/diagnostico' ? <DiagnosticoPage /> : <App />
  const areaAtual = caminho === '/importar-produtos' ? 'Importar produtos'
    : caminho === '/extrair-afiliados' ? 'Importação / Publicação'
      : caminho === '/ofertas-relampago' ? 'Ofertas Relâmpago'
      : caminho === '/manutencao' ? 'Manutenção'
        : caminho === '/links-afiliados' ? 'Links afiliados'
          : caminho === '/precos' ? 'Preços'
            : caminho === '/diagnostico' ? 'Diagnóstico' : 'Início'
  return <div className="garimpo-shell">
    <Navegacao caminho={caminho} navegar={navegar} />
    <div className="garimpo-shell__conteudo">
      <div className="garimpo-topo"><span>Painel administrativo</span><span className="garimpo-topo__area">{areaAtual}</span></div>
      <ExtrairAfiliados visivel={caminho === '/extrair-afiliados'} />{pagina}
    </div>
  </div>
}
