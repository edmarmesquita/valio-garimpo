import type { ProdutoAfiliado } from './extrairProdutosAfiliados'
import { gerarProdutosValio, problemasExportacao } from './produtosGarimpados'
import type { CategoriaValio, ProdutoValio } from './produtosGarimpados'

export type FalhaEnvio = { id: string; titulo: string; motivo: string }
export type ResumoEnvio = { enviados: number; criados: number; atualizados: number; erros: FalhaEnvio[] }

export function problemasPublicacao(produto: ProdutoAfiliado, categoria?: CategoriaValio): string[] {
  return [...problemasExportacao(produto, categoria), ...(!produto.imagemUrl?.trim() ? ['imagem'] : [])]
}

export function selecionadosPublicaveis(produtos: ProdutoAfiliado[], selecionados: ReadonlySet<number>, categorias: ReadonlyMap<number, CategoriaValio>): boolean {
  return selecionados.size > 0 && [...selecionados].every((indice) =>
    produtos[indice] && problemasPublicacao(produtos[indice], categorias.get(indice)).length === 0)
}

export function montarPayloadPublicacao(produto: ProdutoValio, somenteCriar = false) {
  const dto = {
    mercadoLivreId: produto.id,
    titulo: produto.title,
    descricao: produto.description,
    preco: produto.price,
    dataPreco: produto.priceReferenceDate,
    linkAfiliado: produto.link,
    categoria: produto.category,
    ...(produto.rating === undefined ? {} : { rating: produto.rating }),
    imagem: produto.image,
  }
  return somenteCriar ? { ...dto, somenteCriar: true } : dto
}

export async function enviarSelecionadosValio(
  produtos: ProdutoAfiliado[], selecionados: ReadonlySet<number>,
  categorias: ReadonlyMap<number, CategoriaValio>, token: string,
  enviar: typeof fetch = fetch,
  opcoes: { somenteCriar?: boolean } = {},
): Promise<ResumoEnvio> {
  if (!token.trim()) throw new Error('Informe o token de publicação.')
  if (!selecionadosPublicaveis(produtos, selecionados, categorias)) {
    const problemas = [...selecionados].flatMap((indice) => {
      const produto = produtos[indice]
      return produto ? problemasPublicacao(produto, categorias.get(indice)) : ['produto não encontrado']
    })
    throw new Error(selecionados.size ? `Revise os selecionados: ${[...new Set(problemas)].join(', ')}.` : 'Selecione ao menos um produto.')
  }
  const convertidos = gerarProdutosValio(produtos, selecionados, categorias)
  const resumo: ResumoEnvio = { enviados: 0, criados: 0, atualizados: 0, erros: [] }
  for (const produto of convertidos) {
    try {
      let resposta: Response
      try { resposta = await enviar('/api/valio/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify(montarPayloadPublicacao(produto, opcoes.somenteCriar === true)),
        cache: 'no-store',
      }) }
      catch { throw new Error('Não foi possível conectar à API local. Verifique se o servidor está rodando na porta 3001 e se o proxy do Vite está ativo.') }
      let dados: unknown
      try { dados = await resposta.json() }
      catch { throw new Error(`A API respondeu com HTTP ${resposta.status}, mas não retornou JSON válido. Verifique o servidor local e o proxy do Vite.`) }
      const resultado = dados && typeof dados === 'object' ? dados as Record<string, unknown> : {}
      if (!resposta.ok && opcoes.somenteCriar && resultado.erro === 'O produto contém campos não permitidos.') {
        throw new Error('A API de publicação rejeitou o payload com somenteCriar. Verifique se o backend está atualizado; este produto foi rejeitado.')
      }
      if (!resposta.ok || resultado.ok !== true || (resultado.acao !== 'criado' && resultado.acao !== 'atualizado')) {
        throw new Error(typeof resultado.erro === 'string' ? resultado.erro : `A API respondeu com HTTP ${resposta.status} sem confirmar o envio.`)
      }
      resumo.enviados++
      if (resultado.acao === 'criado') resumo.criados++
      else resumo.atualizados++
    } catch (erro) {
      resumo.erros.push({ id: produto.id, titulo: produto.title,
        motivo: erro instanceof Error ? erro.message : 'Falha de conexão.' })
    }
  }
  return resumo
}
