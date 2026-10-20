import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const fila = await vite.ssrLoadModule('/src/lib/revisaoPrecosLote.ts')
const { extrairPrecosHtml } = await vite.ssrLoadModule('/src/lib/extrairPrecosHtml.ts')
const auto = await vite.ssrLoadModule('/src/lib/revisaoAutomaticaPrecos.ts')
const { consultarPrecoAtual } = await vite.ssrLoadModule('/server/mercadoLivrePrecoAtual.ts')
const { consultarGrupoLimitado, consultarComRenovacao } = await vite.ssrLoadModule('/server/mercadoLivrePrecos.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
after(async () => vite.close())
const salvo = (id, preco = 100, dataPreco = '01/10/2026') => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco, dataPreco,
  categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}?aff=original`,
  imagem: `https://imagem.com/${id}`, rating: 4.8, ativo: true, updatedAt: '2026-10-01T10:00:00Z' })
const extraido = (id, preco, outros = {}) => ({ itemId: id, titulo: `Produto ${id}`, precoAtual: preco,
  imagemUrl: `https://imagem.com/${id}`, linkOriginal: `https://mercadolivre.com.br/${id}?aff=original`, avaliacao: 4.8, ...outros })

test('fonte oficial usa sale_price do marketplace, valida BRL e trata 404, 403, retry e timeout', async () => {
  const resposta = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
  const urls = []
  const enviar = async (url, options) => {
    urls.push(url)
    assert.equal(options.headers.authorization, 'Bearer token-teste')
    assert.equal(options.signal instanceof AbortSignal, true)
    return resposta(200, { amount: 149.9, currency_id: 'BRL', regular_amount: 200 })
  }
  assert.deepEqual(await consultarPrecoAtual('MLB1', 'token-teste', enviar),
    { itemId: 'MLB1', situacao: 'OK', preco: 149.9, motivo: null })
  assert.deepEqual(urls, ['https://api.mercadolibre.com/items/MLB1/sale_price?context=channel_marketplace'])
  assert.equal((await consultarPrecoAtual('MLB2', 'token-teste', async () => resposta(404, {}))).situacao, 'NÃO ENCONTRADO')
  assert.equal((await consultarPrecoAtual('MLB2', 'token-teste', async () => resposta(403, {}))).situacao, 'REVISAR')
  assert.equal((await consultarPrecoAtual('MLB2', 'token-teste', async () => resposta(200, { amount: 20, currency_id: 'USD' }))).preco, null)
  let chamadas = 0
  const espera = async () => {}
  const recuperado = await consultarPrecoAtual('MLB3', 'token-teste', async () => {
    chamadas++
    return chamadas < 3 ? resposta(429, {}) : resposta(200, { amount: 110, currency_id: 'BRL' })
  }, espera)
  assert.equal(recuperado.preco, 110)
  assert.equal(chamadas, 3)
  chamadas = 0
  const timeout = await consultarPrecoAtual('MLB4', 'token-teste', async () => { chamadas++; throw new Error('timeout') }, espera)
  assert.equal(timeout.situacao, 'ERRO TEMPORÁRIO')
  assert.equal(chamadas, 3)
})

test('classificação automática protege oferta ativa, detecta oferta expirada e restaura progresso sem token', () => {
  const data = Date.parse('2026-10-19T12:00:00Z')
  const base = salvo('MLB1', 60)
  const consulta = { itemId: 'MLB1', situacao: 'OK', preco: 100, motivo: null }
  const ativo = auto.classificarConsulta({ ...base, ofertaRelampago: true, ofertaFim: '2026-10-20T00:00:00Z' }, consulta, data)
  assert.equal(ativo.status, 'REVISAR')
  assert.equal(auto.classificarConsulta({ ...base, ofertaRelampago: true, ofertaInicio: '2026-10-21T00:00:00Z' }, consulta, data).status, 'REVISAR')
  const expirado = auto.classificarConsulta({ ...base, ofertaRelampago: true, ofertaFim: '2026-10-18T00:00:00Z' }, consulta, data)
  assert.equal(expirado.status, 'PREÇO ALTERADO')
  assert.equal(expirado.possivelOfertaExpirada, true)
  assert.equal(auto.classificarConsulta(base, { ...consulta, preco: 60 }, data).status, 'PREÇO IGUAL')
  assert.equal(auto.classificarConsulta(base, { ...consulta, preco: 40 }, data).status, 'PREÇO ALTERADO')
  const salvoLocal = { versao: 1, ids: ['MLB1', 'MLB2'], resultados: { MLB1: expirado }, pilotoAprovado: true }
  assert.deepEqual(auto.restaurarRevisao({ getItem: () => JSON.stringify(salvoLocal) }), salvoLocal)
  assert.equal(JSON.stringify(salvoLocal).includes('token'), false)
})

test('consulta oficial limita a dois produtos simultâneos e mantém ordem por ITEM_ID', async () => {
  const ids = Array.from({ length: 5 }, (_, indice) => `MLB${indice + 1}`)
  let simultaneos = 0, maximo = 0
  const resultados = await consultarGrupoLimitado(ids, 'token-de-teste', async (itemId) => {
    simultaneos++; maximo = Math.max(maximo, simultaneos)
    await new Promise((resolve) => setTimeout(resolve, itemId === 'MLB1' ? 20 : 2))
    simultaneos--
    return { itemId, situacao: 'OK', preco: 100, motivo: null }
  })
  assert.equal(maximo, 2)
  assert.deepEqual(resultados.map((item) => item.itemId), ids)
})

test('consulta de preços bloqueia sem sessão, renova 401 uma vez e exige reconexão quando refresh falha', async () => {
  const config = { clientId: '6332151948097527', clientSecret: 'segredo-só-backend', redirectUri: 'https://example.com/api/mercadolivre/callback', secureCookie: true }
  const ids = ['MLB1', 'MLB2']
  const consulta = async (itemId, token) => token === 'antigo'
    ? { itemId, situacao: 'REVISAR', preco: null, motivo: '401', autenticacaoExpirada: true }
    : { itemId, situacao: 'OK', preco: 100, motivo: null }
  assert.deepEqual(await consultarComRenovacao(ids, 'sessao', config, async () => null, consulta), { tipo: 'sem_sessao' })
  const chamadas = []
  const renovada = await consultarComRenovacao(ids, 'sessao', config, async (_hash, _config, rejeitado) => {
    chamadas.push(rejeitado ?? null)
    return rejeitado ? 'novo' : 'antigo'
  }, consulta)
  assert.deepEqual(chamadas, [null, 'antigo'])
  assert.equal(renovada.tipo, 'ok')
  assert.deepEqual(renovada.resultados.map((item) => item.preco), [100, 100])
  assert.deepEqual(await consultarComRenovacao(ids, 'sessao', config,
    async (_hash, _config, rejeitado) => rejeitado ? null : 'antigo', consulta), { tipo: 'sem_sessao' })
  assert.deepEqual(await consultarComRenovacao(ids, 'sessao', config,
    async () => 'antigo', consulta), { tipo: 'rejeitada' })
})

test('cliente consulta no máximo cinco ITEM_IDs e recusa resposta fora de ordem', async () => {
  const ids = ['MLB1', 'MLB2']
  const enviar = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { itemIds: ids })
    return { ok: true, json: async () => ({ resultados: ids.map((itemId) => ({ itemId, situacao: 'OK', preco: 100, motivo: null })) }) }
  }
  assert.equal((await auto.consultarPrecosOficiais(ids, undefined, enviar)).length, 2)
  await assert.rejects(auto.consultarPrecosOficiais(Array.from({ length: 6 }, (_, i) => `MLB${i + 1}`), undefined, enviar), /1 a 5/)
  await assert.rejects(auto.consultarPrecosOficiais(ids, undefined, async () => ({ ok: true,
    json: async () => ({ resultados: ids.toReversed().map((itemId) => ({ itemId, situacao: 'OK', preco: 100 })) }) })), /inconsistente/)
})

const cardHtml = (id, atual, opcoes = {}) => ({ position: opcoes.position ?? 1, card: {
  unique_id: `${id}-${opcoes.position ?? 1}`,
  metadata: { id, url: `https://produto.mercadolivre.com.br/${id}-produto`, ...(opcoes.metadata ?? {}) },
  pictures: { pictures: [{ id: 'imagem' }] },
  components: [{ id: 'title', title: { text: `Produto ${id}` } },
    { id: 'price_v2', price: { ...(atual === null ? {} : { current_price: { value: atual } }),
      ...(opcoes.anterior ? { price_labels: [{ values: [{ key: 'previous_price', price: { value: opcoes.anterior } }] }] } : {}),
      ...(opcoes.desconto ? { discount_polylabel: { values: [{ pill: { text: opcoes.desconto } }] } } : {}) } },
    ...(opcoes.outroAtual ? [{ id: 'price', price: { current_price: { value: opcoes.outroAtual } } }] : [])],
} })
const htmlPrecos = (...items) => `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify({ appProps: { pageProps: {
  data: { items, polycardContext: {} },
} } })};</script>`

test('HTML usa preço atual por metadata.id e bloqueia ausente, conflito, ambiguidade e duplicata divergente', () => {
  const ids = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5']
  const extraidos = extrairPrecosHtml(htmlPrecos(
    cardHtml(ids[0], 90, { anterior: 120, position: 1 }),
    cardHtml(ids[1], 100, { position: 2 }),
    cardHtml(ids[2], null, { position: 3 }),
    cardHtml(ids[3], 80, { position: 4, metadata: { url_params: '?pdp_filters=item_id:MLB999' } }),
    cardHtml(ids[4], 70, { position: 5, outroAtual: 75 }),
    cardHtml(ids[0], 95, { position: 6 }),
  ))
  assert.equal(extraidos.encontrados, 6)
  assert.equal(extraidos.produtos.length, 5)
  assert.equal(extraidos.produtos.find((item) => item.itemId === 'MLB1').precoAtual, null)
  assert.equal(extraidos.produtos.find((item) => item.itemId === 'MLB1').precoAnterior, null)
  assert.equal(extraidos.produtos.find((item) => item.itemId === 'MLB2').precoAtual, 100)
  for (const id of ['MLB1', 'MLB3', 'MLB4', 'MLB5']) assert.match(extraidos.problemas.get(id), /PREÇO NÃO CONFIÁVEL|conflitante/)
  const unico = extrairPrecosHtml(htmlPrecos(cardHtml('MLB1', 90, { anterior: 120, desconto: '25% OFF' })))
  assert.equal(unico.produtos[0].precoAtual, 90)
  assert.equal(unico.produtos[0].precoAnterior, 120)
  assert.equal(unico.produtos[0].desconto, '25% OFF')
})

test('HTML recente substitui preço por ITEM_ID, identifica oferta expirada e mantém preço ambíguo fora da seleção', () => {
  const catalogo = [salvo('MLB1', 60, '18/10/2026'), salvo('MLB2', 100, '01/10/2026')]
  let lotes = fila.adicionarLote(fila.lotesVazios(), extrairPrecosHtml(htmlPrecos(cardHtml('MLB1', 60))).produtos,
    { fonte: 'html' })
  const novo = extrairPrecosHtml(htmlPrecos(cardHtml('MLB1', 100)))
  lotes = fila.adicionarLote(lotes, novo.produtos, { fonte: 'html', problemas: novo.problemas })
  assert.equal(lotes.atualizadosSessao, 1)
  assert.equal(lotes.produtos.get('MLB1').precoAtual, 100)
  const itens = fila.montarFila(catalogo, lotes, false, new Date(2026, 9, 19))
  assert.equal(itens.length, 2)
  assert.equal(itens[0].diferencaCentavos, 4000)
  assert.deepEqual([...fila.selecionarFila(itens, 'alterados')], ['MLB1'])
  const ambiguo = extrairPrecosHtml(htmlPrecos(cardHtml('MLB1', 100, { outroAtual: 110 })))
  lotes = fila.adicionarLote(lotes, ambiguo.produtos, { fonte: 'html', problemas: ambiguo.problemas })
  assert.equal(fila.montarFila(catalogo, lotes, false, new Date(2026, 9, 19))[0].diferencaCentavos, null)
})

test('JSON-LD de produto exige SKU MLB e oferta em BRL ligada ao próprio produto', () => {
  const ld = (produto) => `<script type="application/ld+json">${JSON.stringify(produto)}</script>`
  const valido = extrairPrecosHtml(ld({ '@type': 'Product', sku: 'MLB4167700535', name: 'Produto atual',
    url: 'https://produto.mercadolivre.com.br/MLB-4167700535-produto',
    offers: { price: '149.90', priceCurrency: 'BRL' } }))
  assert.equal(valido.produtos[0].precoAtual, 149.9)
  assert.equal(valido.urls.get('MLB4167700535')?.includes('MLB-4167700535'), true)
  const ambiguo = extrairPrecosHtml(ld({ '@type': 'Product', sku: 'MLB1', offers: [
    { price: 100, priceCurrency: 'BRL' }, { price: 110, priceCurrency: 'BRL' },
  ] }))
  assert.equal(ambiguo.produtos[0].precoAtual, null)
  assert.match(ambiguo.problemas.get('MLB1'), /ambíguos/)
  assert.throws(() => extrairPrecosHtml(ld({ '@type': 'Product', name: 'Sem SKU', offers: { price: 10, priceCurrency: 'BRL' } })), /ITEM_ID explícito/)
})

test('acumula lotes, substitui duplicata pelo mais recente e cruza 300 itens só por ITEM_ID', () => {
  const catalogo = Array.from({ length: 300 }, (_, i) => salvo(`MLB${i + 1}`))
  let lotes = fila.adicionarLote(fila.lotesVazios(), [extraido('MLB1', 95), extraido('MLB2', 100)])
  lotes = fila.adicionarLote(lotes, [extraido('MLB1', 90), extraido('MLB301', 20, { titulo: 'Produto MLB2' }), extraido(null, 10)])
  assert.deepEqual([lotes.lotes, lotes.brutos, lotes.produtos.size, lotes.duplicados], [2, 5, 3, 1])
  assert.equal(lotes.produtos.get('MLB1').precoAtual, 90)
  const itens = fila.montarFila(catalogo, lotes, false, new Date(2026, 9, 12))
  assert.equal(itens.length, 300)
  assert.equal(itens.filter((item) => item.extraido).length, 2)
  assert.equal(itens[0].diferencaCentavos, -1000)
  assert.equal(itens[1].diferencaCentavos, 0)
  assert.equal(itens[2].extraido, undefined)
  assert.deepEqual([...fila.selecionarFila(itens, 'alterados')], ['MLB1'])
  assert.deepEqual([...fila.selecionarFila(itens, 'encontrados')], ['MLB1', 'MLB2'])
  assert.equal(fila.selecionarFila(itens, 'limpar').size, 0)
  assert.equal(fila.filtrarFila(itens, 'nao-encontrados', 'antigos').length, 298)
  assert.equal(fila.lotesVazios().produtos.size, 0)
})

test('separa diferença de preço de alterações de título, imagem, link e rating; filtra idade', () => {
  const catalogo = [salvo('MLB1'), salvo('MLB2', 100, '03/10/2026'), salvo('MLB3', 100, '08/10/2026')]
  const lote = fila.adicionarLote(fila.lotesVazios(), [extraido('MLB1', 100, { titulo: 'Outro', imagemUrl: 'https://nova', linkOriginal: 'https://novo', avaliacao: 4.5 }), extraido('MLB2', 120)])
  const itens = fila.montarFila(catalogo, lote, false, new Date(2026, 9, 12))
  assert.equal(itens.length, 2)
  assert.equal(itens[0].diferencaCentavos, 0)
  assert.deepEqual(itens[0].outrosCampos, ['título', 'imagem', 'link', 'rating'])
  assert.equal(itens[1].diferencaCentavos, 2000)
  assert.deepEqual(itens[1].outrosCampos, [])
  assert.equal(fila.filtrarFila(itens, 'preco-igual', 'categoria').length, 1)
  assert.equal(fila.filtrarFila(itens, 'preco-alterado', 'maior-aumento').length, 1)
  assert.equal(fila.filtrarFila(itens, 'outros-dados', 'antigos').length, 1)
  assert.equal(fila.filtrarFila(itens, 'revisar-breve', 'antigos').length, 2)
  assert.equal(fila.montarFila(catalogo, lote, true, new Date(2026, 9, 12)).length, 3)
})

test('cliente divide 120 produtos em 50/50/20 e preserva erros parciais e segredo fora da resposta', async () => {
  const entradas = Array.from({ length: 120 }, (_, i) => ({ mercadoLivreId: `MLB${i + 1}`, preco: 10, atualizarPreco: true }))
  const tamanhos = []
  let chamadas = 0
  const enviar = async (url, options) => {
    assert.equal(url, '/api/valio/produtos/precos-lote')
    assert.equal(options.headers.Authorization, 'Bearer token-de-teste')
    const bloco = JSON.parse(options.body).produtos
    tamanhos.push(bloco.length); chamadas++
    if (chamadas === 2) throw new TypeError('Failed to fetch')
    return { ok: true, json: async () => ({ ok: true, resultados: bloco.map((item) => ({ mercadoLivreId: item.mercadoLivreId, status: 'atualizado', dataPreco: '12/10/2026', updatedAt: '2026-10-12T12:00:00Z' })) }) }
  }
  const resultados = await fila.enviarPrecosEmBlocos(entradas, 'token-de-teste', enviar)
  assert.deepEqual(tamanhos, [50, 50, 20])
  assert.equal(resultados.length, 120)
  assert.equal(resultados.filter((item) => item.status === 'atualizado').length, 70)
  assert.equal(resultados.filter((item) => item.status === 'erro').length, 50)
  assert.equal(JSON.stringify(resultados).includes('token-de-teste'), false)
  assert.deepEqual(fila.dividirEmBlocos(entradas).map((bloco) => bloco.length), [50, 50, 20])
})

test('rota valida lote e só atualiza produto existente; confirmação conserva preço e demais campos', async () => {
  const token = 'token-de-publicacao-de-teste-com-mais-de-32-caracteres'
  const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
  const linhas = new Map([['MLB1', salvo('MLB1')], ['MLB2', salvo('MLB2')]])
  const escritas = []
  const gateway = { async atualizarPreco(id, preco, dataPreco, updatedAt, confirmar, precoEsperado) {
    if (id === 'MLB4') throw new Error('Falha simulada do banco')
    const item = linhas.get(id)
    if (!item || (confirmar || precoEsperado !== undefined) && item.preco !== (precoEsperado ?? preco)) return false
    escritas.push({ id, preco, dataPreco, updatedAt, confirmar, precoEsperado })
    linhas.set(id, { ...item, preco: confirmar ? item.preco : preco, dataPreco, updatedAt })
    return true
  } }
  const app = express(); app.use(express.json()); app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token,
    agora: () => new Date('2026-10-13T02:30:00Z'), catalogo: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos/precos-lote`
    const req = async (produtos, bearer = token) => {
      const resposta = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ produtos }) })
      return { status: resposta.status, json: await resposta.json() }
    }
    const entrada = (id, preco, atualizarPreco) => ({ mercadoLivreId: id, preco, atualizarPreco })
    assert.equal((await req([entrada('MLB1', 90, true)], 'errado')).status, 401)
    assert.equal((await req([entrada('MLB1', 90, true), entrada('MLB1', 90, true)])).status, 400)
    assert.equal((await req([entrada('MLB1', 90, true), entrada('INVALIDO', 90, true)])).status, 400)
    assert.equal((await req(Array.from({ length: 51 }, (_, i) => entrada(`MLB${i + 1}`, 90, true)))).status, 400)
    assert.equal(escritas.length, 0)
    const resposta = await req([entrada('MLB1', 90, true), entrada('MLB2', 100, false), entrada('MLB3', 30, true), entrada('MLB2', 50, false)].slice(0, 3))
    assert.equal(resposta.status, 200)
    assert.deepEqual([resposta.json.atualizados, resposta.json.confirmados, resposta.json.erros], [1, 1, 1])
    assert.equal(resposta.json.resultados[0].dataPreco, '12/10/2026')
    assert.equal(linhas.size, 2)
    assert.equal(linhas.get('MLB1').preco, 90)
    assert.equal(linhas.get('MLB2').preco, 100)
    assert.equal(linhas.get('MLB1').linkAfiliado, salvo('MLB1').linkAfiliado)
    assert.equal(linhas.get('MLB1').titulo, salvo('MLB1').titulo)
    assert.equal(linhas.get('MLB1').ativo, true)
    const antesConflito = escritas.length
    const conflito = await req([{ mercadoLivreId: 'MLB1', preco: 95, atualizarPreco: true, precoEsperado: 100 }])
    assert.equal(conflito.json.erros, 1)
    assert.equal(escritas.length, antesConflito)
    assert.equal(linhas.get('MLB1').preco, 90)
    assert.equal(JSON.stringify(resposta.json).includes(config.serviceRoleKey), false)
    assert.equal(JSON.stringify(resposta.json).includes(token), false)
    assert.equal((await req([entrada('MLB2', 101, false)])).json.erros, 1)
    const parcial = await req([entrada('MLB1', 80, true), entrada('MLB4', 40, true)])
    assert.deepEqual([parcial.json.atualizados, parcial.json.erros], [1, 1])
    assert.equal(linhas.get('MLB1').preco, 80)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
