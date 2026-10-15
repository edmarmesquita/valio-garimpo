import type { ProdutoListaAfiliados } from './extrairListaAfiliados'

export type TipoRetornoGerador = 'LINK' | 'RECUSADO' | 'PAUSADO' | 'REVISAR'

export type LinhaRetornoGerador = {
  tipo: TipoRetornoGerador
  original: string
  link: string | null
}

export type PareamentoRetornoGerador = {
  produto: ProdutoListaAfiliados
  retorno: LinhaRetornoGerador | null
  situacao: 'PRONTO' | 'NÃO PUBLICAR' | 'REVISAR'
}

export type ResultadoRetornoGerador = {
  pareamentos: PareamentoRetornoGerador[]
  excedentes: LinhaRetornoGerador[]
  totalProdutos: number
  totalResultados: number
  linksValidos: number
  recusados: number
  pausados: number
  revisar: number
  errosQuantidade: number
  consistente: boolean
  blocoAtualizador: string
}

const semAcentos = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function classificarLinha(original: string): LinhaRetornoGerador | null {
  const texto = original.trim()
  if (!texto) return null
  const normalizado = semAcentos(texto)
  if (normalizado.includes('o campo esta vazio') && normalizado.includes('insira o url')) return null

  if (/^https:\/\/meli\.la\/[a-z0-9_-]+\/?$/i.test(texto)) {
    return { tipo: 'LINK', original: texto, link: texto }
  }
  if (normalizado.includes('este produto nao cumpre com os requisitos do programa')) {
    return { tipo: 'RECUSADO', original: texto, link: null }
  }
  if (normalizado.includes('este url corresponde a um produto pausado')) {
    return { tipo: 'PAUSADO', original: texto, link: null }
  }
  return { tipo: 'REVISAR', original: texto, link: null }
}

export function processarRetornoGerador(produtos: readonly ProdutoListaAfiliados[], texto: string): ResultadoRetornoGerador {
  const resultados = texto.split(/\r?\n/).flatMap((linha) => {
    const classificada = classificarLinha(linha)
    return classificada ? [classificada] : []
  })
  const pareamentos = produtos.map((produto, indice): PareamentoRetornoGerador => {
    const retorno = resultados[indice] ?? null
    return {
      produto,
      retorno,
      situacao: retorno?.tipo === 'LINK' ? 'PRONTO' : retorno?.tipo === 'RECUSADO' || retorno?.tipo === 'PAUSADO' ? 'NÃO PUBLICAR' : 'REVISAR',
    }
  })
  const excedentes = resultados.slice(produtos.length)
  const totalResultados = resultados.length
  const errosQuantidade = Math.abs(produtos.length - totalResultados)
  const revisar = resultados.filter((item) => item.tipo === 'REVISAR').length + Math.max(0, produtos.length - totalResultados)
  const consistente = errosQuantidade === 0 && revisar === 0

  return {
    pareamentos,
    excedentes,
    totalProdutos: produtos.length,
    totalResultados,
    linksValidos: resultados.filter((item) => item.tipo === 'LINK').length,
    recusados: resultados.filter((item) => item.tipo === 'RECUSADO').length,
    pausados: resultados.filter((item) => item.tipo === 'PAUSADO').length,
    revisar,
    errosQuantidade,
    consistente,
    blocoAtualizador: consistente ? pareamentos.flatMap(({ produto, retorno }) =>
      retorno?.link ? [`${produto.itemId} | ${retorno.link}`] : []).join('\n') : '',
  }
}
