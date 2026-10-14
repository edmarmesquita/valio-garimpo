import { createContext, useContext } from 'react'

export type DiagnosticoVerificacao = {
  idsEnviados: string[]
  idsRetornados: string[]
  estado: 'pendente' | 'consultando' | 'pronto' | 'erro'
  novos: number
  cadastrados: number
}

export type Sessao = {
  token: string
  setToken: (valor: string) => void
  diagnostico: DiagnosticoVerificacao | null
  setDiagnostico: (valor: DiagnosticoVerificacao | null) => void
}

export const ContextoSessao = createContext<Sessao | null>(null)

export function useSessaoOperacional() {
  const sessao = useContext(ContextoSessao)
  if (!sessao) throw new Error('Área operacional sem sessão em memória.')
  return sessao
}
