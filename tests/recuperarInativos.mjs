import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { classificarInativos, extrairArquivoInativos, analisarArquivoInativos } = await vite.ssrLoadModule('/src/lib/recuperarInativos.ts')
test.after(async () => { await vite.close() })

const catalogo = (id, titulo, ativo = false) => ({ mercadoLivreId: id, titulo, ativo, preco: 50, categoria: 'Achados para Casa' })
const captura = (id, titulo, preco = 55, origem = 'lista.html') =>
  ({ itemId: id, titulo, preco, productId: null, userProductId: null, origem })
const html = (id, titulo, price, currency = 'BRL') => `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Product', sku: id, name: titulo, offers: { price, priceCurrency: currency },
})}</script>`

test('inativo com mesmo ITEM_ID é EXATO e ativo é ignorado', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Produto'), catalogo('MLB2', 'Ativo', true)],
    [captura('MLB1', 'Produto'), captura('MLB2', 'Ativo')])
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].tipo, 'EXATO')
  assert.equal(resultado[0].exato.itemId, 'MLB1')
})

test('mesmo título normalizado e outro ITEM_ID é só CANDIDATO', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Câmera Lâmpada Yoosee')],
    [captura('MLB2', 'camera  lampada YOOSEE')])[0]
  assert.equal(resultado.tipo, 'CANDIDATO')
  assert.equal(resultado.candidatos[0].confianca, 'ALTA')
  assert.equal(resultado.exato, null)
})

test('semelhança genérica e variante diferente não viram alta confiança', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Câmera Lâmpada Segurança Wifi Yoosee')],
    [captura('MLB2', 'Câmera Mini Babá Wifi Yoosee')])[0]
  assert.equal(resultado.candidatos.some((item) => item.confianca === 'ALTA'), false)
})

test('duplicatas idênticas entre arquivos não geram segunda correspondência', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Produto')],
    [captura('MLB1', 'Produto', 55, 'um.html'), captura('MLB1', 'Produto', 55, 'dois.html')])[0]
  assert.equal(resultado.tipo, 'EXATO')
  assert.equal(resultado.exato.origem, 'um.html')
  assert.deepEqual(resultado.exato.origens, ['um.html', 'dois.html'])
})

test('preços conflitantes para o mesmo ITEM_ID bloqueiam EXATO', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Produto')],
    [captura('MLB1', 'Produto', 55, 'pagina1.html'), captura('MLB1', 'Produto', 60, 'pagina2.html')])[0]
  assert.equal(resultado.tipo, 'SEM CORRESPONDÊNCIA')
  assert.equal(resultado.exato, null)
  assert.deepEqual(resultado.conflitoPreco.precos, [55, 60])
  assert.deepEqual(resultado.conflitoPreco.origens, ['pagina1.html', 'pagina2.html'])
})

test('página de ofertas produz EXATO por ITEM_ID e produto ativo segue ignorado', () => {
  const page = (id) => `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify({ appProps: { pageProps: { data: {
    items: [{ card: { metadata: { id, url_fragments: `#wid=${id}` }, components: [
      { id: 'title', title: { text: 'Produto de ofertas' } },
      { id: 'price_v2', price: { current_price: { value: 55, currency: 'BRL' } } },
    ] } }] } } } })};</script>`
  const capturaOfertas = analisarArquivoInativos(page('MLB1'), 'ofertas.html')
  assert.equal(capturaOfertas.formato, 'OFERTAS_NORDIC')
  const resultado = classificarInativos([catalogo('MLB1', 'Outro título'), catalogo('MLB2', 'Produto de ofertas', true)], capturaOfertas.capturas)
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].tipo, 'EXATO')
  assert.equal(resultado[0].exato.itemId, 'MLB1')
})

test('outro ITEM_ID semelhante permanece CANDIDATO, não EXATO', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Câmera Lâmpada Segurança Wifi Yoosee')],
    [captura('MLB2', 'Câmera Lâmpada Segurança Wifi Yoosee', 55, 'ofertas.html')])[0]
  assert.equal(resultado.tipo, 'CANDIDATO')
  assert.equal(resultado.exato, null)
})

test('HTML aceita BRL e descarta moeda diferente e produto sem preço', () => {
  assert.equal(extrairArquivoInativos(html('MLB1', 'Produto', 55), 'ofertas.html').length, 1)
  assert.equal(extrairArquivoInativos(html('MLB1', 'Produto', 55, 'USD'), 'ofertas.html').length, 0)
  assert.equal(extrairArquivoInativos(html('MLB1', 'Produto', null), 'ofertas.html').length, 0)
})

test('produto sem correspondência continua visível no diagnóstico', () => {
  const resultado = classificarInativos([catalogo('MLB1', 'Escova elétrica EPS-4112')],
    [captura('MLB2', 'Sanduicheira 750W')])[0]
  assert.equal(resultado.tipo, 'SEM CORRESPONDÊNCIA')
})
