import { ehLinkOficialParaAtualizacao } from '../../lib/linksAfiliados'
import { problemasPublicacao } from '../../lib/publicarProdutosValio'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import type { PreviaLinksLote } from '../../lib/manutencaoVitrine'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import type { ResultadoRetornoGerador } from './processarRetornoGerador'
import type { ProdutoListaAfiliados } from './extrairListaAfiliados'

export type NovoLista = {
  produto: ProdutoListaAfiliados
  link: string
  dados: ProdutoAfiliado | null
  situacao: 'PRONTO PARA PUBLICAR' | 'DADOS INCOMPLETOS' | 'SEM CATEGORIA' | 'LINK NÃO OFICIAL'
  faltantes: string[]
}

function urlHttps(valor: string | null): boolean {
  if (!valor) return false
  try { return new URL(valor).protocol === 'https:' } catch { return false }
}

export function prepararPublicacaoNovos(retorno: ResultadoRetornoGerador, previa: PreviaLinksLote,
  categorias: ReadonlyMap<string, CategoriaValio>): { existentes: string[]; novos: NovoLista[] } {
  if (!retorno.consistente || !retorno.blocoAtualizador) return { existentes: [], novos: [] }
  const links = retorno.pareamentos.filter((item) => item.retorno?.tipo === 'LINK' && item.retorno.link)
  if (previa.solicitadas !== links.length || previa.linhas.length !== links.length) return { existentes: [], novos: [] }
  const existentes: string[] = []
  const novos: NovoLista[] = []
  links.forEach(({ produto, retorno: linha }, indice) => {
    const item = previa.linhas[indice]
    const link = linha!.link!
    if (item.linha !== indice + 1 || item.mercado_livre_id !== produto.itemId || item.link_novo !== link) return
    if (!item.motivo) { existentes.push(produto.itemId); return }
    if (!item.motivo.toLowerCase().includes('produto não encontrado')) return

    const dados = produto.dadosPublicacao ? { ...produto.dadosPublicacao, itemId: produto.itemId,
      titulo: produto.dadosPublicacao.titulo ?? produto.titulo, linkOriginal: link } : null
    const categoria = categorias.get(produto.itemId)
    const faltantes = dados ? problemasPublicacao(dados, categoria).filter((campo) => campo !== 'categoria') : ['preço', 'imagem']
    if (!dados?.titulo?.trim() && !faltantes.includes('título')) faltantes.push('título')
    if (!dados?.precoAtual || dados.precoAtual <= 0 || !Number.isFinite(dados.precoAtual)) {
      if (!faltantes.includes('preço')) faltantes.push('preço')
    }
    if (!urlHttps(dados?.imagemUrl ?? null) && !faltantes.includes('imagem')) faltantes.push('imagem')
    if (!/^MLB\d+$/.test(produto.itemId)) faltantes.push('ITEM_ID')
    const situacao = !ehLinkOficialParaAtualizacao(link) ? 'LINK NÃO OFICIAL'
      : faltantes.length ? 'DADOS INCOMPLETOS' : !categoria ? 'SEM CATEGORIA' : 'PRONTO PARA PUBLICAR'
    novos.push({ produto, link, dados, situacao, faltantes })
  })
  return { existentes, novos }
}
