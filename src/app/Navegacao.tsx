import './Navegacao.css'

const destinos = [
  ['/', 'Início'],
  ['/extrair-afiliados', 'Importação/Publicação'],
  ['/ofertas-relampago', '⚡ Ofertas Relâmpago'],
  ['/manutencao', 'Manutenção'],
  ['/links-afiliados', 'Links afiliados'],
  ['/precos', 'Preços'],
  ['/recuperar-inativos', 'Recuperar inativos'],
  ['/diagnostico', 'Diagnóstico'],
] as const

export default function Navegacao({ caminho, navegar }: { caminho: string; navegar: (destino: string) => void }) {
  return <nav className="garimpo-navegacao" aria-label="Áreas do Garimpo">
    <div className="garimpo-navegacao__marca" aria-label="Valiô Garimpo">
      <span className="garimpo-navegacao__simbolo" aria-hidden="true">G</span>
      <span><strong>Valiô Garimpo</strong><small>Painel administrativo</small></span>
    </div>
    <p className="garimpo-navegacao__rotulo">ÁREAS DE TRABALHO</p>
    <div className="garimpo-navegacao__links">
      {destinos.map(([destino, nome]) => <a key={destino} href={destino} aria-current={caminho === destino ? 'page' : undefined}
        onClick={(evento) => {
          if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return
          evento.preventDefault(); navegar(destino)
        }}>{nome}</a>)}
    </div>
  </nav>
}
