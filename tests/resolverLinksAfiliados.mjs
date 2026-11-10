import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { resolverLoteAfiliado, resolverLinkAfiliado } = await vite.ssrLoadModule('/server/resolverLinksAfiliados.ts')
const socialReal = readFileSync(new URL('./fixtures/2T6XVYU-social.html', import.meta.url), 'utf8')
const socialUrl = 'https://www.mercadolivre.com.br/social/ee20260414070618'
const linkSocial = 'https://meli.la/2T6XVYU'
const socialFetch = (html) => mock({ [linkSocial]: { url: socialUrl, html } })
const linkBelfix = 'https://meli.la/2KPkSSG'
const belfixId = 'MLB3402397357'
const belfixTitulo = 'Base Plástica 18kg Belfix Branco p/ Guarda-Sol ou Ombrellone'
function belfixHtml(query = '', fragmento = `wid=${belfixId}`) {
  const url = `https://www.mercadolivre.com.br/base-plastica/p/MLB22554571${query}#polycard_client=recommendations_home_affiliate-profile&${fragmento}`
  return `<section class="rl-card-featured"><section class="rl-list-single">
    <div class="poly-card"><a class="poly-component__title" href="${url.replaceAll('&', '&amp;')}">${belfixTitulo}</a>
    <div class="poly-price__current"><span class="andes-money-amount__currency-symbol">R$</span>
    <span data-andes-money-amount-fraction="true">69</span><span data-andes-money-amount-cents="true">80</span></div>
    <img class="poly-component__picture" src="https://http2.mlstatic.com/D_Q_NP_2X_777240-MLA96119964911_102025-V.webp" /></div>
    </section></section><section class="recommendations"><a href="https://produto.mercadolivre.com.br/MLB-9999999999-outro">Outro produto</a></section>`
}
const belfixFetch = (html) => mock({ [linkBelfix]: { url: socialUrl, html } })
test.after(async () => vite.close())

function html(id, titulo = `Produto ${id}`, preco = 42, imagem = true, canonico = id) {
  return `<link rel="canonical" href="https://www.mercadolivre.com.br/MLB-${canonico.slice(3)}-produto" />
  <meta property="og:title" content="${titulo} R$ 999" />
  <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: id, name: titulo,
    ...(imagem ? { image: `https://http2.mlstatic.com/${id}.jpg` } : {}),
    offers: preco === null ? {} : { price: preco, priceCurrency: 'BRL' } })}</script>`
}

function mock(paginas) {
  return async (url) => {
    if (url.startsWith('https://meli.la/')) {
      const alvo = paginas[url]
      return alvo ? new Response(null, { status: 302, headers: { location: alvo.url } }) : new Response('quebrado', { status: 404 })
    }
    const pagina = Object.values(paginas).find((item) => item.url === url)
    return pagina ? new Response(pagina.html, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('quebrado', { status: 404 })
  }
}

test('um link válido resolve dados técnicos e ignora preço acrescentado ao og:title', async () => {
  const fetch = mock({ 'https://meli.la/a': { url: 'https://www.mercadolivre.com.br/MLB-123-produto', html: html('MLB123') } })
  const item = await resolverLinkAfiliado('https://meli.la/a', fetch)
  assert.equal(item.status, 'novo')
  assert.equal(item.itemId, 'MLB123')
  assert.equal(item.titulo, 'Produto MLB123')
  assert.equal(item.preco, 42)
  assert.match(item.imagem, /MLB123/)
})

test('resolução pública funciona sem configuração ou sessão OAuth', async () => {
  const nomes = ['MELI_CLIENT_ID', 'MELI_CLIENT_SECRET', 'MELI_TOKEN_ENCRYPTION_KEY', 'DATABASE_URL']
  const anteriores = Object.fromEntries(nomes.map((nome) => [nome, process.env[nome]]))
  try {
    nomes.forEach((nome) => { delete process.env[nome] })
    const fetch = mock({ 'https://meli.la/publico': {
      url: 'https://www.mercadolivre.com.br/MLB-789-produto', html: html('MLB789'),
    } })
    const resultado = await resolverLoteAfiliado(['https://meli.la/publico'], async () => [], fetch)
    assert.equal(resultado[0].status, 'novo')
    assert.equal(resultado[0].itemId, 'MLB789')
  } finally {
    nomes.forEach((nome) => {
      if (anteriores[nome] === undefined) delete process.env[nome]
      else process.env[nome] = anteriores[nome]
    })
  }
})

test('fixture sanitizada do 2T6XVYU: card social fornece título, preço atual e imagem sem JSON-LD', async () => {
  const item = await resolverLinkAfiliado(linkSocial, socialFetch(socialReal))
  assert.equal(item.status, 'novo', item.erro)
  assert.equal(item.itemId, 'MLB4690598815')
  assert.equal(item.titulo, 'Tênis Asics Gel Revelation Original Couro Academia Caminhada')
  assert.equal(item.preco, 99.90)
  assert.match(item.imagem, /http2\.mlstatic\.com/)
  assert.match(item.urlProduto, /MLB-4690598815/)
})

test('regressão 2KPkSSG: wid no fragmento identifica o anúncio, não o catálogo /p/', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml()))
  assert.equal(item.status, 'novo', item.erro)
  assert.equal(item.itemId, belfixId)
  assert.equal(item.titulo, belfixTitulo)
  assert.equal(item.preco, 69.80)
  assert.equal(item.moeda, 'BRL')
  assert.match(item.imagem, /^https:\/\/http2\.mlstatic\.com\//)
  assert.equal(item.erro, null)
})

test('card social aceita o mesmo ITEM_ID na query e no fragmento', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml(`?wid=${belfixId}`)))
  assert.equal(item.status, 'novo', item.erro)
  assert.equal(item.itemId, belfixId)
})

test('card social bloqueia conflito entre query e fragmento', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml('?wid=MLB9999999999')))
  assert.equal(item.status, 'link_nao_validado')
  assert.equal(item.titulo, null)
})

test('card social não aceita ID de catálogo /p/ como ITEM_ID do anúncio', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml('', '')))
  assert.equal(item.status, 'link_nao_validado')
  assert.equal(item.itemId, null)
})

test('card social bloqueia título, preço ou imagem realmente ausentes', async () => {
  const semTitulo = socialReal.replace(/(<a class="poly-component__title"[^>]*>)[\s\S]*?(<\/a>)/, '$1$2')
  const semPreco = socialReal.replace(/<div class="poly-price__current"[\s\S]*?<\/div>/, '')
  const semImagem = socialReal.replace(/<img class="poly-component__picture"[^>]*>/, '')
  for (const [html, campo] of [[semTitulo, 'título'], [semPreco, 'preço'], [semImagem, 'imagem']]) {
    const item = await resolverLinkAfiliado(linkSocial, socialFetch(html))
    assert.equal(item.status, 'erro')
    assert.equal(item.itemId, 'MLB4690598815')
    assert.match(item.erro, new RegExp(campo))
  }
})

test('card social com título de outro ITEM_ID continua bloqueado', async () => {
  const html = socialReal.replace('MLB-4690598815', 'MLB-1234567890')
    .replace('</div></section></section>', '<a class="poly-component__link" href="https://produto.mercadolivre.com.br/MLB-4690598815-produto-_JM">Ir para produto</a></div></section></section>')
  const item = await resolverLinkAfiliado(linkSocial, socialFetch(html))
  assert.notEqual(item.status, 'novo')
})

test('lote misto preserva vínculo por ID e isola erros, existentes e repetidos', async () => {
  const paginas = {
    'https://meli.la/a': { url: 'https://www.mercadolivre.com.br/MLB-111-produto', html: html('MLB111') },
    'https://meli.la/b': { url: 'https://www.mercadolivre.com.br/MLB-222-produto', html: html('MLB222') },
    'https://meli.la/c': { url: 'https://www.mercadolivre.com.br/MLB-333-produto', html: html('MLB333') },
  }
  const links = ['https://meli.la/c', 'https://meli.la/quebrado', 'https://meli.la/a', 'https://meli.la/b', 'https://meli.la/c']
  const resultado = await resolverLoteAfiliado(links, async () => [{ mercadoLivreId: 'MLB111' }], mock(paginas))
  assert.deepEqual(resultado.map((item) => item.status), ['novo', 'erro', 'ja_existe', 'novo', 'ja_existe'])
  assert.deepEqual(resultado.map((item) => item.itemId), ['MLB333', null, 'MLB111', 'MLB222', 'MLB333'])
})

test('entrada inválida, destino ambíguo e dados incompletos bloqueiam somente o item', async () => {
  const paginas = {
    'https://meli.la/diverge': { url: 'https://www.mercadolivre.com.br/MLB-123-produto', html: html('MLB999', 'Outro', 42, true, 'MLB999') },
    'https://meli.la/sem-id': { url: 'https://www.mercadolivre.com.br/loja', html: '<html>sem produto</html>' },
    'https://meli.la/sem-preco': { url: 'https://www.mercadolivre.com.br/MLB-555-produto', html: html('MLB555', 'Sem preço', null) },
    'https://meli.la/sem-imagem': { url: 'https://www.mercadolivre.com.br/MLB-666-produto', html: html('MLB666', 'Sem imagem', 42, false) },
  }
  const resultado = await resolverLoteAfiliado(['http://meli.la/a', ...Object.keys(paginas)], async () => [], mock(paginas))
  assert.deepEqual(resultado.map((item) => item.status), ['erro', 'link_nao_validado', 'link_nao_validado', 'erro', 'erro'])
})
