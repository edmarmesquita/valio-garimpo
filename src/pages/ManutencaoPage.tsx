import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import AreaOperacional from '../components/AreaOperacional'
import ManutencaoVitrine from './ManutencaoVitrine'

export default function ManutencaoPage() {
  const { token } = useSessaoOperacional()
  return <AreaOperacional titulo="Manutenção da vitrine" descricao="Consulte o catálogo e gerencie status e categorias.">
    <ManutencaoVitrine token={token} lote={null} categorias={new Map()} />
  </AreaOperacional>
}
