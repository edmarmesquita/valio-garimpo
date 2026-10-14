import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { extrairProdutoHtml, extrairIdUrlPagina, LIMITE_HTML_PRODUTO } = await vite.ssrLoadModule('/src/lib/extrairProdutoHtml.ts')
after(async () => vite.close())

const link = 'https://meli.la/1um2MX7'
const pagina = 'https://www.mercadolivre.com.br/resistencia/p/MLB12345?pdp_filters=item_id:MLB6367832860'
const principal = { id: 'MLB6367832860', name: { text: 'Resistência Lorenzetti Bella Ducha Ultra 6800w 220v 4t Cinza Metal' },
  price: { current_value: { value: { fraction: '63', cents: '50' } } },
  picture: { secure_url: 'https://http2.mlstatic.com/D_NQ_NP_123.webp' }, rating: 4.7 }
const recomendacao = { id: 'MLB1111111111', name: { text: 'Produto recomendado' }, price: 22,
  image: 'https://http2.mlstatic.com/recomendacao.webp' }
const html = (objeto, extra = '') => `<!doctype html><html><head><link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-6367832860-produto"></head><body>${extra}<script type="application/json">${JSON.stringify(objeto)}</script></body></html>`
const separado = { product: { name: principal.name, price: principal.price },
  recommendations: [recomendacao], relatedProducts: [{ ...recomendacao, id: 'MLB2222222222', price: 199 }],
  sponsoredCards: [{ ...recomendacao, id: 'MLB3333333333', price: 5 }] }

test('identifica ITEM_ID somente por posições inequívocas na URL do produto', () => {
  assert.equal(extrairIdUrlPagina(pagina), principal.id)
  assert.equal(extrairIdUrlPagina('https://www.mercadolivre.com.br/p/MLB12345?pdp_filters=item_id%3AMLB6367832860'), principal.id)
  assert.equal(extrairIdUrlPagina('https://www.mercadolivre.com.br/produto?item_id=MLB6367832860'), principal.id)
  assert.equal(extrairIdUrlPagina('https://www.mercadolivre.com.br/produto?wid=MLB-6367832860'), principal.id)
  assert.equal(extrairIdUrlPagina('https://produto.mercadolivre.com.br/MLB-6367832860-produto'), principal.id)
  assert.throws(() => extrairIdUrlPagina('https://www.mercadolivre.com.br/p/MLB12345'), /não revelou ITEM_ID/)
  assert.throws(() => extrairIdUrlPagina('https://www.mercadolivre.com.br/produto?recommendation_id=MLB1111111111'), /não revelou ITEM_ID/)
  assert.throws(() => extrairIdUrlPagina('https://www.mercadolivre.com.br/produto?wid=MLB1111111111&item_id=MLB6367832860'), /conflitantes/)
  assert.throws(() => extrairIdUrlPagina('https://evil.test/produto?wid=MLB6367832860'), /Mercado Livre/)
})

test('extrai produto principal com muitos MLBs, name.text, fraction/cents, imagem e rating', () => {
  const resultado = extrairProdutoHtml(html({ recommendations: [recomendacao], product: principal }), link, pagina)
  assert.equal(resultado.itemId, 'MLB6367832860')
  assert.equal(resultado.titulo, principal.name.text)
  assert.equal(resultado.precoAtual, 63.5)
  assert.equal(resultado.imagemUrl, principal.picture.secure_url)
  assert.equal(resultado.avaliacao, 4.7)
  assert.equal(resultado.linkOriginal, link)
})

test('JSON-LD Product exige ID explícito e rating é opcional', () => {
  const doc = { '@context': 'https://schema.org', '@type': 'Product', sku: principal.id, name: 'Produto schema',
    image: ['https://http2.mlstatic.com/schema.webp'], offers: { price: '63.50' } }
  const produto = extrairProdutoHtml(html(doc), link, pagina)
  assert.equal(produto.itemId, 'MLB6367832860')
  assert.equal(produto.titulo, 'Produto schema')
  assert.equal(produto.precoAtual, 63.5)
  assert.equal(produto.avaliacao, null)
})

test('URL ancora título e preço do bloco PDP sem ID; imagem vem do JSON-LD', () => {
  const schema = { '@context': 'https://schema.org', '@type': 'Product', name: principal.name.text,
    image: 'https://http2.mlstatic.com/schema-principal.webp' }
  const resultado = extrairProdutoHtml(html(separado, `<script type="application/ld+json">${JSON.stringify(schema)}</script>`), link, pagina)
  assert.equal(resultado.itemId, principal.id)
  assert.equal(resultado.titulo, principal.name.text)
  assert.equal(resultado.precoAtual, 63.5)
  assert.equal(resultado.imagemUrl, schema.image)
  assert.equal(resultado.linkOriginal, link)
})

test('og:image tem prioridade sobre galeria PDP e nunca usa imagem de recomendação', () => {
  const extra = '<meta property="og:image" content="https://http2.mlstatic.com/og-principal.webp">'
  const dados = { ...separado, product: { ...separado.product, picture: principal.picture } }
  const resultado = extrairProdutoHtml(html(dados, extra), link, pagina)
  assert.equal(resultado.imagemUrl, 'https://http2.mlstatic.com/og-principal.webp')
  assert.equal(resultado.precoAtual, 63.5)
})

test('imagem em galeria PDP separada é aceita quando única', () => {
  const dados = { pdp: { product: separado.product, gallery: { picture: principal.picture } }, recommendations: [recomendacao] }
  const resultado = extrairProdutoHtml(html(dados), link, pagina)
  assert.equal(resultado.imagemUrl, principal.picture.secure_url)
  assert.equal(resultado.titulo, principal.name.text)
})

test('metadados principais fornecem título somente com canonical coincidente', () => {
  const dados = { product: { price: principal.price, picture: principal.picture }, recommendations: [recomendacao] }
  const extra = `<meta property="og:title" content="${principal.name.text}">`
  const resultado = extrairProdutoHtml(html(dados, extra), link, pagina)
  assert.equal(resultado.titulo, principal.name.text)
  assert.equal(resultado.precoAtual, 63.5)
  const semCanonico = `<script type="application/json">${JSON.stringify(dados)}</script>${extra}`
  assert.throws(() => extrairProdutoHtml(semCanonico, link, pagina), /título não encontrado/)
})

test('estado JSON atribuído a _n.ctx.r preserva Product e ignora itens de BreadcrumbList', () => {
  const estado = { flags: {}, appProps: { pageProps: { initialState: {
    components: { header: { title: principal.name.text }, price: { price: principal.price },
      recommendations: [recomendacao] },
    schema: [{ '@context': 'https://schema.org', '@type': 'Product', sku: 'MLBU3825358932',
      name: principal.name.text, offers: { price: 63.5 }, image: principal.picture.secure_url },
    { '@type': 'BreadcrumbList', itemListElement: [{ item: { name: 'Construção' } }] }],
  } } } }
  const paginaRealista = `<meta property="og:image" content="${principal.picture.secure_url}"><script>_n.ctx.r = ${JSON.stringify(estado)};</script>`
  const resultado = extrairProdutoHtml(paginaRealista, link, pagina)
  assert.equal(resultado.itemId, principal.id)
  assert.equal(resultado.titulo, principal.name.text)
  assert.equal(resultado.precoAtual, 63.5)
  assert.equal(resultado.imagemUrl, principal.picture.secure_url)
})

test('conflitos e ausência de título, preço ou imagem produzem diagnóstico sem HTML bruto', () => {
  const erro = (dados, extra = '') => {
    try { extrairProdutoHtml(html(dados, extra), link, pagina); assert.fail('deveria rejeitar') }
    catch (falha) { return falha.message }
  }
  assert.match(erro({ recommendations: [recomendacao] }), /ITEM_ID ok, título não encontrado/)
  assert.match(erro({ product: { name: principal.name } }), /ITEM_ID ok, título ok, preço não encontrado/)
  assert.match(erro(separado), /ITEM_ID ok, título\/preço ok, imagem principal não encontrada/)
  assert.match(erro({ product: [separado.product, { ...separado.product, price: 90 }] }), /conflitantes\/ambíguos/)
  assert.match(erro({ product: [separado.product, { ...separado.product, name: { text: 'Outro produto' } }] }), /conflitantes\/ambíguos/)
})

test('script com objeto JSON serializado é lido sem executar JavaScript', () => {
  delete globalThis.__htmlExecuted
  const pagina = `<script>globalThis.__htmlExecuted = true; window.initialState = ${JSON.stringify({ product: principal })};</script>`
  const produto = extrairProdutoHtml(pagina, link, 'https://produto.mercadolivre.com.br/MLB-6367832860-produto')
  assert.equal(produto.itemId, principal.id)
  assert.equal(globalThis.__htmlExecuted, undefined)
})

test('rejeita HTML sem produto, candidatos ambíguos e imagem insegura', () => {
  assert.throws(() => extrairProdutoHtml('<title>Mercado Livre</title> MLB123', link, pagina), /título não encontrado/)
  const ambiguo = `<script type="application/json">${JSON.stringify([principal, { ...recomendacao, id: 'MLB2222222222' }])}</script>`
  assert.equal(extrairProdutoHtml(ambiguo, link, pagina).itemId, principal.id)
  assert.throws(() => extrairProdutoHtml(`<script type="application/json">${JSON.stringify({ product: { ...principal, picture: { url: 'javascript:alert(1)' } } })}</script>`, link, pagina), /imagem principal não encontrada/)
  assert.throws(() => extrairProdutoHtml(html({ product: recomendacao }), link, pagina), /título não encontrado/)
  assert.throws(() => extrairProdutoHtml(html({ product: { ...principal, name: null }, recommendations: [recomendacao] }), link, pagina), /título não encontrado/)
  assert.throws(() => extrairProdutoHtml(html({ product: principal }), link, 'https://www.mercadolivre.com.br/produto'), /não revelou ITEM_ID/)
  assert.throws(() => extrairProdutoHtml(html({ product: principal }), link, 'https://www.mercadolivre.com.br/produto?wid=MLB1111111111'), /diferentes/)
  assert.throws(() => extrairProdutoHtml(html({ product: [principal, { ...principal, title: 'Conflito', name: null }] }), link, pagina), /conflitantes\/ambíguos/)
})

test('exige link afiliado permitido, preserva valor e limita HTML', () => {
  for (const invalido of ['', 'https://example.com/produto', 'javascript:alert(1)', 'http://meli.la/1', 'https://meli.la.evil.test/a']) {
    assert.throws(() => extrairProdutoHtml(html({ product: principal }), invalido, pagina), /link afiliado|Domínio/)
  }
  assert.equal(LIMITE_HTML_PRODUTO, 10_000_000)
  const valido = html({ product: principal })
  const abaixo = valido + ' '.repeat(LIMITE_HTML_PRODUTO - valido.length - 1)
  assert.equal(extrairProdutoHtml(abaixo, link, pagina).itemId, principal.id)
  const acima = valido + ' '.repeat(LIMITE_HTML_PRODUTO - valido.length + 1)
  assert.throws(() => extrairProdutoHtml(acima, link, pagina), { message: 'HTML grande demais. Limite de 10 MB.' })
})
