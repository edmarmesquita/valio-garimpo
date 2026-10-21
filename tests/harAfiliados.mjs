import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import { cardHar, entradaHar, arquivoHar, catalogoHar } from './fixtures/harAfiliados.mjs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { analisarHar, combinarHars } = await vite.ssrLoadModule('/src/lib/harAfiliadosParser.ts')
const { compararHarCatalogo, filtrarComparacaoHar } = await vite.ssrLoadModule('/src/lib/compararHarCatalogo.ts')
const { classificarPrecoAfiliado } = await vite.ssrLoadModule('/src/lib/classificarPrecoAfiliado.ts')
const analisar = (...cards) => analisarHar(arquivoHar(entradaHar(cards)), 'sintetico.har')

test('extrai somente campos de produto, título por type e preço por id; preço anterior opcional', () => {
  const r = analisar(cardHar('MLB123', 90, { anterior: 120 }))
  const p = r.produtos[0]
  assert.equal(p.itemId, 'MLB123'); assert.equal(p.precoAtual, 90); assert.equal(p.valido, true)
  assert.equal(p.capturas[0].precoAnterior, 120)
  assert.equal(p.capturas[0].productId, 'MLB456')
  assert.equal(p.capturas[0].userProductId, 'MLBU789')
  assert.equal(p.capturas[0].extraCommission, true)
  assert.equal(p.capturas[0].brandCommission, false)
  assert.equal(analisar(cardHar()).produtos[0].capturas[0].precoAnterior, null)
})
for (const [label, tipo] of [['38% OFF', 'DESCONTO'], ['8% OFF no Pix', 'PIX'], ['56% OFF com Cupom', 'CUPOM'],
  ['26% OFF com Saldo no Mercado Pago', 'OUTRO_REVISAR'], ['Condição especial', 'OUTRO_REVISAR'],
  ['Pix com Cupom', 'OUTRO_REVISAR'], ['', 'NORMAL']]) {
  test(`classificação conservadora: ${label || 'sem condição'}`, () => assert.equal(classificarPrecoAfiliado(label, 90, null), tipo))
}
test('preço anterior superior permite desconto; condições explícitas prevalecem', () => {
  assert.equal(classificarPrecoAfiliado(null, 90, 100), 'DESCONTO')
  assert.equal(classificarPrecoAfiliado('8% OFF no Pix', 90, 100), 'PIX')
})
test('ignora ITEM_ID inválido, sem usar product_id ou título como fallback', () => {
  const r = analisar(cardHar('MLBU123'), cardHar(''), cardHar('MLB-123'))
  assert.equal(r.semItemId, 3); assert.equal(r.produtos.length, 0)
})
test('preços inválidos ficam bloqueados, nunca convertidos ou inventados', () => {
  for (const v of [0, -1, null, '90', Number.MAX_VALUE]) {
    const r = analisar(cardHar('MLB123', v))
    assert.equal(r.precosInvalidos, 1); assert.equal(r.produtos[0].precoAtual, null)
    assert.equal(compararHarCatalogo(r, [catalogoHar()]).encontrados[0].status, 'PRECO_INVALIDO')
  }
})
test('moeda diferente de BRL bloqueia comparação', () => {
  const r = analisar(cardHar('MLB123', 90, { moeda: 'USD' }))
  assert.equal(r.produtos[0].valido, false)
  const p = compararHarCatalogo(r, [catalogoHar()]).encontrados[0]
  assert.equal(p.status, 'MOEDA_INVALIDA'); assert.equal(p.diferenca, null)
})
test('deduplica ITEM_ID e preço igual e combina arquivos na mesma sessão', () => {
  const a = analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har')
  const b = analisarHar(arquivoHar(entradaHar([cardHar(), cardHar('MLB999', 40)])), 'b.json')
  const r = combinarHars([a, b])
  assert.deepEqual(r.arquivos, ['a.har', 'b.json']); assert.equal(r.produtos.length, 2)
  assert.equal(r.duplicados, 1); assert.equal(r.ocorrencias, 3)
  assert.equal(r.produtos[0].conflito, null)
})
test('preços diferentes entre capturas e no mesmo arquivo são conflito sem escolha silenciosa', () => {
  const r = combinarHars([analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har'),
    analisarHar(arquivoHar(entradaHar([cardHar('MLB123', 95)])), 'b.har')])
  assert.equal(r.produtos[0].precoAtual, null); assert.equal(r.produtos[0].valido, false)
  assert.deepEqual(r.produtos[0].conflito.precos, [90, 95])
  assert.deepEqual(r.produtos[0].conflito.arquivos, ['a.har', 'b.har'])
  const c = compararHarCatalogo(r, [catalogoHar()]).encontrados[0]
  assert.equal(c.status, 'CONFLITO_HAR'); assert.equal(c.diferenca, null)
  assert.ok(analisar(cardHar(), cardHar('MLB123', 80)).produtos[0].conflito)
})
test('mesmo preço com condição diferente requer revisão', () => {
  const r = analisar(cardHar(), cardHar('MLB123', 90, { label: '10% OFF no Pix' }))
  assert.equal(r.produtos[0].classificacao, 'OUTRO_REVISAR')
  assert.equal(compararHarCatalogo(r, [catalogoHar()]).encontrados[0].status, 'OUTRO_REVISAR')
})
test('não mascara captura inválida ao combinar com válida', () => {
  assert.equal(analisar(cardHar(), cardHar('MLB123', null)).produtos[0].valido, false)
})
test('filtra endpoint exato, is_affiliate=true, origem oficial e HTTP 200; aceita dispositivos diferentes', () => {
  const url = 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search'
  const entries = [entradaHar(), entradaHar([cardHar()], { url: url + '?is_affiliate=true&device=web-mobile' }),
    entradaHar([cardHar()], { url: url + '?is_affiliate=false' }), entradaHar([cardHar()], { url }),
    entradaHar([cardHar()], { url: url + '/outro?is_affiliate=true' }),
    entradaHar([cardHar()], { url: 'https://outro.example/affiliate-program/api/hub/search?is_affiliate=true' }),
    entradaHar([cardHar()], { status: 403 })]
  const r = analisarHar(arquivoHar(...entries), 'f.har')
  assert.equal(r.chamadasSearch, 2); assert.equal(r.ocorrencias, 2)
})
test('corpo base64 UTF-8, corpo ausente, truncado, estrutura inválida e HAR inválido', () => {
  const body = JSON.stringify({ polycard_client_model: { polycards: [cardHar('MLB123', 90, { titulo: 'Açúcar' })] } })
  const r = analisarHar(arquivoHar(entradaHar([], { content: { text: Buffer.from(body).toString('base64'), encoding: 'base64' } }),
    entradaHar([], { content: { text: '' } }), entradaHar([], { content: { text: '{' } }),
    entradaHar([], { content: { text: '{}' } })), 'f.har')
  assert.equal(r.produtos[0].capturas[0].titulo, 'Açúcar')
  assert.equal(r.semCorpo, 1); assert.equal(r.respostasInvalidas, 2)
  assert.throws(() => analisarHar('{segredo', 'f.har'), /Arquivo inválido/)
  assert.throws(() => analisarHar('{}', 'f.har'), /log.entries/)
})
test('nunca casa pelo título ou product_id e exclui inativos', () => {
  const r = analisar(cardHar('MLB123', 90, { titulo: 'Mesmo título' }))
  const c = compararHarCatalogo(r, [catalogoHar('MLB999', { titulo: 'Mesmo título' }), catalogoHar('MLB456'), catalogoHar('MLB123', { ativo: false })])
  assert.equal(c.encontrados.length, 0); assert.equal(c.naoEncontrados.length, 2)
})
test('diferença em centavos e percentual; protege preços inválidos e catálogo ambíguo', () => {
  const r = analisar(cardHar('MLB123', 90))
  const c = compararHarCatalogo(r, [catalogoHar()]).encontrados[0]
  assert.equal(c.diferenca, -10); assert.equal(c.diferencaPercentual, -10); assert.equal(c.status, 'ALTERADO')
  assert.equal(compararHarCatalogo(r, [catalogoHar('MLB123', { preco: 90 })]).iguais, 1)
  assert.equal(compararHarCatalogo(r, [catalogoHar('MLB123', { preco: null })]).encontrados[0].status, 'PRECO_INVALIDO')
  assert.equal(compararHarCatalogo(r, [catalogoHar(), catalogoHar()]).encontrados[0].status, 'CATALOGO_REVISAR')
})
test('ofertas ativas, agendadas ou com data inválida são protegidas; expiradas respeitam a regra existente', () => {
  const r = analisar(cardHar())
  const agora = Date.parse('2026-10-21T15:00:00Z')
  const oferta = (op) => compararHarCatalogo(r, [catalogoHar('MLB123', { ofertaRelampago: true, ...op })], agora).encontrados[0]
  assert.equal(oferta({}).status, 'OFERTA_PROTEGIDA')
  assert.equal(oferta({ ofertaInicio: '2026-10-22T12:00:00-03:00' }).oferta, 'AGENDADA')
  assert.equal(oferta({ ofertaFim: 'inválida' }).ofertaProtegida, true)
  assert.equal(oferta({ ofertaFim: '2026-10-20' }).oferta, 'EXPIRADA')
  assert.equal(oferta({ ofertaFim: '2026-10-21' }).ofertaProtegida, true)
  assert.equal(filtrarComparacaoHar([oferta({})], 'Oferta protegida').length, 1)
})
test('dados sensíveis e URLs de rastreamento não sobrevivem no resultado', () => {
  const entry = entradaHar([cardHar('MLB123', 90, { metadata: {
    user_id: 'segredo', session_id: 'segredo', token: 'segredo',
    url: 'www.mercadolivre.com.br/produto-teste/p/MLB456?token=segredo#session_id=segredo',
    url_params: '?pdp_filters=item_id%3AMLB123&token=segredo&user_id=segredo',
    url_fragments: '#polycard_client=affiliates&wid=MLB123&session_id=segredo',
  } })])
  entry.request.headers = [{ name: 'Authorization', value: 'segredo' }]
  entry.request.cookies = [{ name: 'session', value: 'segredo' }]
  entry.request.postData = { text: 'segredo' }
  entry.response.headers = [{ name: 'Set-Cookie', value: 'segredo' }]
  const r = analisarHar(arquivoHar(entry), 'sintetico.har')
  assert.doesNotMatch(JSON.stringify(r), /segredo|Authorization|headers|cookies|session_id|user_id/)
  assert.equal(r.produtos[0].capturas[0].url, 'https://www.mercadolivre.com.br/produto-teste/p/MLB456')
})
