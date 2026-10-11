import type { ProdutoAfiliado } from './extrairProdutosAfiliados'
import type { CategoriaValio } from './produtosGarimpados'

export type ProdutoExistente = {
  mercadoLivreId: string
  titulo: string
  preco: number
  dataPreco: string
  categoria: CategoriaValio
  linkAfiliado: string
  imagem: string
  ativo: boolean
}

export function idsParaVerificar(produtos: ProdutoAfiliado[]): string[] {
  return [...new Set(produtos.map((produto) => produto.itemId?.trim() ?? '').filter((id) => /^MLB\d+$/.test(id)))]
}

export async function verificarProdutosValio(produtos: ProdutoAfiliado[], token: string, enviar: typeof fetch = fetch): Promise<Map<string, ProdutoExistente>> {
  const ids = idsParaVerificar(produtos)
  if (!ids.length) return new Map()
  if (!token.trim()) throw new Error('Informe o token para verificar os produtos.')
  let resposta: Response
  try {
    resposta = await enviar('/api/valio/produtos/verificar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
      body: JSON.stringify({ mercadoLivreIds: ids }), cache: 'no-store',
    })
  } catch { throw new Error('Não foi possível conectar à API local para verificar os produtos.') }
  let dados: unknown
  try { dados = await resposta.json() }
  catch { throw new Error(`A verificação respondeu HTTP ${resposta.status} sem JSON válido.`) }
  if (!dados || typeof dados !== 'object') throw new Error('Resposta inválida da verificação.')
  const resultado = dados as { ok?: unknown; existentes?: unknown; erro?: unknown }
  if (!resposta.ok) throw new Error(typeof resultado.erro === 'string' ? resultado.erro : `Verificação falhou com HTTP ${resposta.status}.`)
  if (resultado.ok !== true || !Array.isArray(resultado.existentes)) throw new Error('Resposta inválida da verificação.')
  return new Map(resultado.existentes.map((produto: ProdutoExistente) => [produto.mercadoLivreId, produto]))
}

export function compararProdutoComValio(produto: ProdutoAfiliado, categoria: CategoriaValio | undefined, existente: ProdutoExistente | undefined) {
  if (!existente) return { existe: false, precoAlterado: false, dadosAlterados: false }
  const precoAlterado = produto.precoAtual !== null && Math.round(produto.precoAtual * 100) !== Math.round(existente.preco * 100)
  const dadosAlterados = precoAlterado || produto.titulo !== existente.titulo || produto.imagemUrl !== existente.imagem
    || categoria !== existente.categoria || produto.linkOriginal !== existente.linkAfiliado
  return { existe: true, precoAlterado, dadosAlterados }
}

export function separarSelecionados(produtos: ProdutoAfiliado[], selecionados: ReadonlySet<number>, existentes: ReadonlyMap<string, ProdutoExistente>) {
  const novos = new Set<number>()
  const cadastrados = new Set<number>()
  for (const indice of selecionados) {
    const id = produtos[indice]?.itemId?.trim()
    if (!id || !/^MLB\d+$/.test(id)) continue
    if (existentes.has(id)) cadastrados.add(indice)
    else novos.add(indice)
  }
  return { novos, cadastrados }
}
