export type ClassificacaoPrecoAfiliado = 'NORMAL' | 'DESCONTO' | 'PIX' | 'CUPOM' | 'OUTRO_REVISAR'

export function classificarPrecoAfiliado(label: string | null, atual: number | null, anterior: number | null): ClassificacaoPrecoAfiliado {
  const texto = (label ?? '').trim()
  // Condições mistas são ambíguas, não um desconto simples.
  if (/saldo|mercado\s*pago/i.test(texto) || (/pix/i.test(texto) && /cupom/i.test(texto))) return 'OUTRO_REVISAR'
  if (/\bpix\b/i.test(texto)) return 'PIX'
  if (/\bcupom\b/i.test(texto)) return 'CUPOM'
  if (texto) return /^\d+(?:[.,]\d+)?%\s*OFF$/i.test(texto) ? 'DESCONTO' : 'OUTRO_REVISAR'
  return atual !== null && anterior !== null && anterior > atual ? 'DESCONTO' : 'NORMAL'
}
