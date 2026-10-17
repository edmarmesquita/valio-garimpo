// O operador informa sempre o horário de Brasília, independentemente do navegador.
export function agendaIso(valor: string): string | null {
  if (!valor) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) throw new Error('Data/hora inválida.')
  const data = new Date(`${valor}:00-03:00`)
  if (!Number.isFinite(data.getTime())) throw new Error('Data/hora inválida.')
  if (agendaInput(data.toISOString()) !== valor) throw new Error('Data/hora inválida.')
  return data.toISOString()
}

export function agendaInput(valor: string | null): string {
  if (!valor) return ''
  const data = new Date(Date.parse(valor) - 3 * 60 * 60 * 1000)
  return Number.isFinite(data.getTime()) ? data.toISOString().slice(0, 16) : ''
}

export function inicioFuturo(valor: string): string {
  const inicio = agendaIso(valor)
  if (!inicio || Date.parse(inicio) <= Date.now()) throw new Error('Escolha um início futuro para o lote.')
  return inicio
}
