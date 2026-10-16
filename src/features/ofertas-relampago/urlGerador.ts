import { normalizarUrlProdutoLista } from '../importar-lista-afiliados/extrairListaAfiliados'
import type { OfertaExtraida } from './extrairOfertas'

export function resolverUrlGerador(oferta: Pick<OfertaExtraida, 'urlOriginal' | 'itemId'>, origem: string) {
  const original = normalizarUrlProdutoLista(oferta.urlOriginal)
  if (original) return { url: original, fallback: false }
  const candidata = normalizarUrlProdutoLista(origem)
  if (candidata && oferta.itemId) {
    // A origem só serve para este item quando já contém sua identidade.
    // Páginas de listagem e URLs de outros produtos não permitem derivação segura.
    const url = new URL(candidata)
    let endereco: string
    try { endereco = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`) } catch { return { url: null, fallback: false } }
    const ids = [...endereco.matchAll(/\bMLB-?(\d+)\b/gi)]
      .map((match) => `MLB${match[1]}`)
    const idNoCaminho = new RegExp(`\\bMLB-?${oferta.itemId.slice(3)}\\b`, 'i').test(url.pathname)
    if (idNoCaminho && ids.length && ids.every((id) => id === oferta.itemId)) return { url: candidata, fallback: true }
  }
  return { url: null, fallback: false }
}
