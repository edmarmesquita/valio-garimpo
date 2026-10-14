import './Navegacao.css'

const destinos = [
  ['/', 'Início'],
  ['/extrair-afiliados', 'Importação/Publicação'],
  ['/manutencao', 'Manutenção'],
  ['/links-afiliados', 'Links afiliados'],
  ['/precos', 'Preços'],
  ['/diagnostico', 'Diagnóstico'],
] as const

export default function Navegacao({ caminho, navegar }: { caminho: string; navegar: (destino: string) => void }) {
  return <nav className="garimpo-navegacao" aria-label="Áreas do Garimpo">
    {destinos.map(([destino, nome]) => <a key={destino} href={destino} aria-current={caminho === destino ? 'page' : undefined}
      onClick={(evento) => {
        if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return
        evento.preventDefault(); navegar(destino)
      }}>{nome}</a>)}
  </nav>
}
