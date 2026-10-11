import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alternarSelecao, converterParaProdutoValio, filtrarEOrdenarProdutos,
  gerarProdutosValio, selecionarTodos,
} from '../src/lib/produtosGarimpados.ts'

const produto = (alteracoes = {}) => ({
  itemId: 'MLB1', titulo: 'Produto um', precoAtual: 169.99, linkOriginal: 'https://www.mercadolivre.com.br/x?extra_comm=true&tag=a%2Fb#sid=affiliates',
  imagemUrl: 'https://imagem.example/1.webp', avaliacao: 4.9, comissaoPercentual: 20,
  extraCommission: true, desconto: '24% OFF', ...alteracoes,
})
const categoria = 'Achados para Elas'
const filtros = { somenteComPreco: false, somenteComissaoExtra: false, comissaoMinima: null, avaliacaoMinima: null }

test('seleção individual, todos e desmarcar sem mudar o conjunto anterior', () => {
  const todos = selecionarTodos(3)
  const dois = alternarSelecao(todos, 1)
  assert.deepEqual([...todos], [0, 1, 2])
  assert.deepEqual([...dois], [0, 2])
  assert.deepEqual([...alternarSelecao(dois, 1)], [0, 2, 1])
  assert.deepEqual([...new Set()], [])
})

test('conversão preserva link afiliado e usa data local no momento da exportação', () => {
  const origem = produto()
  const convertido = converterParaProdutoValio(origem, categoria, new Date(2026, 9, 10))
  assert.deepEqual(convertido, {
    id: 'MLB1', title: 'Produto um', description: '', price: 169.99,
    priceReferenceDate: '10/10/2026', link: origem.linkOriginal, category: categoria,
    rating: 4.9, image: origem.imagemUrl,
  })
})

test('categoria, preço, link, ID e título são obrigatórios para exportar', () => {
  const produtos = [produto(), produto({ itemId: 'MLB2', precoAtual: null })]
  assert.throws(() => gerarProdutosValio(produtos, new Set([0]), new Map()), /categoria/)
  assert.throws(() => gerarProdutosValio(produtos, new Set([1]), new Map([[1, categoria]])), /preço/)
  assert.throws(() => converterParaProdutoValio(produto({ linkOriginal: null }), categoria), /link original/)
  assert.throws(() => converterParaProdutoValio(produto({ itemId: null, titulo: null }), categoria), /ITEM_ID, título/)
  assert.throws(() => gerarProdutosValio(produtos, new Set(), new Map()), /Selecione/)
})

test('múltiplos produtos seguem a ordem original e campos opcionais ausentes não viram null', () => {
  const produtos = [produto({ avaliacao: null, imagemUrl: null }), produto({ itemId: 'MLB2', titulo: 'Produto dois', precoAtual: 42 })]
  const resultado = gerarProdutosValio(produtos, new Set([1, 0]), new Map([[0, categoria], [1, 'Achados para Casa']]), new Date(2026, 0, 2))
  assert.deepEqual(resultado.map((p) => p.id), ['MLB1', 'MLB2'])
  assert.equal(resultado[0].priceReferenceDate, '02/01/2026')
  assert.equal('rating' in resultado[0], false)
  assert.equal(resultado[0].image, '')
})

test('ordena comissão, filtra comissão extra e não altera entrada', () => {
  const produtos = [produto({ comissaoPercentual: 5, extraCommission: false }), produto({ itemId: 'MLB2', comissaoPercentual: 20 }), produto({ itemId: 'MLB3', comissaoPercentual: null, extraCommission: false })]
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, filtros, 'comissao'), [1, 0, 2])
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, { ...filtros, somenteComissaoExtra: true }, 'original'), [1])
  assert.deepEqual(produtos.map((p) => p.itemId), ['MLB1', 'MLB2', 'MLB3'])
})

test('filtros numéricos e ordenações de preço, desconto e avaliação lidam com ausentes', () => {
  const produtos = [produto({ precoAtual: null, desconto: null, avaliacao: null, comissaoPercentual: null }), produto({ itemId: 'MLB2', precoAtual: 100, desconto: '10% OFF', avaliacao: 4 }), produto({ itemId: 'MLB3', precoAtual: 50, desconto: '30% OFF', avaliacao: 5 })]
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, { ...filtros, somenteComPreco: true, comissaoMinima: 20, avaliacaoMinima: 4.5 }, 'original'), [2])
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, filtros, 'menor-preco'), [2, 1, 0])
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, filtros, 'maior-preco'), [1, 2, 0])
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, filtros, 'desconto'), [2, 1, 0])
  assert.deepEqual(filtrarEOrdenarProdutos(produtos, filtros, 'avaliacao'), [2, 1, 0])
})
