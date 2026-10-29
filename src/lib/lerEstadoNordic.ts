type Registro = Record<string, unknown>

function jsonBalanceado(texto: string, inicio: number): string | null {
  if (texto[inicio] !== '{') return null
  let nivel = 0, aspas = false, escape = false
  for (let indice = inicio; indice < texto.length; indice++) {
    const caractere = texto[indice]
    if (aspas) {
      if (escape) escape = false
      else if (caractere === '\\') escape = true
      else if (caractere === '"') aspas = false
    } else if (caractere === '"') aspas = true
    else if (caractere === '{') nivel++
    else if (caractere === '}' && --nivel === 0) return texto.slice(inicio, indice + 1)
  }
  return null
}

export function lerEstadoNordic(html: string): Registro {
  if (!html.trim() || html.length > 10_000_000) throw new Error('HTML vazio ou maior que 10 MB.')
  const script = /<script\b(?=[^>]*\bid=["']__NORDIC_RENDERING_CTX__["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html)
  const atribuicao = script && /_n\.ctx\.r\s*=\s*(\{)/.exec(script[1])
  const json = script && atribuicao
    ? jsonBalanceado(script[1], atribuicao.index + atribuicao[0].length - 1) : null
  if (!json) throw new Error('O HTML não contém estado Nordic estruturado reconhecido.')
  let contexto: unknown
  try { contexto = JSON.parse(json) } catch { throw new Error('O estado Nordic do HTML é inválido.') }
  if (contexto === null || typeof contexto !== 'object' || Array.isArray(contexto))
    throw new Error('O estado Nordic do HTML não é um objeto válido.')
  return contexto as Registro
}
