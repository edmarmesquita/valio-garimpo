import type { ProdutoAfiliado } from './extrairProdutosAfiliados'
import type { CategoriaValio } from './produtosGarimpados'
import { ehLinkOficialParaAtualizacao } from './linksAfiliados'

export type ProdutoCatalogo = {
  mercadoLivreId: string; titulo: string; preco: number; dataPreco: string
  categoria: CategoriaValio; linkAfiliado: string; imagem: string
  rating: number | null; ativo: boolean; updatedAt: string
}
export type FiltroVitrine = 'todos' | 'ativos' | 'inativos' | 'atualizados' | 'revisar-breve' | 'precisa-revisao' | 'revisar-catalogo'
export type OrdemVitrine = 'antigos' | 'recentes' | 'menor-preco' | 'maior-preco' | 'categoria'
export type IdadePreco = 'Atualizado' | 'Revisar em breve' | 'Precisa revisão'

export function classificarIdadePreco(data: string, hoje = new Date()): IdadePreco {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data)
  if (!partes) return 'Precisa revisão'
  const dia = Number(partes[1]); const mes = Number(partes[2]); const ano = Number(partes[3])
  const preco = new Date(ano, mes - 1, dia)
  if (preco.getFullYear() !== ano || preco.getMonth() + 1 !== mes || preco.getDate() !== dia) return 'Precisa revisão'
  const inicioPreco = Date.UTC(ano, mes - 1, dia)
  const inicioHoje = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const dias = Math.round((inicioHoje - inicioPreco) / 86_400_000)
  if (dias < 0) return 'Precisa revisão'
  return dias <= 7 ? 'Atualizado' : dias <= 15 ? 'Revisar em breve' : 'Precisa revisão'
}

export function compararComLote(produto: ProdutoCatalogo, extraido?: ProdutoAfiliado, categoria?: CategoriaValio) {
  if (!extraido) return { encontrado: false, precoAlterado: false, camposAlterados: [] as string[] }
  const precoAlterado = extraido.precoAtual !== null && Math.round(extraido.precoAtual * 100) !== Math.round(produto.preco * 100)
  const camposAlterados = [
    ...(extraido.titulo && extraido.titulo !== produto.titulo ? ['título'] : []),
    ...(extraido.imagemUrl && extraido.imagemUrl !== produto.imagem ? ['imagem'] : []),
    ...(extraido.linkOriginal && extraido.linkOriginal !== produto.linkAfiliado ? ['link'] : []),
    ...(categoria && categoria !== produto.categoria ? ['categoria'] : []),
  ]
  return { encontrado: true, precoAlterado, camposAlterados }
}

export function analisarCatalogo(produtos: ProdutoCatalogo[], lote: ProdutoAfiliado[] | null,
  categorias: ReadonlyMap<number, CategoriaValio>, hoje = new Date()) {
  const indices = new Map((lote ?? []).map((produto, indice) => [produto.itemId, indice]))
  return produtos.map((produto) => {
    const indice = indices.get(produto.mercadoLivreId)
    const comparacao = compararComLote(produto, indice === undefined ? undefined : lote![indice], indice === undefined ? undefined : categorias.get(indice))
    return { produto, idade: classificarIdadePreco(produto.dataPreco, hoje), ...comparacao }
  })
}

export type ItemAnalisado = ReturnType<typeof analisarCatalogo>[number]

export function resumirCatalogo(itens: ItemAnalisado[]) {
  return {
    ativos: itens.filter((item) => item.produto.ativo).length,
    inativos: itens.filter((item) => !item.produto.ativo).length,
    atualizados: itens.filter((item) => item.idade === 'Atualizado').length,
    precisamRevisao: itens.filter((item) => item.idade === 'Precisa revisão').length,
    precosAlterados: itens.filter((item) => item.precoAlterado).length,
  }
}

function prioridadeRevisao(item: ItemAnalisado) {
  if (item.idade === 'Precisa revisão') return 0
  if (item.precoAlterado) return 1
  if (!item.produto.ativo) return 2
  if (item.camposAlterados.length) return 3
  return 4
}

export function filtrarCatalogo(itens: ItemAnalisado[], filtro: FiltroVitrine, ordem: OrdemVitrine): ItemAnalisado[] {
  const filtrados = itens.filter((item) => {
    switch (filtro) {
      case 'ativos': return item.produto.ativo
      case 'inativos': return !item.produto.ativo
      case 'atualizados': return item.idade === 'Atualizado'
      case 'revisar-breve': return item.idade === 'Revisar em breve'
      case 'precisa-revisao': return item.idade === 'Precisa revisão'
      case 'revisar-catalogo': return prioridadeRevisao(item) < 4
      default: return true
    }
  })
  return filtrados.sort((a, b) => {
    if (filtro === 'revisar-catalogo') {
      const prioridade = prioridadeRevisao(a) - prioridadeRevisao(b)
      if (prioridade) return prioridade
    }
    switch (ordem) {
      case 'antigos': return compararDatas(a.produto.dataPreco, b.produto.dataPreco)
      case 'recentes': return compararDatas(b.produto.dataPreco, a.produto.dataPreco)
      case 'menor-preco': return a.produto.preco - b.produto.preco
      case 'maior-preco': return b.produto.preco - a.produto.preco
      case 'categoria': return a.produto.categoria.localeCompare(b.produto.categoria, 'pt-BR')
    }
  })
}

function compararDatas(a: string, b: string) {
  const chave = (data: string) => { const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data); return p ? `${p[3]}${p[2]}${p[1]}` : '' }
  return chave(a).localeCompare(chave(b))
}

async function requisitar(url: string, token: string, metodo: 'GET' | 'POST' | 'PATCH', corpo?: object, enviar: typeof fetch = fetch) {
  if (!token.trim()) throw new Error('Informe o token de publicação para acessar a vitrine.')
  let resposta: Response
  try { resposta = await enviar(url, { method: metodo, headers: {
    Authorization: `Bearer ${token.trim()}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}),
  }, ...(corpo ? { body: JSON.stringify(corpo) } : {}), cache: 'no-store' }) }
  catch { throw new Error('Não foi possível conectar à API da vitrine.') }
  let dados: unknown
  try { dados = await resposta.json() }
  catch { throw new Error(`A API respondeu HTTP ${resposta.status} sem JSON válido.`) }
  const resultado = dados && typeof dados === 'object' ? dados as Record<string, unknown> : {}
  if (!resposta.ok || resultado.ok !== true) throw new Error(typeof resultado.erro === 'string' ? resultado.erro : `A API respondeu HTTP ${resposta.status}.`)
  return resultado
}

export async function carregarCatalogo(token: string, enviar: typeof fetch = fetch): Promise<ProdutoCatalogo[]> {
  const resultado = await requisitar('/api/valio/catalogo', token, 'GET', undefined, enviar)
  if (!Array.isArray(resultado.produtos)) throw new Error('Resposta inválida do catálogo.')
  return resultado.produtos as ProdutoCatalogo[]
}

export async function alterarStatusProduto(id: string, ativo: boolean, token: string, enviar: typeof fetch = fetch) {
  await requisitar(`/api/valio/produtos/${encodeURIComponent(id)}/status`, token, 'PATCH', { ativo }, enviar)
}

export async function alterarCategoriaProduto(id: string, categoria: CategoriaValio, token: string, enviar: typeof fetch = fetch) {
  await requisitar(`/api/valio/produtos/${encodeURIComponent(id)}/categoria`, token, 'PATCH', { categoria }, enviar)
}

export type ResultadoLinkAfiliado = {
  produto: string; mercado_livre_id: string; link_anterior: string; link_afiliado: string
}

export async function atualizarLinkAfiliado(id: string, link: string, token: string, enviar: typeof fetch = fetch): Promise<ResultadoLinkAfiliado> {
  if (!/^MLB\d+$/.test(id)) throw new Error('Informe um ITEM_ID no formato MLB seguido de números.')
  if (!ehLinkOficialParaAtualizacao(link)) throw new Error('Informe um link oficial HTTPS meli.la ou /social/ com rastreamento.')
  const resultado = await requisitar('/api/valio/produtos/link-afiliado', token, 'PATCH',
    { mercado_livre_id: id, link_afiliado: link }, enviar)
  if (resultado.mercado_livre_id !== id || resultado.link_afiliado !== link
    || typeof resultado.produto !== 'string' || typeof resultado.link_anterior !== 'string') {
    throw new Error('A API não confirmou o link salvo para este produto.')
  }
  return resultado as ResultadoLinkAfiliado
}

export type LinhaPreviaLink = {
  linha: number; mercado_livre_id: string | null; link_novo: string | null
  titulo: string | null; link_anterior: string | null; motivo: string | null
}
export type PreviaLinksLote = { solicitadas: number; linhas: LinhaPreviaLink[] }
export type ResultadoLinksLote = {
  solicitadas: number; atualizadas: number; erros: number; idsAtualizados: string[]
  falhas: { linha: number; mercado_livre_id: string | null; motivo: string }[]
}

export async function preverLinksLote(texto: string, token: string, enviar: typeof fetch = fetch): Promise<PreviaLinksLote> {
  const resultado = await requisitar('/api/valio/produtos/links-afiliados/previa', token, 'POST', { texto }, enviar)
  if (!Number.isInteger(resultado.solicitadas) || !Array.isArray(resultado.linhas)
    || resultado.linhas.length !== resultado.solicitadas) throw new Error('Resposta inválida da prévia.')
  return resultado as PreviaLinksLote
}

export async function confirmarLinksLote(texto: string, previa: PreviaLinksLote, token: string,
  enviar: typeof fetch = fetch): Promise<ResultadoLinksLote> {
  const confirmacoes = previa.linhas.filter((item) => !item.motivo && item.mercado_livre_id && item.link_anterior)
    .map((item) => ({ linha: item.linha, mercado_livre_id: item.mercado_livre_id, link_anterior: item.link_anterior }))
  if (!confirmacoes.length) throw new Error('Nenhuma linha válida para confirmar.')
  const resultado = await requisitar('/api/valio/produtos/links-afiliados', token, 'PATCH',
    { texto, confirmacoes }, enviar)
  if (resultado.solicitadas !== previa.solicitadas || !Number.isInteger(resultado.atualizadas)
    || !Number.isInteger(resultado.erros) || !Array.isArray(resultado.idsAtualizados)
    || !Array.isArray(resultado.falhas)) throw new Error('Resposta inválida da atualização em lote.')
  return resultado as ResultadoLinksLote
}
