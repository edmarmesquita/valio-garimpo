import type { ProdutoImportado } from '../types/produtoImportado.js'

const dominiosPermitidos = ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la']

function validarLink(link: string): string | undefined {
  if (/\s/.test(link)) return 'O link contém espaços internos.'

  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'Use um link HTTP ou HTTPS.'
    }
    if (url.username || url.password || url.port) {
      return 'O link contém credenciais ou uma porta não permitida.'
    }
    const dominioValido = dominiosPermitidos.some((dominio) =>
      url.hostname === dominio || url.hostname.endsWith(`.${dominio}`),
    )
    if (!dominioValido) return 'O domínio não é do Mercado Livre.'
    return undefined
  } catch {
    return 'Formato de link inválido. Inclua http:// ou https://.'
  }
}

export function extrairIdItem(link: string): string | null {
  if (validarLink(link)) return null
  const url = new URL(link)
  const segments = url.pathname.split('/')
  for (let index = 0; index < segments.length; index++) {
    if (segments[index - 1]?.toLowerCase() === 'p') continue
    const match = /^MLB-?(\d+)(?:-|$)/i.exec(segments[index])
    if (match) return `MLB${match[1]}`
  }
  return null
}

export function processarLinks(texto: string): ProdutoImportado[] {
  const links = [...new Set(texto.split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean))]

  return links.map((linkOriginal, index) => {
    const motivo = validarLink(linkOriginal)
    return {
      numero: index + 1,
      linkOriginal,
      status: motivo ? 'invalido' : 'valido',
      ...(motivo ? { motivo } : {}),
    }
  })
}
