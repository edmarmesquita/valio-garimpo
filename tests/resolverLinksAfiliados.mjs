import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { resolverLoteAfiliado, resolverLinkAfiliado } = await vite.ssrLoadModule('/server/resolverLinksAfiliados.ts')
const socialReal = readFileSync(new URL('./fixtures/2T6XVYU-social.html', import.meta.url), 'utf8')
const faixasReal = readFileSync(new URL('./fixtures/2Xwwz9n-social.html', import.meta.url), 'utf8')
const linkFaixas = 'https://meli.la/2Xwwz9n'
const faixasId = 'MLB5185692184'
const faixasFetch = (html) => mock({ [linkFaixas]: { url: socialUrl, html } })
const faixasPdpUrl = 'https://www.mercadolivre.com.br/kit-10-faixa-refletiva-lateral-3m-caminhao-moto-trailer/p/MLB27156430?wid=MLB5185692184'
function faixasPdpHtml(id = faixasId, preco = 34.87) {
  const canonical = `https://www.mercadolivre.com.br/MLB-${id.slice(3)}-kit-10-faixa-refletiva-lateral-3m-caminhao-moto-trailer`
  return `<link rel="canonical" href="${canonical}" />
  <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: id,
    name: 'Kit 10 Faixa Refletiva Lateral 3m CaminhÃ£o Moto Trailer',
    image: 'https://http2.mlstatic.com/faixa-refletiva.webp',
    ...(preco === null ? {} : { offers: { price: preco, priceCurrency: 'BRL' } }) })}</script>`
}
function fetchSocialPdp(socialHtml, pdpHtml) {
  return async (url) => {
    if (url === linkFaixas) return new Response(null, { status: 302, headers: { location: socialUrl } })
    if (url === socialUrl) return new Response(socialHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    if (url === faixasPdpUrl) return new Response(pdpHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('not found', { status: 404 })
  }
}
const socialUrl = 'https://www.mercadolivre.com.br/social/ee20260414070618'
const linkSocial = 'https://meli.la/2T6XVYU'
const socialFetch = (html) => mock({ [linkSocial]: { url: socialUrl, html } })
const linkBelfix = 'https://meli.la/2KPkSSG'
const belfixId = 'MLB3402397357'
const belfixTitulo = 'Base PlÃ¡stica 18kg Belfix Branco p/ Guarda-Sol ou Ombrellone'
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

test('um link vÃ¡lido resolve dados tÃ©cnicos e ignora preÃ§o acrescentado ao og:title', async () => {
  const fetch = mock({ 'https://meli.la/a': { url: 'https://www.mercadolivre.com.br/MLB-123-produto', html: html('MLB123') } })
  const item = await resolverLinkAfiliado('https://meli.la/a', fetch)
  assert.equal(item.status, 'novo')
  assert.equal(item.itemId, 'MLB123')
  assert.equal(item.titulo, 'Produto MLB123')
  assert.equal(item.preco, 42)
  assert.match(item.imagem, /MLB123/)
})

test('resoluÃ§Ã£o pÃºblica funciona sem configuraÃ§Ã£o ou sessÃ£o OAuth', async () => {
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

test('fixture sanitizada do 2T6XVYU: card social fornece tÃ­tulo, preÃ§o atual e imagem sem JSON-LD', async () => {
  const item = await resolverLinkAfiliado(linkSocial, socialFetch(socialReal))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, 'MLB4690598815')
  assert.equal(item.titulo, 'Tênis Asics Gel Revelation Original Couro Academia Caminhada')
  assert.equal(item.preco, null)
  assert.match(item.imagem, /http2\.mlstatic\.com/)
  assert.match(item.urlProduto, /MLB-4690598815/)
})

test('regressÃ£o 2KPkSSG: wid no fragmento identifica o anÃºncio, nÃ£o o catÃ¡logo /p/', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml()))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, belfixId)
  assert.equal(item.titulo, belfixTitulo)
  assert.equal(item.preco, null)
  assert.equal(item.moeda, null)
  assert.match(item.imagem, /^https:\/\/http2\.mlstatic\.com\//)
  assert.match(item.erro, /Preço atual não pôde ser confirmado na página do produto/)
})

test('card social aceita o mesmo ITEM_ID na query e no fragmento', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml(`?wid=${belfixId}`)))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, belfixId)
})

test('card social bloqueia conflito entre query e fragmento', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml('?wid=MLB9999999999')))
  assert.equal(item.status, 'link_nao_validado')
  assert.equal(item.titulo, null)
})

test('card social nÃ£o aceita ID de catÃ¡logo /p/ como ITEM_ID do anÃºncio', async () => {
  const item = await resolverLinkAfiliado(linkBelfix, belfixFetch(belfixHtml('', '')))
  assert.equal(item.status, 'link_nao_validado')
  assert.equal(item.itemId, null)
})

test('regressÃ£o 2Xwwz9n: preÃ§o atual estruturado sem centavos', async () => {
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(faixasReal))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, faixasId)
  assert.equal(item.titulo, 'Kit 10 Faixa Refletiva Lateral 3m Caminhão Moto Trailer')
  assert.equal(item.preco, null)
  assert.equal(item.moeda, null)
  assert.match(item.imagem, /^https:\/\/http2\.mlstatic\.com\//)
})

test('card social mantÃ©m centavos quando o preÃ§o atual estruturado os fornece', async () => {
  const comCentavos = faixasReal.replace('data-andes-money-amount-fraction="true">31</span>',
    'data-andes-money-amount-fraction="true">31</span><span data-andes-money-amount-cents="true">69</span>')
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(comCentavos))
  assert.equal(item.status, 'erro')
  assert.equal(item.preco, null)
})

test('card social usa preÃ§o atual e ignora preÃ§o anterior promocional', async () => {
  const promocional = faixasReal.replace('<div class="poly-price__current">',
    '<s class="poly-price__previous"><span class="andes-money-amount__currency-symbol">R$</span><span data-andes-money-amount-fraction="true">38</span><span data-andes-money-amount-cents="true">65</span></s><div class="poly-price__current">')
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(promocional))
  assert.equal(item.status, 'erro')
  assert.equal(item.preco, null)
})

test('card social continua bloqueando ausÃªncia real de preÃ§o atual', async () => {
  const semPreco = faixasReal.replace(/<div class="poly-price__current">[\s\S]*?<\/div>/, '')
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(semPreco))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, faixasId)
  assert.match(item.erro, /Preço atual não pôde ser confirmado na página do produto/)
})

test('card social continua bloqueando ITEM_ID conflitante no destaque', async () => {
  const conflito = faixasReal.replace('#wid=MLB5185692184', '#wid=MLB9999999999')
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(conflito))
  assert.notEqual(item.status, 'novo')
})

test('2Xwwz9n prefere o preÃ§o da PDP vinculada ao mesmo ITEM_ID', async () => {
  const item = await resolverLinkAfiliado(linkFaixas, fetchSocialPdp(faixasReal, faixasPdpHtml()))
  assert.equal(item.status, 'novo')
  assert.equal(item.itemId, faixasId)
  assert.equal(item.titulo, 'Kit 10 Faixa Refletiva Lateral 3m CaminhÃ£o Moto Trailer')
  assert.equal(item.preco, 34.87)
  assert.equal(item.moeda, 'BRL')
  assert.match(item.urlProduto, /MLB-5185692184/)
})

test('PDP divergente do ITEM_ID social bloqueia', async () => {
  const item = await resolverLinkAfiliado(linkFaixas,
    fetchSocialPdp(faixasReal, faixasPdpHtml('MLB9999999999', 34.87)))
  assert.equal(item.status, 'erro')
  assert.match(item.erro, /ITEM_ID divergente/)
})

test('social sem preÃ§o usa PDP validada com preÃ§o', async () => {
  const semPreco = faixasReal.replace(/<div class="poly-price__current">[\s\S]*?<\/div>/, '')
  const item = await resolverLinkAfiliado(linkFaixas, fetchSocialPdp(semPreco, faixasPdpHtml()))
  assert.equal(item.status, 'novo')
  assert.equal(item.preco, 34.87)
})

test('PDP validada sem preÃ§o bloqueia apesar do preÃ§o social', async () => {
  const item = await resolverLinkAfiliado(linkFaixas, fetchSocialPdp(faixasReal, faixasPdpHtml(faixasId, null)))
  assert.equal(item.status, 'erro')
  assert.equal(item.preco, null)
  assert.equal(item.itemId, faixasId)
  assert.match(item.erro, /Preço atual não pôde ser confirmado na página do produto/)
})

test('PDP inacessÃ­vel bloqueia e nÃ£o devolve o preÃ§o social', async () => {
  const item = await resolverLinkAfiliado(linkFaixas, faixasFetch(faixasReal))
  assert.equal(item.status, 'erro')
  assert.equal(item.itemId, faixasId)
  assert.equal(item.preco, null)
  assert.ok(item.titulo)
  assert.ok(item.imagem)
  assert.match(item.erro, /Preço atual não pôde ser confirmado na página do produto/)
})

test('PDP priorizada registra conflito de preÃ§o com o card social', async () => {
  const avisos = []
  const original = console.info
  try {
    console.info = (...args) => avisos.push(args)
    const item = await resolverLinkAfiliado(linkFaixas, fetchSocialPdp(faixasReal, faixasPdpHtml()))
    assert.equal(item.preco, 34.87)
    assert.ok(avisos.some(([evento, dados]) => evento === '[afiliado-preco]' && dados.precoSocial === 31 && dados.precoPdp === 34.87))
  } finally { console.info = original }
})

test('PDP inteira continua sendo usada quando preÃ§o validado nÃ£o tem centavos', async () => {
  const item = await resolverLinkAfiliado(linkFaixas, fetchSocialPdp(faixasReal, faixasPdpHtml(faixasId, 35)))
  assert.equal(item.status, 'novo')
  assert.equal(item.preco, 35)
})

test('card social bloqueia tÃ­tulo, preÃ§o ou imagem realmente ausentes', async () => {
  const semTitulo = socialReal.replace(/(<a class="poly-component__title"[^>]*>)[\s\S]*?(<\/a>)/, '$1$2')
  const semPreco = socialReal.replace(/<div class="poly-price__current"[\s\S]*?<\/div>/, '')
  const semImagem = socialReal.replace(/<img class="poly-component__picture"[^>]*>/, '')
  for (const [html, campo] of [[semTitulo, 'tÃ­tulo'], [semPreco, 'preÃ§o'], [semImagem, 'imagem']]) {
    const item = await resolverLinkAfiliado(linkSocial, socialFetch(html))
    assert.equal(item.status, 'erro')
    assert.equal(item.itemId, 'MLB4690598815')
    assert.match(item.erro, campo === 'preÃ§o' ? /Preço atual não pôde ser confirmado na página do produto/ : (campo === 'tÃ­tulo' ? /título/ : new RegExp(campo)))
  }
})

test('card social com tÃ­tulo de outro ITEM_ID continua bloqueado', async () => {
  const html = socialReal.replace('MLB-4690598815', 'MLB-1234567890')
    .replace('</div></section></section>', '<a class="poly-component__link" href="https://produto.mercadolivre.com.br/MLB-4690598815-produto-_JM">Ir para produto</a></div></section></section>')
  const item = await resolverLinkAfiliado(linkSocial, socialFetch(html))
  assert.notEqual(item.status, 'novo')
})

test('lote misto preserva vÃ­nculo por ID e isola erros, existentes e repetidos', async () => {
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

test('entrada invÃ¡lida, destino ambÃ­guo e dados incompletos bloqueiam somente o item', async () => {
  const paginas = {
    'https://meli.la/diverge': { url: 'https://www.mercadolivre.com.br/MLB-123-produto', html: html('MLB999', 'Outro', 42, true, 'MLB999') },
    'https://meli.la/sem-id': { url: 'https://www.mercadolivre.com.br/loja', html: '<html>sem produto</html>' },
    'https://meli.la/sem-preco': { url: 'https://www.mercadolivre.com.br/MLB-555-produto', html: html('MLB555', 'Sem preÃ§o', null) },
    'https://meli.la/sem-imagem': { url: 'https://www.mercadolivre.com.br/MLB-666-produto', html: html('MLB666', 'Sem imagem', 42, false) },
  }
  const resultado = await resolverLoteAfiliado(['http://meli.la/a', ...Object.keys(paginas)], async () => [], mock(paginas))
  assert.deepEqual(resultado.map((item) => item.status), ['erro', 'link_nao_validado', 'link_nao_validado', 'erro', 'erro'])
})
