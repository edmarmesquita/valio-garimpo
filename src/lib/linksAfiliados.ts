// Classifica links oficiais sem segui-los nem normalizar a string original.
export function ehLinkMonetizado(link: string): boolean {
  let url: URL
  try { url = new URL(link) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  if (host === 'meli.la') return true
  if (!(host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br'))) return false
  if (/^\/social\//i.test(url.pathname) && url.searchParams.size > 0) return true
  return [...url.searchParams.keys()].some((chave) => /^(?:matt_word|matt_tool|ref|utm_.+|aff(?:iliate|_id|_tag))$/i.test(chave))
}
