import type { RevalidacaoHar, SelecaoConfirmacaoHar } from './atualizacaoHarTipos.js'

export function selecaoCorrespondeHar(revalidacao: RevalidacaoHar, valor: unknown): valor is SelecaoConfirmacaoHar {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const v = valor as SelecaoConfirmacaoHar
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, 'versao') || !Object.hasOwn(v, 'itens')
    || v.versao !== revalidacao.versao || !Array.isArray(v.itens) || !v.itens.length || v.itens.length !== revalidacao.itens.length) return false
  const ids = new Set<string>()
  return v.itens.every((i) => {
    if (!i || typeof i !== 'object' || Array.isArray(i) || Object.keys(i).length !== 4
      || !['itemId', 'precoBase', 'novoPreco', 'classificacao'].every((k) => Object.hasOwn(i, k)) || ids.has(i.itemId)) return false
    ids.add(i.itemId)
    const p = revalidacao.itens.find((p) => p.itemId === i.itemId)
    return Boolean(p && p.precoBase === i.precoBase && p.novoPreco === i.novoPreco && p.classificacao === i.classificacao)
  })
}
