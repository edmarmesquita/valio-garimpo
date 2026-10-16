import { ehLinkOficialParaAtualizacao } from '../../lib/linksAfiliados'
import type { ProdutoExistente } from '../../lib/verificarProdutosValio'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import type { ResultadoRetornoGerador } from '../importar-lista-afiliados/processarRetornoGerador'
import type { OfertaExtraida } from './extrairOfertas'

export type PreviaOferta = {
  itemId: string | null
  tipo: 'ATUALIZAR_OFERTA' | 'NOVO_PRODUTO'
  dados: Record<string, unknown>
}

export type ResultadoPreparo = {
  prontos: PreviaOferta[]
  bloqueados: { itemId: string | null; motivo: string }[]
}

const linkMeli = (valor: string | null): boolean => {
  if (!valor || !ehLinkOficialParaAtualizacao(valor)) return false
  return new URL(valor).hostname.toLowerCase() === 'meli.la'
}

const imagemHttps = (valor: string | null): boolean => {
  if (!valor) return false
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
}

export function prepararOfertasSelecionadas(
  ofertas: OfertaExtraida[], selecionados: ReadonlySet<string>,
  existentes: ReadonlyMap<string, ProdutoExistente>, verificados: ReadonlySet<string>,
  categorias: ReadonlyMap<string, CategoriaValio>, retorno: ResultadoRetornoGerador | null,
  prioridades: ReadonlyMap<string, number> = new Map(), desativadas: ReadonlySet<string> = new Set(),
): ResultadoPreparo {
  const prontos: PreviaOferta[] = []
  const bloqueados: ResultadoPreparo['bloqueados'] = []
  const pareamentos = new Map(retorno?.pareamentos.map((item) => [item.produto.itemId, item.retorno]) ?? [])
  for (const oferta of ofertas.filter((item) => selecionados.has(item.chave))) {
    const id = oferta.itemId
    const bloquear = (motivo: string) => bloqueados.push({ itemId: id, motivo })
    if (!id) { bloquear('SEM ITEM_ID: revisão necessária.'); continue }
    if (!verificados.has(id)) { bloquear('ITEM_ID ainda não verificado no Valiô.'); continue }
    const existente = existentes.get(id)
    if (desativadas.has(oferta.chave)) {
      if (!existente) { bloquear('Somente produto existente pode ter a oferta desativada.'); continue }
      prontos.push({ itemId: id, tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id, ofertaRelampago: false } })
      continue
    }
    if (oferta.situacao !== 'PRONTO' || oferta.precoAtual === null) { bloquear(`${oferta.situacao}: dados da oferta incompletos.`); continue }
    const prioridadeOferta = prioridades.get(oferta.chave) ?? 0
    if (!Number.isSafeInteger(prioridadeOferta)) { bloquear('Prioridade da oferta inválida.'); continue }
    const camposOferta = {
      ofertaRelampago: true,
      ofertaInicio: oferta.ofertaInicio,
      ofertaFim: oferta.ofertaFim,
      precoAnterior: oferta.precoAnterior,
      percentualDesconto: oferta.percentualDesconto,
      textoOferta: oferta.textoOferta,
      prioridadeOferta,
    }
    if (existente) {
      if (!ehLinkOficialParaAtualizacao(existente.linkAfiliado)) { bloquear('Link afiliado oficial existente inválido; revisar no fluxo de links.'); continue }
      prontos.push({ itemId: id, tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id, ...camposOferta } })
      continue
    }
    if (!retorno?.consistente) { bloquear('Retorno do Gerador ausente ou inconsistente.'); continue }
    const resultado = pareamentos.get(id)
    if (resultado?.tipo === 'RECUSADO' || resultado?.tipo === 'PAUSADO') { bloquear(`${resultado.tipo}: não publicar.`); continue }
    if (!resultado || resultado.tipo !== 'LINK' || !linkMeli(resultado.link)) { bloquear('Produto novo exige retorno pareado do Gerador com link oficial meli.la.'); continue }
    const categoria = categorias.get(id)
    if (!categoria) { bloquear('Selecione a categoria do produto novo.'); continue }
    if (!oferta.titulo?.trim() || !imagemHttps(oferta.imagem) || !Number.isFinite(oferta.precoAtual) || oferta.precoAtual <= 0) {
      bloquear('Produto novo exige título, preço positivo e imagem HTTPS.'); continue
    }
    prontos.push({ itemId: id, tipo: 'NOVO_PRODUTO', dados: {
      mercadoLivreId: id, titulo: oferta.titulo, imagem: oferta.imagem,
      preco: oferta.precoAtual, categoria, linkAfiliado: resultado.link, ...camposOferta,
    } })
  }
  return { prontos, bloqueados }
}
