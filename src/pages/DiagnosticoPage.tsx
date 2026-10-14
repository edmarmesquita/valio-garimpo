import { useSessaoOperacional } from '../app/sessaoOperacionalContext'
import App from '../App'
import AreaOperacional from '../components/AreaOperacional'
import MetricasVitrine from './MetricasVitrine'
import './DiagnosticoPage.css'

export default function DiagnosticoPage() {
  const { token, diagnostico } = useSessaoOperacional()
  return <AreaOperacional titulo="Diagnóstico e métricas" descricao="Consulte o status do sistema e os cliques agregados da vitrine.">
      <App componente="section" />
      <MetricasVitrine token={token} />
      {diagnostico && <details className="extrair-card extrair-diagnostico"><summary>Diagnóstico da verificação (ITEM_IDs)</summary>
        <p>IDs enviados: {diagnostico.idsEnviados.length}</p><p>{diagnostico.idsEnviados.join(', ') || 'Nenhum'}</p>
        <p>Existentes retornados: {diagnostico.estado === 'pronto' ? diagnostico.idsRetornados.length : 'verificação pendente'}</p>
        <p>{diagnostico.estado === 'pronto' ? diagnostico.idsRetornados.join(', ') || 'Nenhum' : 'Sem resultado confirmado'}</p>
        <p>Classificação final: {diagnostico.estado === 'pronto' ? `${diagnostico.novos} novos; ${diagnostico.cadastrados} existentes` : 'não disponível'}</p>
      </details>}
    </AreaOperacional>
}
