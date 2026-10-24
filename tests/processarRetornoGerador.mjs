import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
test.after(async () => vite.close())

const produtos = (...ids) => ids.map((itemId, indice) => ({ itemId, ordem: indice + 1, titulo: `Produto ${itemId}` }))
const lote = produtos('MLB111', 'MLB222', 'MLB333', 'MLB444', 'MLB555')
const tipos = (resultado) => resultado.pareamentos.map(({ retorno }) => retorno?.tipo ?? null)

test('cinco links válidos geram pareamento completo', () => {
  const resultado = processarRetornoGerador(lote, 'https://meli.la/a\nhttps://meli.la/b\nhttps://meli.la/c\nhttps://meli.la/d\nhttps://meli.la/e')
  assert.deepEqual(tipos(resultado), Array(5).fill('LINK'))
  assert.equal(resultado.linksValidos, 5)
  assert.equal(resultado.consistente, true)
})
test('recusado no meio ocupa uma posição', () => {
  assert.deepEqual(tipos(processarRetornoGerador(produtos('MLB1', 'MLB2', 'MLB3'), 'https://meli.la/a\n⚠️ Este produto não cumpre com os requisitos do Programa.\nhttps://meli.la/c')), ['LINK', 'RECUSADO', 'LINK'])
})
test('pausado no meio ocupa uma posição', () => {
  assert.deepEqual(tipos(processarRetornoGerador(produtos('MLB1', 'MLB2', 'MLB3'), 'https://meli.la/a\n⚠️ Este URL corresponde a um produto pausado.\nhttps://meli.la/c')), ['LINK', 'PAUSADO', 'LINK'])
})
test('recusado na primeira posição', () => {
  assert.deepEqual(tipos(processarRetornoGerador(produtos('MLB1', 'MLB2'), 'Este produto não cumpre com os requisitos do Programa.\nhttps://meli.la/b')), ['RECUSADO', 'LINK'])
})
test('pausado na última posição', () => {
  assert.deepEqual(tipos(processarRetornoGerador(produtos('MLB1', 'MLB2'), 'https://meli.la/a\nEste URL corresponde a um produto pausado.')), ['LINK', 'PAUSADO'])
})
test('aviso de campo vazio não ocupa posição', () => {
  const resultado = processarRetornoGerador(produtos('MLB1'), '⚠️ O campo está vazio. Insira o URL que você quer divulgar.\nhttps://meli.la/a')
  assert.equal(resultado.totalResultados, 1)
  assert.equal(resultado.pareamentos[0].retorno.link, 'https://meli.la/a')
})
test('preserva a ordem original dos produtos', () => {
  const resultado = processarRetornoGerador(produtos('MLB333', 'MLB111', 'MLB222'), 'https://meli.la/a\nhttps://meli.la/b\nhttps://meli.la/c')
  assert.deepEqual(resultado.pareamentos.map(({ produto }) => produto.itemId), ['MLB333', 'MLB111', 'MLB222'])
})
test('menos resultados mostra posição faltante e bloqueia bloco', () => {
  const resultado = processarRetornoGerador(produtos('MLB1', 'MLB2'), 'https://meli.la/a')
  assert.equal(resultado.errosQuantidade, 1)
  assert.equal(resultado.pareamentos[1].retorno, null)
  assert.equal(resultado.pareamentos[1].situacao, 'REVISAR')
  assert.equal(resultado.blocoAtualizador, '')
})
test('resultados excedentes são expostos e bloqueiam bloco', () => {
  const resultado = processarRetornoGerador(produtos('MLB1'), 'https://meli.la/a\nhttps://meli.la/b')
  assert.equal(resultado.errosQuantidade, 1)
  assert.equal(resultado.excedentes[0].link, 'https://meli.la/b')
  assert.equal(resultado.blocoAtualizador, '')
})
test('mensagem desconhecida vira REVISAR com texto original', () => {
  const resultado = processarRetornoGerador(produtos('MLB1'), '⚠️ Mensagem inesperada')
  assert.equal(resultado.pareamentos[0].retorno.tipo, 'REVISAR')
  assert.equal(resultado.pareamentos[0].retorno.original, '⚠️ Mensagem inesperada')
  assert.equal(resultado.blocoAtualizador, '')
})
test('linhas vazias são ignoradas', () => {
  assert.equal(processarRetornoGerador(produtos('MLB1'), '\n\nhttps://meli.la/a\n\n').totalResultados, 1)
})
test('espaços extras não alteram o resultado', () => {
  assert.equal(processarRetornoGerador(produtos('MLB1'), '  https://meli.la/a  ').blocoAtualizador, 'MLB1 | https://meli.la/a')
})
test('lote misto mantém links, recusados e pausados nas posições', () => {
  const resultado = processarRetornoGerador(lote, 'https://meli.la/a\nEste produto não cumpre com os requisitos do Programa.\nhttps://meli.la/c\nEste URL corresponde a um produto pausado.\nhttps://meli.la/e')
  assert.deepEqual(tipos(resultado), ['LINK', 'RECUSADO', 'LINK', 'PAUSADO', 'LINK'])
  assert.deepEqual(resultado.pareamentos.map(({ situacao }) => situacao), ['PRONTO', 'NÃO PUBLICAR', 'PRONTO', 'NÃO PUBLICAR', 'PRONTO'])
})
test('bloco ITEM_ID | meli.la inclui somente links válidos', () => {
  const resultado = processarRetornoGerador(produtos('MLB1', 'MLB2', 'MLB3'), 'https://meli.la/a\nEste produto não cumpre com os requisitos do Programa.\nhttps://meli.la/c')
  assert.equal(resultado.blocoAtualizador, 'MLB1 | https://meli.la/a\nMLB3 | https://meli.la/c')
})
test('lote inconsistente impede bloco final mesmo com links válidos', () => {
  const resultado = processarRetornoGerador(lote, 'https://meli.la/a\nhttps://meli.la/b')
  assert.equal(resultado.consistente, false)
  assert.equal(resultado.blocoAtualizador, '')
})
test('lote real de cinco produtos gera o bloco esperado', () => {
  const resultado = processarRetornoGerador(produtos('MLB5735296442', 'MLB2147851885', 'MLB4208012055', 'MLB6797156948', 'MLB3902982959'),
    'https://meli.la/1awFBvU\nhttps://meli.la/24nHxaZ\nhttps://meli.la/2rU1UqJ\nhttps://meli.la/2VXGnoM\nhttps://meli.la/1cRtVTR')
  assert.equal(resultado.blocoAtualizador, 'MLB5735296442 | https://meli.la/1awFBvU\nMLB2147851885 | https://meli.la/24nHxaZ\nMLB4208012055 | https://meli.la/2rU1UqJ\nMLB6797156948 | https://meli.la/2VXGnoM\nMLB3902982959 | https://meli.la/1cRtVTR')
})

test('recusa normal, mojibake e texto desconhecido', () => {
  const normal = processarRetornoGerador(produtos('MLB1'), '⚠️ Este produto não cumpre com os requisitos do Programa.')
  const mojibake = processarRetornoGerador(produtos('MLB1'), 'âš ï¸ Este produto nÃ£o cumpre com os requisitos do Programa.')
  const desconhecida = processarRetornoGerador(produtos('MLB1'), 'Mensagem desconhecida')
  assert.equal(normal.pareamentos[0].retorno.tipo, 'RECUSADO')
  assert.equal(mojibake.pareamentos[0].retorno.tipo, 'RECUSADO')
  assert.equal(desconhecida.pareamentos[0].retorno.tipo, 'REVISAR')
})

test('caso real de 30 produtos: 29 links e recusa mantêm as posições', () => {
  const lote30 = produtos(...Array.from({ length: 30 }, (_, indice) => `MLB${indice + 1}`))
  const linhas = Array.from({ length: 30 }, (_, indice) => indice === 14
    ? 'âš ï¸ Este produto nÃ£o cumpre com os requisitos do Programa.'
    : `https://meli.la/link-${indice + 1}`)
  const resultado = processarRetornoGerador(lote30, linhas.join('\n'))
  assert.equal(resultado.totalProdutos, 30)
  assert.equal(resultado.totalResultados, 30)
  assert.equal(resultado.linksValidos, 29)
  assert.equal(resultado.recusados, 1)
  assert.equal(resultado.revisar, 0)
  assert.equal(resultado.consistente, true)
  assert.equal(resultado.pareamentos[13].retorno.link, 'https://meli.la/link-14')
  assert.equal(resultado.pareamentos[14].produto.itemId, 'MLB15')
  assert.equal(resultado.pareamentos[14].retorno.tipo, 'RECUSADO')
  assert.equal(resultado.pareamentos[14].retorno.link, null)
  assert.equal(resultado.pareamentos[15].produto.itemId, 'MLB16')
  assert.equal(resultado.pareamentos[15].retorno.link, 'https://meli.la/link-16')
  assert.equal(resultado.pareamentos[29].retorno.link, 'https://meli.la/link-30')
})