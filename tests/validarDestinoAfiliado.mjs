import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { validarDestinoAfiliado, resolverItemId, extrairItemPrincipal } = await vite.ssrLoadModule('/server/validarDestinoAfiliado.ts')
const { publicarProduto } = await vite.ssrLoadModule('/server/services/supabase.ts')
const { criarPreviaLinks, confirmarLinksLote } = await vite.ssrLoadModule('/server/linksAfiliadosLote.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { processarRetornoGerador, associarLinksPorItemId } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
const { identificarDestinosLote } = await vite.ssrLoadModule('/src/lib/manutencaoVitrine.ts')
const { prepararPublicacaoNovos } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/prepararPublicacaoNovos.ts')
const { criarPreviaOfertas, confirmarPreviaOfertas } = await vite.ssrLoadModule('/server/ofertasRelampagoLote.ts')
const mesa = 'MLB3784146413', sutia = 'MLB6456132876'
const correto = 'https://meli.la/18tT2n1', errado = 'https://meli.la/1pJuu6t'
const eventos = []
const validar = (id, link, origem) => validarDestinoAfiliado(id, link, origem,
  async (url) => url === correto ? mesa : url === errado ? sutia : null, (e) => eventos.push(e))
const produto = { mercadoLivreId: mesa, titulo: 'Mesa', descricao: '', preco: 2948,
  dataPreco: '27/10/2026', linkAfiliado: correto, categoria: 'Achados para Casa', rating: null,
  imagem: 'https://http2.mlstatic.com/mesa.webp' }

test('mesmo ITEM_ID permite; outro ITEM_ID bloqueia com mensagem explícita', async () => {
  await validar(mesa, correto, 'teste')
  await assert.rejects(() => validar(mesa, errado, 'teste'), new RegExp(`${sutia}.*${mesa}`))
})

test('destino não validável, resolver indisponível ou identificador inválido bloqueiam', async () => {
  for (const resolver of [async () => null, async () => { throw Error('segredo') }, async () => 'MLBU123']) {
    await assert.rejects(() => validarDestinoAfiliado(mesa, correto, 'teste', resolver, () => {}), /não validado/)
  }
})

test('auditoria registra entrada, origem, identidade, resultado e horário sem query/credenciais', async () => {
  const logs = []
  await validarDestinoAfiliado(mesa, correto, 'publicacao:recebido', async () => mesa, (e) => logs.push(e))
  assert.deepEqual(Object.keys(logs[0]).sort(), ['itemId', 'linkAfiliadoRecebido', 'origem', 'itemIdResolvido', 'resultado', 'timestamp'].sort())
  assert.equal(logs[0].linkAfiliadoRecebido, correto)
  assert.equal(logs[0].resultado, 'COMPATIVEL')
  assert.ok(Number.isFinite(Date.parse(logs[0].timestamp)))
  await validarDestinoAfiliado(mesa, 'https://www.mercadolivre.com.br/social/perfil?ref=SEGREDO#token=SEGREDO', 'teste', async () => mesa, (e) => logs.push(e))
  await assert.rejects(() => validarDestinoAfiliado(mesa, 'https://user:SEGREDO@meli.la/abc', 'teste', async () => null, (e) => logs.push(e)))
  assert.ok(!JSON.stringify(logs).includes('SEGREDO'))
})

const social = (id, nome = 'Mesa &amp; cadeiras', titulo = nome) => `<meta property="og:title" content="${titulo}">
  <section class="rl-card-featured"><section class="rl-list-single">
  <a href="https://www.mercadolivre.com.br/mesa/up/MLBU1459681541?pdp_filters=item_id%3A${id}&amp;x=1#&amp;wid=${id}">${nome}</a>
  </section></section><section class="rl-carousel-by-type">
  <a href="https://produto.mercadolivre.com.br/MLB-999-recomendacao-_JM">${nome}</a></section>`

test('1wFhmcR: HTML com preço extra em og:title valida ITEM_ID técnico do produto principal', async () => {
  const html = readFileSync(new URL('./fixtures/1wFhmcR-social.html', import.meta.url), 'utf8')
  const pagina = 'https://www.mercadolivre.com.br/social/ee20260414070618?matt_word=valiosite'
  assert.equal(extrairItemPrincipal(html, pagina), 'MLB3658105805')
  assert.equal(await resolverItemId('https://meli.la/1wFhmcR', async (url) => url.includes('meli.la')
    ? new Response(null, { status: 301, headers: { location: pagina } })
    : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })), 'MLB3658105805')
})

test('social usa IDs do destaque, não exige og:title e ignora recomendações', () => {
  assert.equal(extrairItemPrincipal(social(mesa), 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal(social(sutia, 'Sutiã'), 'https://www.mercadolivre.com.br/social/perfil'), sutia)
  assert.equal(extrairItemPrincipal(social(mesa) + social(sutia), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace(`wid=${mesa}`, `wid=${sutia}`), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal('<a href="https://produto.mercadolivre.com.br/MLB-999-rec-_JM">Recomendação</a>', 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa, 'Mesa', 'Sutiã promocional - R$ 10'), 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal(social(mesa).replace(/<meta[^>]*>/, ''), 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal('<section class="rl-card-featured"><a href="https://www.mercadolivre.com.br/social/perfil">Mesa</a></section>', 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace(`wid=${mesa}`, `wid=${sutia}`), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace('MLBU1459681541', 'MLBU1451720997').replace(`wid=${mesa}`, `wid=${sutia}`), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace('<section class="rl-list-single">', `<section class="rl-list-single"><div data-item-id="${mesa}" data-other="x"></div>`), 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal(social(mesa).replace('<section class="rl-list-single">', `<section class="rl-list-single"><div data-item-id="${sutia}"></div>`), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal('<section class="rl-card-featured"><script type="application/json">{"metadata":{"id":"MLB3784146413"},"userProductId":"MLBU1451720997"}</script></section>', 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal(`<section class="rl-card-featured"><script type="application/json">{"metadata":{"id":"${mesa}"},"itemId":"${sutia}"}</script></section>`, 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace('<section class="rl-list-single">', '<section class="rl-list-single"><script type="application/json">{"userProductId":"MLBU999"}</script>'), 'https://www.mercadolivre.com.br/social/perfil'), null)
})

test('título igual ou parecido não autoriza ITEM_ID diferente; título diferente não bloqueia ITEM_ID igual', async () => {
  const pagina = 'https://www.mercadolivre.com.br/social/perfil'
  await validarDestinoAfiliado(mesa, correto, 'teste', async () => extrairItemPrincipal(social(mesa, 'Mesa A', 'Outro título com preço'), pagina), () => {})
  for (const titulo of ['Mesa A', 'Mesa A ligeiramente diferente']) {
    await assert.rejects(() => validarDestinoAfiliado(mesa, errado, 'teste',
      async () => extrairItemPrincipal(social(sutia, 'Mesa A', titulo), pagina), () => {}), new RegExp(`${sutia}.*${mesa}`))
  }
})

test('PDP exige canonical de anúncio compatível; catálogo e HTML ambíguo não comprovam ID', () => {
  const url = `https://produto.mercadolivre.com.br/MLB-3784146413-mesa-_JM`
  assert.equal(extrairItemPrincipal(`<link rel="canonical" href="${url}">`, url), mesa)
  assert.equal(extrairItemPrincipal(`<link rel="canonical" href="${url}">`, 'https://produto.mercadolivre.com.br/MLB-6456132876-sutia-_JM'), null)
  assert.equal(extrairItemPrincipal(`<link rel="canonical" href="${url}">`, `${url}?wid=${sutia}`), null)
  assert.equal(extrairItemPrincipal(`<link rel="canonical" href="${url}"><link rel="canonical" href="${url}">`, url), null)
  assert.equal(extrairItemPrincipal('<link rel="canonical" href="https://www.mercadolivre.com.br/p/MLB123">', 'https://www.mercadolivre.com.br/p/MLB123'), null)
})

test('resolve 301 e HTML principal; protege host, protocolo, credenciais e loops', async () => {
  const urls = []
  assert.equal(await resolverItemId(correto, async (url, options) => {
    urls.push(url); assert.equal(options.redirect, 'manual')
    return urls.length === 1 ? new Response(null, { status: 301, headers: { location: 'https://www.mercadolivre.com.br/social/perfil' } })
      : new Response(social(mesa), { headers: { 'content-type': 'text/html' } })
  }), mesa)
  for (const destino of ['http://meli.la/abc', 'https://127.0.0.1/', 'https://meli.la.evil.test/', 'https://user:pass@meli.la/abc', 'https://meli.la:444/abc']) {
    let chamadas = 0
    assert.equal(await resolverItemId(correto, async () => {
      chamadas++; return new Response(null, { status: 302, headers: { location: destino } })
    }), null)
    assert.equal(chamadas, 1)
  }
  let saltos = 0
  assert.equal(await resolverItemId(correto, async () => { saltos++; return new Response(null, { status: 302, headers: { location: correto } }) }), null)
  assert.equal(saltos, 6)
})

test('bloqueio HTTP, desafio, JSON, HTML grande e falha de rede não inventam identidade', async () => {
  for (const responder of [
    () => new Response('bloqueado', { status: 403 }),
    () => new Response('captcha', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('a'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } }),
    () => { throw Error('rede') },
  ]) assert.equal(await resolverItemId(correto, responder), null)
})

test('publicação nova e upsert incompatíveis não gravam; fluxo correto preserva link exato', async () => {
  const escritas = []
  const gateway = { obterLinkAfiliado: async () => null, inserir: async (r) => escritas.push(r), upsert: async (r) => escritas.push(r) }
  for (const novo of [true, false]) {
    await assert.rejects(() => publicarProduto({ ...produto, linkAfiliado: errado }, gateway, novo, validar), /incompatível/)
    await assert.rejects(() => publicarProduto({ ...produto, linkAfiliado: 'https://meli.la/desconhecido' }, gateway, novo, validar), /não validado/)
  }
  assert.equal(escritas.length, 0)
  assert.equal(await publicarProduto(produto, gateway, true, validar), 'criado')
  assert.equal(escritas[0].link_afiliado, correto)
})

test('lote do Gerador com links trocados: prévia detecta os dois e impede classificação como novos', async () => {
  const retorno = processarRetornoGerador([{ itemId: mesa }, { itemId: sutia }], `${errado}\n${correto}`)
  assert.equal(retorno.consistente, true) // sintaxe/quantidade não comprovam associação
  const previa = await criarPreviaLinks(retorno.blocoAtualizador, { buscar: async () => [] }, validar)
  assert.ok(previa.linhas.every((r) => r.motivo.includes('incompatível')))
  assert.equal(prepararPublicacaoNovos(retorno, previa, new Map()).novos.length, 0)
})

test('lote fora de ordem associa pelo ITEM_ID técnico, não pela posição', async () => {
  const bruto = processarRetornoGerador([{ itemId: mesa }, { itemId: sutia }], `${errado}\n${correto}`)
  const associado = associarLinksPorItemId(bruto, [sutia, mesa])
  assert.equal(associado.blocoAtualizador, `${mesa} | ${correto}\n${sutia} | ${errado}`)
  assert.deepEqual(associado.pareamentos.map((p) => p.retorno.link), [correto, errado])
  const previa = await criarPreviaLinks(associado.blocoAtualizador, { buscar: async () => [] }, validar)
  assert.ok(previa.linhas.every((linha) => /Produto não encontrado/.test(linha.motivo)))
  assert.throws(() => associarLinksPorItemId(bruto, [null, mesa]), /não validado/)
  assert.throws(() => associarLinksPorItemId(bruto, [mesa, mesa]), /mais de um link/)
  assert.throws(() => associarLinksPorItemId(bruto, ['MLB999', mesa]), /ausente/)
})

test('identificação em lotes consulta blocos de até 50 e conserva posição da resposta', async () => {
  const chamadas = []
  const links = Array.from({ length: 51 }, (_, indice) => `https://meli.la/${indice + 100}`)
  const ids = await identificarDestinosLote(links, 'token-de-teste', async (_url, options) => {
    const bloco = JSON.parse(options.body).links
    chamadas.push(bloco)
    return { ok: true, json: async () => ({ ok: true, destinos: bloco.map((link) => `MLB${new URL(link).pathname.slice(1)}`) }) }
  })
  assert.deepEqual(chamadas.map((bloco) => bloco.length), [50, 1])
  assert.deepEqual(ids, links.map((link) => `MLB${new URL(link).pathname.slice(1)}`))
})

test('API de identificação responde por link, falha fechada e não grava', async () => {
  let escritas = 0
  const token = 'token-de-teste-longo-com-mais-de-32-caracteres'
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({
    token: () => token, config: () => ({ url: 'https://teste.supabase.co', serviceRoleKey: 'segredo-falso' }),
    resolverDestino: async (link) => link === correto ? mesa : link === errado ? sutia : null,
    linkAfiliado: () => ({ buscar: async () => [], atualizar: async () => { escritas++ } }),
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos/links-afiliados/identificar`
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const resposta = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ links: [correto, errado, 'https://meli.la/desconhecido'] }) })
    assert.equal(resposta.status, 200)
    assert.deepEqual((await resposta.json()).destinos, [mesa, sutia, null])
    assert.equal((await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ links: ['https://example.com/fora'] }) })).status, 400)
    assert.equal(escritas, 0)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('prévia valida também novos; link não validado não se torna produto novo', async () => {
  const previa = await criarPreviaLinks(`${mesa} | https://meli.la/desconhecido`, { buscar: async () => [] }, validar)
  assert.match(previa.linhas[0].motivo, /não validado/)
})

test('confirmação revalida destino mesmo com prévia anterior válida', async () => {
  let escritas = 0
  const gateway = { buscar: async () => [{ mercado_livre_id: mesa, titulo: 'Mesa', link_afiliado: 'anterior' }], atualizar: async () => { escritas++; return [] } }
  const resultado = await confirmarLinksLote(`${mesa} | ${errado}`, [{ linha: 1, mercado_livre_id: mesa, link_anterior: 'anterior' }], gateway, validar)
  assert.equal(escritas, 0)
  assert.match(resultado.falhas[0].motivo, /incompatível/)
})

test('API bloqueia publicação e PATCH individual com 422 e mensagem útil, sem gravação', async () => {
  let escritas = 0
  const app = express(); app.use(express.json())
  const token = 'token-de-teste-longo-com-mais-de-32-caracteres'
  app.use('/api/valio', criarRotaValioProdutos({ validarDestino: validar,
    token: () => token, config: () => ({ url: 'https://teste.supabase.co', serviceRoleKey: 'segredo-falso' }),
    gateway: () => ({ obterLinkAfiliado: async () => null, upsert: async () => { escritas++ } }),
    linkAfiliado: () => ({ buscar: async () => [{ mercado_livre_id: mesa, titulo: 'Mesa', link_afiliado: correto }], atualizar: async () => { escritas++; return [] } }),
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    for (const [path, method, body] of [
      ['/produtos', 'POST', { ...produto, linkAfiliado: errado }],
      ['/produtos/link-afiliado', 'PATCH', { mercado_livre_id: mesa, link_afiliado: errado }],
      ['/produtos', 'POST', { ...produto, linkAfiliado: 'https://meli.la/naovalidado' }],
    ]) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/valio${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(r.status, 422)
      assert.match((await r.json()).erro, /Link afiliado/)
    }
    assert.equal(escritas, 0)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('novo produto de ofertas não contorna a validação', async () => {
  let escritas = 0
  const gateway = { buscar: async () => [], listarAtivas: async () => [], inserir: async () => { escritas++ } }
  const previa = await criarPreviaOfertas({ modo: 'ENVIAR', itens: [{ tipo: 'NOVO_PRODUTO', dados: {
    mercadoLivreId: mesa, titulo: 'Mesa', preco: 2948, categoria: 'Achados para Casa', imagem: produto.imagem,
    linkAfiliado: errado, ofertaRelampago: true, ofertaInicio: null, ofertaFim: null,
    precoAnterior: null, percentualDesconto: null, textoOferta: null, prioridadeOferta: 0,
  } }] }, gateway)
  const resultado = await confirmarPreviaOfertas(previa, gateway, new Date(), [], validar)
  assert.equal(escritas, 0)
  assert.equal(resultado.erros, 1)
  assert.match(resultado.itens[0].motivo, /incompatível/)
})
