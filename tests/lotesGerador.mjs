import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { dividirProdutosEmLotes } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/extrairListaAfiliados.ts')
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
test.after(async () => vite.close())

const produto = (n) => ({ itemId: `MLB${n}`, ordem: n, titulo: `Produto ${n}`, userProductId: null, productId: null,
  pid: null, pidExtended: null, urlOriginal: `https://www.mercadolivre.com.br/MLB${n}`, urlParams: null,
  urlFragments: null, urlNormalizada: `https://www.mercadolivre.com.br/MLB${n}` })

for (const [quantidade, esperado] of [[1, [1]], [30, [30]], [31, [30, 1]], [32, [30, 2]], [60, [30, 30]], [61, [30, 30, 1]], [77, [30, 30, 17]]]) {
  test(`${quantidade} produtos gera lotes ${esperado.join(' + ')}`, () => {
    const lotes = dividirProdutosEmLotes(Array.from({ length: quantidade }, (_, indice) => produto(indice + 1)))
    assert.deepEqual(lotes.map((lote) => lote.length), esperado)
    assert.deepEqual(lotes.flat().map((item) => item.itemId), Array.from({ length: quantidade }, (_, indice) => `MLB${indice + 1}`))
  })
}

test('cada lote preserva a ordem posicional independentemente', () => {
  const lotes = dividirProdutosEmLotes(Array.from({ length: 32 }, (_, indice) => produto(indice + 1)))
  assert.deepEqual(lotes[0].map((item) => item.ordem), Array.from({ length: 30 }, (_, indice) => indice + 1))
  assert.deepEqual(lotes[1].map((item) => item.ordem), [31, 32])
})

test('retornos são validados por lote e aviso ocupa sua própria posição', () => {
  const lotes = dividirProdutosEmLotes(Array.from({ length: 32 }, (_, indice) => produto(indice + 1)))
  const primeiro = processarRetornoGerador(lotes[0], Array.from({ length: 30 }, (_, indice) => indice === 4
    ? 'Este produto não cumpre com os requisitos do Programa.' : `https://meli.la/lote1-${indice}`).join('\n'))
  const segundo = processarRetornoGerador(lotes[1], 'https://meli.la/lote2-0\nhttps://meli.la/lote2-1')
  assert.equal(primeiro.consistente, true)
  assert.equal(primeiro.pareamentos[4].retorno?.tipo, 'RECUSADO')
  assert.equal(segundo.consistente, true)
  assert.deepEqual(segundo.pareamentos.map((item) => item.produto.itemId), ['MLB31', 'MLB32'])
  const inconsistente = processarRetornoGerador(lotes[1], 'https://meli.la/apenas-um')
  assert.equal(inconsistente.consistente, false)
  assert.equal(primeiro.consistente, true)
})

test('lote vazio não cria entradas e tamanho inválido é recusado', () => {
  assert.deepEqual(dividirProdutosEmLotes([]), [])
  assert.throws(() => dividirProdutosEmLotes([produto(1)], 0), /inteiro positivo/)
})

test('lote pendente de 2 itens nÃ£o contamina o primeiro lote de 30', () => {
  const lotes = dividirProdutosEmLotes(Array.from({ length: 32 }, (_, indice) => produto(indice + 1)))
  const texto = Array.from({ length: 30 }, (_, indice) => indice === 14
    ? 'Este produto nÃ£o cumpre com os requisitos do Programa.' : `https://meli.la/lote1-${indice + 1}`).join('\n')
  const primeiro = processarRetornoGerador(lotes[0], texto)
  const segundo = null // lote sem retorno permanece pendente e nÃ£o Ã© enviado ao parser
  assert.equal(primeiro.totalProdutos, 30)
  assert.equal(primeiro.linksValidos, 29)
  assert.equal(primeiro.recusados, 1)
  assert.equal(primeiro.revisar, 0)
  assert.equal(primeiro.errosQuantidade, 0)
  assert.equal(primeiro.consistente, true)
  assert.equal(segundo, null)
  assert.equal(lotes[1].length, 2)
})

for (const [quantidade, esperado] of [[42, [30, 12]], [77, [30, 30, 17]]]) {
  test(`lotes pendentes nÃ£o afetam lote processado em ${quantidade} produtos`, () => {
    const lotes = dividirProdutosEmLotes(Array.from({ length: quantidade }, (_, indice) => produto(indice + 1)))
    const processado = processarRetornoGerador(lotes[0], lotes[0].map((_, indice) => `https://meli.la/ok-${indice}`).join('\n'))
    assert.deepEqual(lotes.map((lote) => lote.length), esperado)
    assert.equal(processado.totalProdutos, 30)
    assert.equal(processado.consistente, true)
    assert.equal(processado.errosQuantidade, 0)
  })
}
