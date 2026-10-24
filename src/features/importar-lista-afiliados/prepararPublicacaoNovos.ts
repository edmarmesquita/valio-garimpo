import { ehLinkOficialParaAtualizacao } from '../../lib/linksAfiliados'
import { problemasPublicacao } from '../../lib/publicarProdutosValio'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import type { LinhaPreviaLink, PreviaLinksLote } from '../../lib/manutencaoVitrine'
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

export type ErroPreviaPublicacao = { linha: number; itemId: string | null; motivo: string }
export type ClassificacaoPreviaPublicacao = { existentes: string[]; novos: NovoLista[]; erros: ErroPreviaPublicacao[] }

function produtoNaoEncontrado(motivo: string | null): boolean {
  return Boolean(motivo?.toLocaleLowerCase('pt-BR').includes('produto n\u00e3o encontrado'))
}

function linkJaSalvo(motivo: string | null): boolean {
  return Boolean(motivo?.toLocaleLowerCase('pt-BR').includes('este link j\u00e1 est\u00e1 salvo'))
}

function errosDaPrevia(linhas: LinhaPreviaLink[], motivo: string): ErroPreviaPublicacao[] {
  return linhas.map((linha) => ({ linha: linha.linha, itemId: linha.mercado_livre_id, motivo: linha.motivo ?? motivo }))
}

function urlHttps(valor: string | null): boolean {
  if (!valor) return false
  try { return new URL(valor).protocol === 'https:' } catch { return false }
}

export function prepararPublicacaoNovos(retorno: ResultadoRetornoGerador, previa: PreviaLinksLote,
  categorias: ReadonlyMap<string, CategoriaValio>): ClassificacaoPreviaPublicacao {
  if (!retorno.consistente || !retorno.blocoAtualizador) return { existentes: [], novos: [], erros: [] }
  const links = retorno.pareamentos.filter((item) => item.retorno?.tipo === 'LINK' && item.retorno.link)
  if (previa.solicitadas !== links.length || previa.linhas.length !== links.length) return {
    existentes: [], novos: [], erros: errosDaPrevia(previa.linhas, 'Quantidade de resultados da prévia incompatível.'),
  }
  const existentes: string[] = []
  const novos: NovoLista[] = []
  const erros: ErroPreviaPublicacao[] = []
  links.forEach(({ produto, retorno: linha }, indice) => {
    const item = previa.linhas[indice]
    const link = linha!.link!
    if (item.linha !== indice + 1 || item.mercado_livre_id !== produto.itemId || item.link_novo !== link) {
      erros.push({ linha: item.linha, itemId: item.mercado_livre_id,
        motivo: 'Resultado da prévia não corresponde à posição e ao ITEM_ID enviados.' })
      return
    }
    if (!item.motivo || linkJaSalvo(item.motivo)) { existentes.push(produto.itemId); return }
    if (!produtoNaoEncontrado(item.motivo)) {
      erros.push({ linha: item.linha, itemId: item.mercado_livre_id, motivo: item.motivo })
      return
    }

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
  return { existentes, novos, erros }
}
