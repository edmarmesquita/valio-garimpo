import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { analisarHar } = await vite.ssrLoadModule('/src/lib/harAfiliadosParser.ts')
const { compararHarCatalogo } = await vite.ssrLoadModule('/src/lib/compararHarCatalogo.ts')
const { candidatoSeguroHar, motivosBloqueioHar, selecionarCandidatosHar, gerarPreviaHar } = await vite.ssrLoadModule('/src/lib/previaHar.ts')
const linha = (cards = [cardHar()], salvo = catalogoHar()) => compararHarCatalogo(analisarHar(arquivoHar(entradaHar(cards)), 'sintetico.har'), [salvo]).encontrados[0]
test('NORMAL alterado é selecionável', () => assert.equal(candidatoSeguroHar(linha()), true))
test('DESCONTO alterado é selecionável', () => assert.equal(candidatoSeguroHar(linha([cardHar('MLB123', 90, { label: '10% OFF' })])), true))
test('preço igual não é selecionável', () => assert.equal(candidatoSeguroHar(linha([cardHar('MLB123', 100)])), false))
for (const [label, motivo] of [['10% OFF no Pix', 'PIX'], ['10% OFF com Cupom', 'CUPOM'],
  ['10% OFF com Saldo no Mercado Pago', 'OUTRO/REVISAR'], ['41% OFF no Pix com Cupom', 'CONDIÇÃO COMBINADA (PIX + CUPOM)']]) {
  test(`${label} bloqueado`, () => {
    const p = linha([cardHar('MLB123', 90, { label })])
    assert.equal(candidatoSeguroHar(p), false); assert.ok(motivosBloqueioHar(p).includes(motivo))
    assert.throws(() => gerarPreviaHar([p], ['MLB123'], 'csv'), /Seleção inválida/)
  })
}
test('conflito HAR bloqueado', () => assert.equal(candidatoSeguroHar(linha([cardHar(), cardHar('MLB123', 80)])), false))
test('oferta ativa ou agendada bloqueada', () => {
  assert.equal(candidatoSeguroHar(linha([cardHar()], catalogoHar('MLB123', { ofertaRelampago: true }))), false)
  assert.equal(candidatoSeguroHar(linha([cardHar()], catalogoHar('MLB123', { ofertaRelampago: true, ofertaInicio: '2099-01-01' }))), false)
})
test('preço HAR ou salvo inválido bloqueado', () => {
  assert.equal(candidatoSeguroHar(linha([cardHar('MLB123', 0)])), false)
  assert.equal(candidatoSeguroHar(linha([cardHar()], catalogoHar('MLB123', { preco: NaN }))), false)
})
test('moeda inválida bloqueada', () => assert.equal(candidatoSeguroHar(linha([cardHar('MLB123', 90, { moeda: 'USD' })])), false))
test('selecionar todos pega somente candidatos seguros independentemente da classificação bloqueada', () => {
  const seguro = linha()
  assert.deepEqual(selecionarCandidatosHar([seguro, linha([cardHar('MLB123', 100)]), linha([cardHar('MLB123', 90, { label: 'Pix' })])]), ['MLB123'])
})
test('prévia contém somente selecionados e preserva preço-base e origem sem referência ao catálogo', () => {
  const a = linha()
  const b = linha([cardHar('MLB999', 150)], catalogoHar('MLB999'))
  const p = gerarPreviaHar([a, b], ['MLB123'], 'csv')
  a.produto.preco = 75; a.har.capturas[0].arquivoOrigem = 'outro.har'
  assert.equal(p.itens.length, 1); assert.equal(p.itens[0].precoBase, 100); assert.equal(p.itens[0].novoPreco, 90)
  assert.deepEqual(p.itens[0].arquivosOrigem, ['sintetico.har']); assert.ok(Object.isFrozen(p.itens[0]))
  assert.equal(p.fonte, 'csv'); assert.throws(() => gerarPreviaHar([a, b], ['MLB404'], 'csv'))
  assert.throws(() => gerarPreviaHar([a], [], 'csv'))
})
test('resumo mantém sinal da média, maior aumento e maior redução', () => {
  const p = gerarPreviaHar([linha(), linha([cardHar('MLB999', 120)], catalogoHar('MLB999'))], ['MLB123', 'MLB999'], 'api')
  assert.deepEqual(p.resumo, { selecionados: 2, aumentos: 1, reducoes: 1, mediaPercentual: 5, maiorAumentoPercentual: 20, maiorReducaoPercentual: -10 })
})
test('inativo, ITEM_ID divergente ou catálogo duplicado não habilita seleção', () => {
  const p = linha(); p.produto.ativo = false; assert.equal(candidatoSeguroHar(p), false)
  p.produto.ativo = true; p.produto.mercadoLivreId = 'MLB404'; assert.equal(candidatoSeguroHar(p), false)
  const dup = compararHarCatalogo(analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har'), [catalogoHar(), catalogoHar()])
  assert.deepEqual(selecionarCandidatosHar(dup.encontrados), [])
})
test('geração local da prévia não envia preços; escrita fica em etapa separada', async () => {
  for (const arquivo of ['src/lib/previaHar.ts', 'src/pages/RevisaoHarAfiliados.tsx']) {
    const codigo = await readFile(arquivo, 'utf8')
    assert.doesNotMatch(codigo, /\bfetch\s*\(|\.update\s*\(|\.post\s*\(|\.insert\s*\(|precos-lote|confirmar.*preco/i)
  }
})
