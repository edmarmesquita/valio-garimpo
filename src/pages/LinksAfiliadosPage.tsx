import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import AreaOperacional from '../components/AreaOperacional'
import LinksAfiliadosPanel from '../components/LinksAfiliadosPanel'

export default function LinksAfiliadosPage() {
  const { token } = useSessaoOperacional()
  return <AreaOperacional titulo="Links afiliados" descricao="Atualize links oficiais de produtos existentes.">
    <section className="extrair-card" aria-label="Manutenção de links afiliados">
      <LinksAfiliadosPanel token={token} />
    </section>
  </AreaOperacional>
}
