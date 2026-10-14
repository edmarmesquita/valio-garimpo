import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import AreaOperacional from '../components/AreaOperacional'
import LinksAfiliadosPanel from '../components/LinksAfiliadosPanel'

export default function LinksAfiliadosPage() {
  const { token } = useSessaoOperacional()
  return <AreaOperacional titulo="Links afiliados" descricao="Atualize links oficiais de produtos existentes.">
    <div className="links-afiliados-layout" aria-label="Manutenção de links afiliados">
      <LinksAfiliadosPanel token={token} />
    </div>
  </AreaOperacional>
}
