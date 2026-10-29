import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { cardHar } from './fixtures/harAfiliados.mjs'

const vite = await createServer({ server: { middlewareMode: true, appType: 'custom', logLevel: 'silent' } })
const [{ extrairProdutosPaginaOfertas }, { analisarArquivoInativos, extrairArquivoInativos }] = await Promise.all([
  vite.ssrLoadModule('/src/lib/extrairProdutosPaginaOfertas.ts'),
  vite.ssrLoadModule('/src/lib/recuperarInativos.ts'),
])
test.after(async () => vite.close())

const fixture = JSON.parse(readFileSync(new URL('./fixtures/paginaOfertasNordic.json', import.meta.url), 'utf8'))
const html = (data) => `<html><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify({ appProps: { pageProps: { data } } })};</script></html>`
const card = (n, overrides = {}) => ({
  position: n,
  card: {
    metadata: {
      id: `MLB${100000 + n}`, product_id: `MLB${200000 + n}`, user_product_id: `MLBU${300000 + n}`,
      url: `www.mercadolivre.com.br/produto-${n}/up/MLBU${300000 + n}`,
      url_fragments: `#polycard_client=offers&wid=MLB${100000 + n}&sid=offers`,
      ...overrides.metadata,
    },
    components: [
      { id: 'title', title: { text: `Produto oferta ${n}` } },
      { id: 'price_v2', price: { current_price: { value: 40 + n, currency: 'BRL' } } },
    ],
    ...overrides.card,
  },
})
const pagina = (...items) => ({ page: 2, limit: 48,
  paging: { offset: 48, limit: 48, total: 1248 }, items })

test('fixture Nordic de página geral extrai ITEM_ID, IDs auxiliares, título, preço, moeda e URL', () => {
  const resultado = extrairProdutosPaginaOfertas(html(fixture), 'ofertas.html')
  assert.equal(resultado.cardsBrutos, 1)
  assert.deepEqual(resultado.produtos[0], {
    itemId: 'MLB1234567890', titulo: 'Produto de teste da vitrine', preco: 67.5, moeda: 'BRL',
    productId: 'MLB98765432', userProductId: 'MLBU1234567890',
    url: 'https://www.mercadolivre.com.br/produto-teste/up/MLBU1234567890', origem: 'ofertas.html',
  })
  assert.deepEqual(resultado.pagina, { page: 2, offset: 48, limit: 48, total: 1248 })
  assert.equal(resultado.produtos.length, 1, 'paging.total não cria produtos ausentes do HTML')
})

test('página com 48 cards extrai 48 ITEM_IDs distintos com título e preço', () => {
  const resultado = extrairProdutosPaginaOfertas(html(pagina(...Array.from({ length: 48 }, (_, i) => card(i + 1)))), 'pagina.html')
  assert.equal(resultado.cardsBrutos, 48)
  assert.equal(resultado.produtos.length, 48)
  assert.equal(new Set(resultado.produtos.map((item) => item.itemId)).size, 48)
  assert.equal(resultado.produtos.every((item) => item.titulo && item.preco > 0 && item.moeda === 'BRL'), true)
})

test('cards sem ITEM_ID ou com ITEM_ID inválido não usam productId como substituto', () => {
  const semId = card(1); delete semId.card.metadata.id
  const invalido = card(2, { metadata: { id: 'MLB-123' } })
  const resultado = extrairProdutosPaginaOfertas(html(pagina(semId, invalido)), 'ids.html')
  assert.equal(resultado.semItemId, 2)
  assert.deepEqual(resultado.produtos, [])
})

test('card sem preço ou moeda BRL não entra na lista segura', () => {
  const semPreco = card(1, { card: { components: [{ id: 'title', title: { text: 'Produto' } }] } })
  const moedaDiferente = card(2, { card: { components: [
    { id: 'title', title: { text: 'Produto' } },
    { id: 'price_v2', price: { current_price: { value: 20, currency: 'USD' } } },
  ] } })
  const resultado = extrairProdutosPaginaOfertas(html(pagina(semPreco, moedaDiferente)), 'precos.html')
  assert.equal(resultado.semPreco, 2)
  assert.deepEqual(resultado.produtos, [])
})

test('card sem título é descartado sem inferência textual', () => {
  const semTitulo = card(1, { card: { components: [
    { id: 'price_v2', price: { current_price: { value: 21, currency: 'BRL' } } },
  ] } })
  const resultado = extrairProdutosPaginaOfertas(html(pagina(semTitulo)), 'sem-titulo.html')
  assert.equal(resultado.semTitulo, 1)
  assert.deepEqual(resultado.produtos, [])
})

test('wid concordante confirma metadata.id e wid divergente bloqueia o card', () => {
  const concordante = card(1)
  const divergente = card(2, { metadata: { url_fragments: '#polycard_client=offers&wid=MLB9999999&sid=offers' } })
  const resultado = extrairProdutosPaginaOfertas(html(pagina(concordante, divergente)), 'wid.html')
  assert.equal(resultado.produtos.length, 1)
  assert.equal(resultado.produtos[0].itemId, concordante.card.metadata.id)
  assert.equal(resultado.widDivergente, 1)
})

test('página vazia e HTML sem estado Nordic não são confundidos com lista de ofertas', () => {
  assert.equal(extrairProdutosPaginaOfertas(html(pagina()), 'vazia.html').cardsBrutos, 0)
  assert.throws(() => extrairProdutosPaginaOfertas('', 'vazio.html'), /HTML vazio/)
  assert.throws(() => extrairProdutosPaginaOfertas('<html>sem estado</html>', 'outro.html'), /estado Nordic/)
})

test('integração aceita página geral Nordic e preserva origem sem expandir a paginação', () => {
  const resultado = analisarArquivoInativos(html(fixture), 'pagina-ofertas.html')
  assert.equal(resultado.reconhecido, true)
  assert.equal(resultado.formato, 'OFERTAS_NORDIC')
  assert.equal(resultado.cardsBrutos, 1)
  assert.equal(resultado.capturas.length, 1)
  assert.equal(resultado.capturas[0].origem, 'pagina-ofertas.html')
  assert.equal(resultado.capturas[0].moeda, 'BRL')
})

test('Outlet é aceito automaticamente quando o HTML usa a estrutura Nordic suportada', () => {
  const resultado = analisarArquivoInativos(html(fixture), 'Outlet.html')
  assert.equal(resultado.reconhecido, true)
  assert.equal(resultado.formato, 'OFERTAS_NORDIC')
  assert.equal(resultado.capturas[0].itemId, 'MLB1234567890')
  assert.equal(resultado.capturas[0].origem, 'Outlet.html')
})

test('a página antiga em JSON-LD continua reconhecida e documentos vazios recebem erro genérico', () => {
  const antiga = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: 'MLB500',
    name: 'Produto antigo', offers: { price: 55, priceCurrency: 'BRL' } })}</script>`
  assert.equal(analisarArquivoInativos(antiga, 'lista-antiga.html').capturas[0].itemId, 'MLB500')
  const desconhecido = analisarArquivoInativos('', 'vazio.html')
  assert.equal(desconhecido.reconhecido, false)
  assert.throws(() => extrairArquivoInativos('<html>não é uma lista</html>', 'outro.html'), /Documento não reconhecido/)
})

test('HTML Nordic antigo de lista de afiliados continua no parser legado', () => {
  const cardAntigo = cardHar('MLB456', 72, { titulo: 'Produto da lista antiga',
    metadata: { url_fragments: '#polycard_client=affiliates&wid=MLB456&sid=affiliates',
      url_params: '?pdp_filters=item_id%3AMLB456' } })
  const lista = { appProps: { pageProps: { initialState: { list: { id: 'lista-teste', type: 'affiliate',
    name: 'Lista', title: 'Lista', total_items: 1, elements: { polycards: [cardAntigo] } } } } } }
  const conteudo = `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify(lista)};</script>`
  const resultado = analisarArquivoInativos(conteudo, 'lista-antiga.html')
  assert.equal(resultado.reconhecido, true)
  assert.notEqual(resultado.formato, 'OFERTAS_NORDIC')
  assert.equal(resultado.capturas[0].itemId, 'MLB456')
  assert.equal(resultado.capturas[0].preco, 72)
})
