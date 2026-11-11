import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { analisarArquivoInativos, urlAnuncioCandidato, urlBuscaTituloCandidato } =
  await vite.ssrLoadModule('/src/lib/recuperarInativos.ts')
const { extrairPrecosHtml } = await vite.ssrLoadModule('/src/lib/extrairPrecosHtml.ts')
test.after(async () => vite.close())

test('permalink estruturado sÃ³ Ã© usado quando aponta ao ITEM_ID do candidato', () => {
  const confiavel = urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    url: 'https://produto.mercadolivre.com.br/MLB-7745025542-jogo-6-tacas' })
  assert.equal(confiavel, 'https://produto.mercadolivre.com.br/MLB-7745025542-jogo-6-tacas?pdp_filters=item_id%3AMLB7745025542')
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    url: 'https://www.mercadolivre.com.br/MLB-9999999999-outro-anuncio' }), null)
})

test('URL estruturada do HTML usa o ITEM_ID associado no pdp_filters', () => {
  const itemId = 'MLB7745025542'
  const origem = `https://www.mercadolivre.com.br/p/MLB27156430?pdp_filters=item_id%3A${itemId}`
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: itemId,
    name: 'Jogo 6 Ta\u00e7as de Vidro Transparente Diamond para \u00c1gua e Drinks', url: origem,
    offers: { price: 69.9, priceCurrency: 'BRL' } })}</script>`
  const produto = analisarArquivoInativos(html, 'candidato.html').capturas[0]
  const extraido = extrairPrecosHtml(html, 'candidato.html')
  assert.equal(extraido.urls.get(itemId), origem, JSON.stringify({ html, produtos: extraido.produtos, urls: [...extraido.urls] }))
  assert.equal(produto.itemId, itemId)
  assert.equal(urlAnuncioCandidato(produto), `https://www.mercadolivre.com.br/p/MLB27156430?pdp_filters=item_id%3A${itemId}`, JSON.stringify(produto))
})

test('productId mais ITEM_ID do mesmo registro cria PDP especÃ­fica por wid', () => {
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: 'MLB27156430', url: null }),
    'https://www.mercadolivre.com.br/p/MLB27156430?wid=MLB7745025542')
})

test('userProductId mais ITEM_ID usa a estrutura /up/ com wid validada pelo projeto', () => {
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    userProductId: 'MLBU3848348394', url: null }),
  'https://www.mercadolivre.com.br/up/MLBU3848348394?wid=MLB7745025542')
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    userProductId: 'MLBU3848348394', url: 'https://www.mercadolivre.com.br/up/MLBU3848348394' }),
  'https://www.mercadolivre.com.br/up/MLBU3848348394?wid=MLB7745025542')
})

test('wid estruturado no fragmento sÃ³ gera link quando bate exatamente com o ITEM_ID', () => {
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    url: 'https://www.mercadolivre.com.br/p/MLB27156430', urlFragments: '#wid=MLB7745025542' }),
  'https://www.mercadolivre.com.br/p/MLB27156430?wid=MLB7745025542')
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    url: 'https://www.mercadolivre.com.br/p/MLB27156430', urlFragments: '#wid=MLB9999999999' }), null)
})

test('ITEM_ID sozinho nunca Ã© convertido em URL de anÃºncio', () => {
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null, url: null }), null)
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null,
    url: 'https://www.mercadolivre.com.br/p/MLB27156430' }), null)
})

test('URL com wid divergente ou combinaÃ§Ã£o productId/caminho inconsistente bloqueia link', () => {
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: 'MLB27156430',
    url: 'https://www.mercadolivre.com.br/p/MLB12345678?wid=MLB9999999999' }), null)
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: 'MLB27156430',
    url: 'https://www.mercadolivre.com.br/p/MLB12345678' }), null)
})

test('fallback busca somente pelo tÃ­tulo e permanece separado da validaÃ§Ã£o do ITEM_ID', () => {
  assert.equal(urlBuscaTituloCandidato('Ta\u00e7as Diamond'),
    'https://www.mercadolivre.com.br/jm/search?query=Ta%C3%A7as%20Diamond')
  assert.equal(urlAnuncioCandidato({ itemId: 'MLB7745025542', productId: null, url: null }), null)
  assert.equal(urlBuscaTituloCandidato('Jogo 6 Ta\u00e7as de Vidro Transparente Diamond para \u00c1gua e Drinks'),
    'https://www.mercadolivre.com.br/jm/search?query=Jogo%206%20Ta%C3%A7as%20de%20Vidro%20Transparente%20Diamond%20para%20%C3%81gua%20e%20Drinks')
  assert.equal(urlBuscaTituloCandidato('  '), null)
})
