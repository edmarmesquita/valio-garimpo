import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { validarDestinoAfiliado, resolverItemId, extrairItemPrincipal } = await vite.ssrLoadModule('/server/validarDestinoAfiliado.ts')
const { publicarProduto } = await vite.ssrLoadModule('/server/services/supabase.ts')
const { criarPreviaLinks, confirmarLinksLote } = await vite.ssrLoadModule('/server/linksAfiliadosLote.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
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

const social = (id, nome = 'Mesa &amp; cadeiras') => `<meta property="og:title" content="${nome}">
  <a href="https://www.mercadolivre.com.br/mesa/up/MLBU1459681541?pdp_filters=item_id%3A${id}&amp;x=1#&amp;wid=${id}">${nome}</a>
  <a href="https://produto.mercadolivre.com.br/MLB-999-recomendacao-_JM">Outra recomendação</a>`

test('social extrai produto correspondente a og:title e ignora recomendações', () => {
  assert.equal(extrairItemPrincipal(social(mesa), 'https://www.mercadolivre.com.br/social/perfil'), mesa)
  assert.equal(extrairItemPrincipal(social(sutia, 'Sutiã'), 'https://www.mercadolivre.com.br/social/perfil'), sutia)
  assert.equal(extrairItemPrincipal(social(mesa) + social(sutia), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal(social(mesa).replace(`wid=${mesa}`, `wid=${sutia}`), 'https://www.mercadolivre.com.br/social/perfil'), null)
  assert.equal(extrairItemPrincipal('<a href="https://produto.mercadolivre.com.br/MLB-999-rec-_JM">Recomendação</a>', 'https://www.mercadolivre.com.br/social/perfil'), null)
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
