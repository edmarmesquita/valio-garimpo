import type { ProdutoAfiliado } from './extrairProdutosAfiliados'
import { classificarIdadePreco } from './manutencaoVitrine'
import type { IdadePreco, ProdutoCatalogo } from './manutencaoVitrine'

export type LotesRevisao = { lotes: number; brutos: number; duplicados: number; semId: number; atualizadosSessao: number;
  produtos: Map<string, ProdutoAfiliado>; problemas: Map<string, string>; fontes: Map<string, 'json' | 'html'>;
  urls: Map<string, string> }
export const lotesVazios = (): LotesRevisao => ({ lotes: 0, brutos: 0, duplicados: 0, semId: 0, atualizadosSessao: 0,
  produtos: new Map(), problemas: new Map(), fontes: new Map(), urls: new Map() })

export function adicionarLote(atual: LotesRevisao, extraidos: ProdutoAfiliado[], opcoes: {
  fonte?: 'json' | 'html'; brutos?: number; semId?: number; problemas?: ReadonlyMap<string, string>; urls?: ReadonlyMap<string, string>
} = {}): LotesRevisao {
  const produtos = new Map(atual.produtos)
  const problemas = new Map(atual.problemas)
  const fontes = new Map(atual.fontes)
  const urls = new Map(atual.urls)
  let duplicados = atual.duplicados + Math.max(0, (opcoes.brutos ?? extraidos.length) - extraidos.length - (opcoes.semId ?? 0))
  let atualizadosSessao = atual.atualizadosSessao
  for (const item of extraidos) {
    if (!item.itemId || !/^MLB\d+$/.test(item.itemId)) continue
    const anterior = produtos.get(item.itemId)
    if (anterior) {
      duplicados++
      if (anterior.precoAtual !== item.precoAtual) atualizadosSessao++
    }
    produtos.set(item.itemId, item)
    fontes.set(item.itemId, opcoes.fonte ?? 'json')
    if (opcoes.problemas?.has(item.itemId)) problemas.set(item.itemId, opcoes.problemas.get(item.itemId)!)
    else problemas.delete(item.itemId)
    if (opcoes.urls?.has(item.itemId)) urls.set(item.itemId, opcoes.urls.get(item.itemId)!)
    else urls.delete(item.itemId)
  }
  return { lotes: atual.lotes + 1, brutos: atual.brutos + (opcoes.brutos ?? extraidos.length), duplicados,
    semId: atual.semId + (opcoes.semId ?? 0),
    atualizadosSessao, produtos, problemas, fontes, urls }
}

export type ItemFila = {
  produto: ProdutoCatalogo; idade: IdadePreco; extraido?: ProdutoAfiliado
  diferencaCentavos: number | null; outrosCampos: string[]; problema?: string; fonte?: 'json' | 'html'; url?: string
}

export function montarFila(catalogo: ProdutoCatalogo[], lotes: LotesRevisao, incluirAtualizados = false, hoje = new Date()): ItemFila[] {
  return catalogo.flatMap((produto) => {
    if (!produto.ativo) return []
    const idade = classificarIdadePreco(produto.dataPreco, hoje)
    if (idade === 'Atualizado' && !incluirAtualizados && !lotes.produtos.has(produto.mercadoLivreId)) return []
    const extraido = lotes.produtos.get(produto.mercadoLivreId)
    const diferencaCentavos = extraido?.precoAtual == null || extraido.precoAtual <= 0 ? null : Math.round(extraido.precoAtual * 100) - Math.round(produto.preco * 100)
    const outrosCampos = extraido ? [
      ...(extraido.titulo && extraido.titulo !== produto.titulo ? ['título'] : []),
      ...(extraido.imagemUrl && extraido.imagemUrl !== produto.imagem ? ['imagem'] : []),
      ...(extraido.linkOriginal && extraido.linkOriginal !== produto.linkAfiliado ? ['link'] : []),
      ...(extraido.avaliacao != null && extraido.avaliacao !== produto.rating ? ['rating'] : []),
    ] : []
    return [{ produto, idade, extraido, diferencaCentavos, outrosCampos,
      problema: lotes.problemas.get(produto.mercadoLivreId), fonte: lotes.fontes.get(produto.mercadoLivreId),
      url: lotes.urls.get(produto.mercadoLivreId) }]
  })
}

export type FiltroFila = 'todos' | 'preco-alterado' | 'preco-igual' | 'nao-encontrados' | 'outros-dados' | 'precisa-revisao' | 'revisar-breve'
export type OrdemFila = 'maior-diferenca' | 'maior-reducao' | 'maior-aumento' | 'antigos' | 'recentes' | 'categoria'
const chaveData = (data: string) => { const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data); return p ? `${p[3]}${p[2]}${p[1]}` : '' }

export function filtrarFila(fila: ItemFila[], filtro: FiltroFila, ordem: OrdemFila): ItemFila[] {
  const visiveis = fila.filter((item) => {
    switch (filtro) {
      case 'preco-alterado': return item.diferencaCentavos !== null && item.diferencaCentavos !== 0
      case 'preco-igual': return item.diferencaCentavos === 0
      case 'nao-encontrados': return !item.extraido
      case 'outros-dados': return item.outrosCampos.length > 0
      case 'precisa-revisao': return item.idade === 'Precisa revisão'
      case 'revisar-breve': return item.idade === 'Revisar em breve'
      default: return true
    }
  })
  return visiveis.sort((a, b) => {
    const av = a.diferencaCentavos ?? 0; const bv = b.diferencaCentavos ?? 0
    switch (ordem) {
      case 'maior-diferenca': return Math.abs(bv) - Math.abs(av)
      case 'maior-reducao': return av - bv
      case 'maior-aumento': return bv - av
      case 'antigos': return chaveData(a.produto.dataPreco).localeCompare(chaveData(b.produto.dataPreco))
      case 'recentes': return chaveData(b.produto.dataPreco).localeCompare(chaveData(a.produto.dataPreco))
      case 'categoria': return a.produto.categoria.localeCompare(b.produto.categoria, 'pt-BR')
    }
  })
}

export function selecionarFila(fila: ItemFila[], modo: 'alterados' | 'encontrados' | 'limpar'): Set<string> {
  return new Set(modo === 'limpar' ? [] : fila.filter((item) => item.diferencaCentavos !== null
    && (modo === 'encontrados' || item.diferencaCentavos !== 0)).map((item) => item.produto.mercadoLivreId))
}

export type EntradaPreco = { mercadoLivreId: string; preco: number; atualizarPreco: boolean; precoEsperado?: number }
export type ResultadoPreco = { mercadoLivreId: string; status: 'atualizado' | 'confirmado' | 'erro'; erro?: string; dataPreco?: string; updatedAt?: string }
export function dividirEmBlocos<T>(itens: T[], tamanho = 50): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error('Tamanho de bloco inválido.')
  const blocos: T[][] = []
  for (let inicio = 0; inicio < itens.length; inicio += tamanho) blocos.push(itens.slice(inicio, inicio + tamanho))
  return blocos
}

export async function enviarPrecosEmBlocos(entradas: EntradaPreco[], token: string, enviar: typeof fetch = fetch): Promise<ResultadoPreco[]> {
  if (!token.trim()) throw new Error('Informe o token de publicação para atualizar preços.')
  const resultados: ResultadoPreco[] = []
  for (const bloco of dividirEmBlocos(entradas)) {
    try {
      const resposta = await enviar('/api/valio/produtos/precos-lote', { method: 'PATCH', headers: {
        Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ produtos: bloco }), cache: 'no-store' })
      const dados: unknown = await resposta.json()
      if (!resposta.ok || !dados || typeof dados !== 'object' || (dados as { ok?: unknown }).ok !== true
        || !Array.isArray((dados as { resultados?: unknown }).resultados)) throw new Error('Falha na API.')
      const recebidos = (dados as { resultados: ResultadoPreco[] }).resultados
      const mapa = new Map(recebidos.map((item) => [item.mercadoLivreId, item]))
      resultados.push(...bloco.map((item) => mapa.get(item.mercadoLivreId) ?? { mercadoLivreId: item.mercadoLivreId, status: 'erro' as const, erro: 'Sem resultado da API.' }))
    } catch {
      resultados.push(...bloco.map((item) => ({ mercadoLivreId: item.mercadoLivreId, status: 'erro' as const, erro: 'Falha de conexão ou resposta da API.' })))
    }
  }
  return resultados
}
