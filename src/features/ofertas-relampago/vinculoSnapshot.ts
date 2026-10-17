import type { RegistroSnapshot } from '../importar-lista-afiliados/snapshotLoteAfiliados'
import type { ResultadoRetornoGerador } from '../importar-lista-afiliados/processarRetornoGerador'
import type { OfertaExtraida } from './extrairOfertas'
import { normalizarUrlIndividual } from './urlGerador'

// O retorno permanece ancorado na ordem ORIGINAL do snapshot. A projeção para
// outro lote usa exclusivamente ITEM_ID, nunca a posição das ofertas atuais.
export function vincularSnapshot(registro: RegistroSnapshot, ofertas: OfertaExtraida[], retorno: ResultadoRetornoGerador | null) {
  const idsSnapshot = registro.snapshot.produtos.map((p) => p.itemId)
  const idsAtual = [...new Set(ofertas.flatMap((p) => p.itemId ? [p.itemId] : []))]
  const problemas: { itemId: string; motivo: string }[] = []
  const compativeis: string[] = []
  const urlsDiferentes: string[] = []
  for (const itemId of idsAtual) {
    const atuais = ofertas.filter((p) => p.itemId === itemId)
    const originais = registro.snapshot.produtos.filter((p) => p.itemId === itemId)
    let motivo = ''
    if (!originais.length) motivo = 'ITEM_ID ausente do snapshot; nenhum link será transferido.'
    else if (atuais.length !== 1 || originais.length !== 1) motivo = 'ITEM_ID duplicado; vínculo ambíguo.'
    else if (!normalizarUrlIndividual(originais[0].urlNormalizada, itemId)) motivo = 'A URL do snapshot não comprova este ITEM_ID.'
    else if (atuais[0].urlOriginal && !normalizarUrlIndividual(atuais[0].urlOriginal, itemId)) motivo = 'A URL atual é inválida ou aponta para outro ITEM_ID.'
    if (motivo) problemas.push({ itemId, motivo })
    else {
      compativeis.push(itemId)
      if (atuais[0].urlOriginal && originais[0].urlNormalizada !== normalizarUrlIndividual(atuais[0].urlOriginal, itemId)) urlsDiferentes.push(itemId)
    }
  }
  const somenteSnapshot = idsSnapshot.filter((id) => !idsAtual.includes(id))
  const permitidos = new Set(compativeis)
  const pareamentos = retorno?.pareamentos.filter((p) => permitidos.has(p.produto.itemId)) ?? []
  // Não alterar o texto, o snapshot, os links ou a consistência do retorno original.
  const retornoSeguro = retorno ? { ...retorno, pareamentos,
    blocoAtualizador: retorno.consistente ? pareamentos.flatMap((p) => p.retorno?.link ? [`${p.produto.itemId} | ${p.retorno.link}`] : []).join('\n') : '' } : null
  return { idsSnapshot, idsAtual, compativeis, somenteSnapshot, problemas, urlsDiferentes, retornoSeguro }
}
