import { useState } from 'react'
import type { ReactNode } from 'react'
import { ContextoSessao } from './sessaoOperacionalContext'
import type { DiagnosticoVerificacao } from './sessaoOperacionalContext'

export function SessaoOperacionalProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState('')
  const [diagnostico, setDiagnostico] = useState<DiagnosticoVerificacao | null>(null)
  return <ContextoSessao.Provider value={{ token, setToken, diagnostico, setDiagnostico }}>
    {children}
  </ContextoSessao.Provider>
}
