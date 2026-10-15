import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { extrairListaAfiliados, normalizarUrlProdutoLista } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/extrairListaAfiliados.ts')
test.after(async () => vite.close())

const card = (id, url = 'www.mercadolivre.com.br/produto/p/MLB123', extras = {}) => ({
  unique_id: `card-${id}`,
  metadata: { id, url, ...extras },
  components: [{ id: 'title', title: { text: `Produto ${id}` } }],
})
const html = (cards, extras = {}) => `<!DOCTYPE html><html><script>window.lista = ${JSON.stringify({ type: 'affiliate', total_items: 300, polycards: cards, ...extras })};</script></html>`

test('extrai um produto e seus metadados opcionais', () => {
  const resultado = extrairListaAfiliados(html([card('MLB6456132876', 'www.mercadolivre.com.br/item', {
    user_product_id: 'MLBU3848348394', product_id: 'MLBU3848348394', pid: 'MLBU3848348394',
    pid_extended: 'MLBU3848348394_MLB6456132876', url_params: '?pdp_filters=item_id%3AMLB6456132876',
    url_fragments: '#wid=MLB6456132876&sid=bookmarks',
  })]))
  assert.equal(resultado.unicos, 1)
  assert.deepEqual(resultado.produtos[0], {
    ordem: 1, itemId: 'MLB6456132876', titulo: 'Produto MLB6456132876',
    userProductId: 'MLBU3848348394', productId: 'MLBU3848348394', pid: 'MLBU3848348394',
    pidExtended: 'MLBU3848348394_MLB6456132876', urlOriginal: 'www.mercadolivre.com.br/item',
    urlParams: '?pdp_filters=item_id%3AMLB6456132876', urlFragments: '#wid=MLB6456132876&sid=bookmarks',
    urlNormalizada: 'https://www.mercadolivre.com.br/item',
  })
})

test('extrai vários produtos', () => {
  assert.deepEqual(extrairListaAfiliados(html([card('MLB1'), card('MLB2'), card('MLB3')])).produtos.map((item) => item.itemId), ['MLB1', 'MLB2', 'MLB3'])
})

test('preserva ordem da lista inclusive entre dois blocos de polycards', () => {
  const entrada = html([card('MLB3'), card('MLB1')]) + html([card('MLB2')])
  const produtos = extrairListaAfiliados(entrada).produtos
  assert.deepEqual(produtos.map((item) => [item.ordem, item.itemId]), [[1, 'MLB3'], [2, 'MLB1'], [3, 'MLB2']])
})

test('normaliza URL www sem anexar parâmetros ou fragmentos separados', () => {
  const produto = extrairListaAfiliados(html([card('MLB1', 'www.mercadolivre.com.br/mesa/p/MLB123', {
    url_params: '?sid=bookmarks', url_fragments: '#wid=MLB1',
  })])).produtos[0]
  assert.equal(produto.urlNormalizada, 'https://www.mercadolivre.com.br/mesa/p/MLB123')
  assert.equal(produto.urlParams, '?sid=bookmarks')
  assert.equal(produto.urlFragments, '#wid=MLB1')
})

test('normaliza URL produto.mercadolivre.com.br', () => {
  assert.equal(normalizarUrlProdutoLista('produto.mercadolivre.com.br/MLB-6456132876-produto'),
    'https://produto.mercadolivre.com.br/MLB-6456132876-produto')
  assert.equal(normalizarUrlProdutoLista('http://produto.mercadolivre.com.br/MLB-6456132876-produto'),
    'https://produto.mercadolivre.com.br/MLB-6456132876-produto')
})

test('remove duplicados por metadata.id e mantém o primeiro', () => {
  const resultado = extrairListaAfiliados(html([card('MLB1', 'www.mercadolivre.com.br/primeiro'),
    card('MLB1', 'www.mercadolivre.com.br/segundo')]))
  assert.equal(resultado.duplicados, 1)
  assert.equal(resultado.produtos[0].urlNormalizada, 'https://www.mercadolivre.com.br/primeiro')
})

test('ignora item sem metadata.id válido', () => {
  const resultado = extrairListaAfiliados(html([{ metadata: { url: 'www.mercadolivre.com.br/sem-id' } },
    { metadata: { id: 'MLBU123', url: 'www.mercadolivre.com.br/invalido' } }, card('MLB1')]))
  assert.equal(resultado.ignorados, 2)
  assert.deepEqual(resultado.produtos.map((item) => item.ordem), [3])
})

test('funciona sem product_id', () => {
  assert.equal(extrairListaAfiliados(html([card('MLB1')])).produtos[0].productId, null)
})

test('funciona sem user_product_id', () => {
  assert.equal(extrairListaAfiliados(html([card('MLB1')])).produtos[0].userProductId, null)
})

test('HTML sem polycards mostra erro amigável', () => {
  assert.throws(() => extrairListaAfiliados('<html><body>Lista vazia</body></html>'), /Nenhum bloco de polycards/)
  assert.throws(() => extrairListaAfiliados('  '), /Cole o HTML\/Response/)
})

test('HTML inválido ou parcial não quebra o parser', () => {
  assert.throws(() => extrairListaAfiliados('<script>{"polycards":[{"metadata":{"id":"MLB1"}}'), /HTML está completo/)
  assert.throws(() => extrairListaAfiliados('<script>{"polycards":[{id:1}]}</script>'), /HTML está completo/)
})

test('aceita lista com type affiliate e total_items sem usá-los como produtos', () => {
  const resultado = extrairListaAfiliados(html([card('MLB1')], { type: 'affiliate', total_items: 300 }))
  assert.equal(resultado.encontrados, 1)
  assert.equal(resultado.unicos, 1)
})

test('contadores distinguem encontrados, únicos, ignorados e duplicados', () => {
  const resultado = extrairListaAfiliados(html([card('MLB1'), { metadata: {} }, card('MLB1'), card('MLB2')]))
  assert.deepEqual([resultado.encontrados, resultado.unicos, resultado.ignorados, resultado.duplicados], [4, 2, 1, 1])
})

test('mantém produto sem URL ou título e gera somente URLs HTTPS seguras em ordem', () => {
  const resultado = extrairListaAfiliados(html([
    card('MLB2', 'produto.mercadolivre.com.br/MLB-2'),
    { metadata: { id: 'MLB1' } },
    card('MLB3', 'www.mercadolivre.com.br/produto-3'),
    card('MLB4', 'https://outro.example/produto'),
  ]))
  assert.equal(resultado.produtos[1].titulo, null)
  assert.equal(resultado.produtos[1].urlNormalizada, null)
  assert.equal(resultado.produtos[3].urlNormalizada, null)
  assert.equal(resultado.urlsParaGerador,
    'https://produto.mercadolivre.com.br/MLB-2\nhttps://www.mercadolivre.com.br/produto-3')
})
