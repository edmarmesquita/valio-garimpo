import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })

test('vínculo do retorno preserva snapshot e links por ITEM_ID com URL diferente, reordenação e subconjuntos', async () => {
  const [{ vincularSnapshot }, { criarRegistroSnapshot }, { processarRetornoGerador }] = await Promise.all([
    vite.ssrLoadModule('/src/features/ofertas-relampago/vinculoSnapshot.ts'),
    vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts'),
    vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts'),
  ])
  const produtos = [1, 2].map((n) => ({ ordem: n, itemId: `MLB${n}`, titulo: `Produto ${n}`,
    urlOriginal: `https://produto.mercadolivre.com.br/MLB-${n}-produto`,
    urlNormalizada: `https://produto.mercadolivre.com.br/MLB-${n}-produto` }))
  const registro = criarRegistroSnapshot({ produtos }, '')
  const texto = 'https://meli.la/original1\nhttps://meli.la/original2'
  const retorno = processarRetornoGerador(registro.snapshot.produtos, texto)
  const original = JSON.stringify({ registro, retorno })
  const oferta = (n) => ({ itemId: `MLB${n}`, chave: `oferta-${n}`,
    urlOriginal: `https://www.mercadolivre.com.br/outro-slug/p/MLB99?pdp_filters=item_id:MLB${n}` })
  const atual = [oferta(2), oferta(1), oferta(3)]
  const vinculo = vincularSnapshot(registro, atual, retorno)
  assert.deepEqual(vinculo.idsSnapshot, ['MLB1', 'MLB2'])
  assert.deepEqual(vinculo.idsAtual, ['MLB2', 'MLB1', 'MLB3'])
  assert.deepEqual(vinculo.compativeis, ['MLB2', 'MLB1'])
  assert.deepEqual(vinculo.problemas.map((p) => p.itemId), ['MLB3'])
  assert.deepEqual(vinculo.urlsDiferentes, ['MLB2', 'MLB1'])
  assert.deepEqual(vinculo.retornoSeguro.pareamentos.map((p) => [p.produto.itemId, p.retorno.link]),
    [['MLB1', 'https://meli.la/original1'], ['MLB2', 'https://meli.la/original2']])
  const parcial = vincularSnapshot(registro, [oferta(2)], retorno)
  assert.deepEqual(parcial.somenteSnapshot, ['MLB1'])
  assert.equal(parcial.retornoSeguro.pareamentos[0].retorno.link, 'https://meli.la/original2')
  const conflito = vincularSnapshot(registro, [{ ...oferta(1), urlOriginal: produtos[1].urlOriginal }, oferta(2), oferta(2)], retorno)
  assert.equal(conflito.retornoSeguro.pareamentos.length, 0)
  assert.match(conflito.problemas[0].motivo, /outro ITEM_ID/)
  assert.match(conflito.problemas[1].motivo, /duplicado/)
  assert.equal(JSON.stringify({ registro, retorno }), original)
})
const [{ extrairOfertasRelampagoHtml }, { prepararOfertasSelecionadas }, { processarRetornoGerador }] = await Promise.all([
  vite.ssrLoadModule('/src/features/ofertas-relampago/extrairOfertas.ts'),
  vite.ssrLoadModule('/src/features/ofertas-relampago/prepararOfertas.ts'),
  vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts'),
])

const card = (id, position, { previous = 100, current = 60, discount = '40% OFF', end = null, title = `Produto ${position}` } = {}) => ({
  position,
  card: {
    unique_id: `card-${position}`,
    metadata: { id, user_product_id: `MLBU${position}`, product_id: `MLB9${position}`,
      url: `www.mercadolivre.com.br/produto-${position}/p/MLB9${position}`,
      url_params: `?pdp_filters=item_id%3A${id ?? 'SEM_ID'}` },
    pictures: { pictures: [{ id: `imagem-${position}` }] },
    components: [
      { id: 'title', title: { text: title } },
      { id: 'price_v2', price: {
        current_price: { value: current },
        ...(previous === null ? {} : { price_labels: [{ values: [{ key: 'previous_price', price: { value: previous } }] }] }),
        ...(discount === null ? {} : { discount_polylabel: { values: [{ pill: { text: discount } }] } }),
      } },
    ],
    ...(end ? { widget_components: [{ id: 'highlight', poly_label_component: { countdown: { period_end: end } } }] } : {}),
  },
})

const html = (items) => `<html><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify({ appProps: { pageProps: { data: {
  items, polycardContext: { picture_template: 'https://http2.mlstatic.com/D_Q_NP_{id}-AB.webp' },
} } } })};</script></html>`

test('agendamento interpreta 17/10/2026 09:30 em Brasília sem exigir fim', async () => {
  const { agendaIso } = await vite.ssrLoadModule('/src/features/ofertas-relampago/agendaOferta.ts')
  assert.equal(agendaIso('2026-10-17T09:30'), '2026-10-17T12:30:00.000Z')
  assert.equal(agendaIso(''), null)
})

const urlsReais = JSON.parse(readFileSync(new URL('./fixtures/ofertasRelampagoUrlsReais.json', import.meta.url), 'utf8'))

async function fixturePreparado() {
  const modulo = await vite.ssrLoadModule('/src/features/ofertas-relampago/lotePreparado.ts')
  const ofertas = extrairOfertasRelampagoHtml(html([card('MLB8001', 1, { end: '2099-01-01T00:00:00Z' }), card('MLB8002', 2, { end: '2099-01-01T00:00:00Z' })]))
  const produtos = ofertas.map((oferta, i) => ({ itemId: oferta.itemId, ordem: i + 1 }))
  const retorno = processarRetornoGerador(produtos, 'https://meli.la/salvo1\nhttps://meli.la/salvo2')
  const lote = modulo.criarLotePreparado(ofertas, new Set(['MLB8001', 'MLB8002']),
    new Map([['MLB8001', 'Achados para Elas'], ['MLB8002', 'Achados para Casa']]), new Map([['MLB8001', 100], ['MLB8002', 50]]),
    new Map(), new Set(['MLB8001', 'MLB8002']), retorno, new Set(), new Date('2026-10-16T12:00:00Z'))
  return { ...modulo, lote, ofertas, retorno }
}

test('lote preparado persiste dados e meli.la sem token, preview, assinatura ou dados extras', async () => {
  const { lote, ofertas, retorno, criarLotePreparado, salvarLotePreparado, lerLotePreparado, CHAVE_LOTE_PREPARADO } = await fixturePreparado()
  ofertas[0].token = 'segredo-nao-salvar'
  ofertas[0].dadosProduto.credencial = 'credencial-nao-salvar'
  const seguro = criarLotePreparado(ofertas, new Set(['MLB8001']), new Map([['MLB8001', 'Achados para Elas']]),
    new Map([['MLB8001', 100]]), new Map(), new Set(['MLB8001']), retorno, new Set())
  const dados = new Map()
  const storage = { setItem: (k, v) => dados.set(k, v), getItem: (k) => dados.get(k) ?? null }
  salvarLotePreparado(storage, seguro)
  const bruto = dados.get(CHAVE_LOTE_PREPARADO)
  assert.doesNotMatch(bruto, /segredo-nao-salvar|credencial-nao-salvar|assinatura|preview|token/)
  assert.equal(lerLotePreparado(storage).lote.itens[0].categoria, 'Achados para Elas')
  assert.equal(lerLotePreparado(storage).lote.itens[0].prioridade, 100)
  assert.equal(lerLotePreparado(storage).lote.itens[0].linkMeli, 'https://meli.la/salvo1')
  const reiniciado = { getItem: (k) => JSON.parse(JSON.stringify(Object.fromEntries(dados)))[k] ?? null }
  assert.deepEqual(lerLotePreparado(reiniciado).lote, JSON.parse(bruto))
  assert.equal(lote.status, 'PREPARADO')
  assert.equal(lote.salvoEm, '2026-10-16T12:00:00.000Z')
  for (const alteracao of [{ schemaVersion: 2 }, { token: 'nao-permitido' }, { assinatura: 'nao-permitida' }, { status: 'INVENTADO' }]) {
    assert.equal(lerLotePreparado({ getItem: () => JSON.stringify({ ...lote, ...alteracao }) }).invalido, true)
  }
  assert.equal(lerLotePreparado({ getItem: () => '{invalido' }).invalido, true)
})

test('revalidação preparada bloqueia expirados e conflitos por item e preserva os válidos', async () => {
  const { lote, revalidarLotePreparado, payloadLotePreparado, concluirItensPreparados } = await fixturePreparado()
  lote.itens[1].ofertaFim = '2026-10-16T11:59:00Z'
  const validacao = revalidarLotePreparado(lote, new Map(), Date.parse('2026-10-16T12:00:00Z'))
  assert.equal(validacao.lote.status, 'PARCIALMENTE BLOQUEADO')
  assert.deepEqual(validacao.bloqueados, [{ itemId: 'MLB8002', motivo: 'Oferta expirada.' }])
  assert.equal(validacao.lote.itens[0].linkMeli, lote.itens[0].linkMeli)
  assert.equal(validacao.lote.itens[0].categoria, lote.itens[0].categoria)
  assert.equal(validacao.lote.itens[0].prioridade, 100)
  const payload = payloadLotePreparado([lote.itens[0]], new Map())
  assert.equal(payload.prontos[0].dados.linkAfiliado, 'https://meli.la/salvo1')
  assert.equal(payload.prontos[0].dados.categoria, 'Achados para Elas')
  assert.equal(payload.prontos[0].dados.prioridadeOferta, 100)
  const conflito = revalidarLotePreparado(lote, new Map([['MLB8001', { ativo: true }]]), Date.parse('2026-10-16T12:00:00Z'))
  assert.match(conflito.bloqueados[0].motivo, /passou a existir/)
  const parcial = concluirItensPreparados(lote, { erros: 1, conflitos: 0, itens: [
    { itemId: 'MLB8001', resultado: 'CRIADA' }, { itemId: 'MLB8002', resultado: 'ERRO' },
  ] })
  assert.equal(parcial.status, 'REVALIDAÇÃO NECESSÁRIA')
  assert.equal(parcial.itens[0].concluido, true)
  assert.equal(parcial.itens[1].concluido, false)
  const finalizado = concluirItensPreparados(parcial, { erros: 0, conflitos: 0, itens: [{ itemId: 'MLB8002', resultado: 'CRIADA' }] })
  assert.equal(finalizado.status, 'FINALIZADO')
})

test('lote preparado detecta alteração do catálogo, perda de produto, categoria ou meli.la sem sobrescrever dados', async () => {
  const { lote, ofertas, criarLotePreparado, revalidarLotePreparado } = await fixturePreparado()
  const existente = { mercadoLivreId: 'MLB8001', titulo: 'Título salvo no Valiô', preco: 60, categoria: 'Achados para Casa',
    imagem: 'https://img.test/salva.webp', ativo: true, linkAfiliado: 'https://meli.la/existente', dataPreco: '16/10/2026' }
  const registro = criarLotePreparado(ofertas, new Set(['MLB8001']), new Map(), new Map(), new Map([['MLB8001', existente]]),
    new Set(['MLB8001']), null, new Set())
  assert.equal(registro.itens[0].situacaoValio, 'EXISTENTE')
  assert.equal(revalidarLotePreparado(registro, new Map([['MLB8001', existente]])).lote.status, 'REVALIDADO')
  assert.match(revalidarLotePreparado(registro, new Map()).bloqueados[0].motivo, /Estado.*mudou/)
  for (const alteracao of [{ preco: 99 }, { ativo: false }, { linkAfiliado: 'https://meli.la/novo' }]) {
    assert.match(revalidarLotePreparado(registro, new Map([['MLB8001', { ...existente, ...alteracao }]])).bloqueados[0].motivo, /Estado.*mudou/)
  }
  const semDados = structuredClone(lote)
  semDados.itens[0].categoria = null
  semDados.itens[1].linkMeli = null
  const validacao = revalidarLotePreparado(semDados, new Map())
  assert.match(validacao.bloqueados[0].motivo, /categoria/)
  assert.match(validacao.bloqueados[1].motivo, /Gerador|meli.la/)
  assert.equal(existente.linkAfiliado, 'https://meli.la/existente')
  const revisar = structuredClone(lote)
  revisar.itens[0].situacaoOferta = 'REVISAR'
  revisar.itens[1].percentualDesconto = 150
  const inconsistentes = revalidarLotePreparado(revisar, new Map())
  assert.match(inconsistentes.bloqueados[0].motivo, /REVISAR/)
  assert.match(inconsistentes.bloqueados[1].motivo, /desconto inconsistente/)
})

test('gerenciamento reproduz ordenação estável, janelas e limite de 12 da Home', async () => {
  const { classificarOfertas } = await vite.ssrLoadModule('/src/features/ofertas-relampago/gerenciarOfertas.ts')
  const agora = Date.parse('2026-10-16T12:00:00Z')
  const base = (n, extras = {}) => ({ mercado_livre_id: `MLB${n}`, ativo: true, oferta_relampago: true,
    oferta_inicio: null, oferta_fim: '2026-10-17T12:00:00Z', prioridade_oferta: 0, ...extras })
  const produtos = Array.from({ length: 15 }, (_, i) => base(i + 1))
  produtos.push(base(16, { prioridade_oferta: 100 }), base(17, { oferta_fim: '2026-10-16T12:00:00Z' }),
    base(18, { oferta_inicio: '2026-10-17T00:00:00Z' }), base(19, { oferta_fim: null }),
    base(20, { ativo: false }), base(21, { oferta_relampago: false }))
  const resultado = classificarOfertas(produtos, agora)
  assert.equal(resultado.filter((p) => p.naHome).length, 12)
  assert.equal(resultado.filter((p) => p.naFila).length, 5)
  assert.deepEqual(resultado.filter((p) => p.naHome).map((p) => p.mercado_livre_id), ['MLB16', ...Array.from({ length: 11 }, (_, i) => `MLB${i + 1}`)])
  assert.equal(resultado.find((p) => p.mercado_livre_id === 'MLB17').situacao, 'EXPIRADA')
  assert.equal(resultado.find((p) => p.mercado_livre_id === 'MLB18').situacao, 'AGENDADA')
  assert.equal(resultado.find((p) => p.mercado_livre_id === 'MLB19').situacao, 'SEM PRAZO EXATO')
  assert.equal(resultado.find((p) => p.mercado_livre_id === 'MLB20').ativa, false)
  assert.equal(resultado.find((p) => p.mercado_livre_id === 'MLB21').situacao, 'DESATIVADA')
  assert.equal(classificarOfertas([base(1, { oferta_fim: '2026-10-16' })], new Date(2026, 9, 16, 23, 59).getTime())[0].ativa, true)
  assert.equal(classificarOfertas([base(1, { oferta_fim: '2026-10-16' })], new Date(2026, 9, 17).getTime())[0].situacao, 'EXPIRADA')
  assert.equal(classificarOfertas([base(1, { oferta_inicio: '2026-10-16T12:00:00Z' })], agora)[0].situacao, 'ATIVA')
})

test('controle Home/Fila troca produtos específicos e resolve mais de 12 fixadas sem afetar prioridade automática', async () => {
  const { classificarOfertas } = await vite.ssrLoadModule('/src/features/ofertas-relampago/gerenciarOfertas.ts')
  const produtos = Array.from({ length: 15 }, (_, i) => ({ mercado_livre_id: `MLB${i}`, titulo: i === 0 ? 'Gemini' : i === 14 ? 'Colchão' : `Produto ${i}`,
    ativo: true, oferta_relampago: true, oferta_inicio: null, oferta_fim: null, prioridade_oferta: 0, home_oferta_mode: 'auto' }))
  const antes = classificarOfertas(produtos, Date.now())
  assert.deepEqual(antes.filter((p) => p.naHome).map((p) => p.mercado_livre_id), Array.from({ length: 12 }, (_, i) => `MLB${i}`))
  produtos[0].home_oferta_mode = 'fila'
  produtos[14].home_oferta_mode = 'fixada'
  produtos[13].prioridade_oferta = 100
  const depois = classificarOfertas(produtos, Date.now())
  assert.equal(depois.find((p) => p.titulo === 'Colchão').naHome, true)
  assert.equal(depois.find((p) => p.titulo === 'Gemini').naFila, true)
  assert.equal(depois.find((p) => p.mercado_livre_id === 'MLB13').naHome, true)
  assert.equal(depois.filter((p) => p.ativa).length, 15)
  assert.ok(depois.every((p) => p.ativo && p.oferta_relampago))
  const fixadas = classificarOfertas(produtos.map((p) => ({ ...p, home_oferta_mode: 'fixada' })), Date.now())
  assert.equal(fixadas.filter((p) => p.naHome).length, 12)
  assert.deepEqual(fixadas.filter((p) => p.naHome).map((p) => p.mercado_livre_id), ['MLB13', ...Array.from({ length: 11 }, (_, i) => `MLB${i}`)])
})

test('regressão real MLB4857636451: /up/MLBU e wid do mesmo anúncio, comparado ao MLB5226420562', async () => {
  const { resolverUrlGerador } = await vite.ssrLoadModule('/src/features/ofertas-relampago/urlGerador.ts')
  const origem = 'https://www.mercadolivre.com.br/ofertas?container_id=relampago'
  const ofertas = extrairOfertasRelampagoHtml(html(urlsReais.items), origem)
  const blusas = ofertas.find((oferta) => oferta.itemId === 'MLB4857636451')
  const oculos = ofertas.find((oferta) => oferta.itemId === 'MLB5226420562')
  const metadata = urlsReais.items[0].card.metadata
  assert.equal(blusas.urlOriginal, `https://${metadata.url}${metadata.url_params}${metadata.url_fragments}`)
  assert.equal(new URL(blusas.urlOriginal).hash.includes('wid=MLB4857636451'), true)
  assert.equal(blusas.userProductId, 'MLBU4248401786')
  assert.equal(blusas.situacao, 'PRONTO')
  assert.equal(oculos.urlOriginal, `https://${urlsReais.items[1].card.metadata.url}`)
  for (const oferta of ofertas) {
    assert.equal(resolverUrlGerador(oferta).url, oferta.urlOriginal)
    assert.ok(!oferta.urlOriginal.includes('meli.la'))
    assert.ok(!new URL(oferta.urlOriginal).pathname.startsWith('/ofertas'))
  }
})

test('user product real sem wid, com wid conflitante ou MLBU divergente permanece bloqueado', () => {
  for (const alteracoes of [
    { url_fragments: '#polycard_client=offers' },
    { url_fragments: '#wid=MLB5226420562' },
    { url_fragments: '#wid=MLB4857636451&wid=MLB5226420562' },
    { user_product_id: 'MLBU999999' },
    { url: 'www.mercadolivre.com.br/ofertas', url_fragments: '#wid=MLB4857636451' },
  ]) {
    const item = structuredClone(urlsReais.items[0])
    Object.assign(item.card.metadata, alteracoes)
    assert.equal(extrairOfertasRelampagoHtml(html([item]))[0].urlOriginal, null)
  }
  const relativo = structuredClone(urlsReais.items[0])
  relativo.card.metadata.url = new URL(`https://${relativo.card.metadata.url}`).pathname
  const oferta = extrairOfertasRelampagoHtml(html([relativo]), 'https://www.mercadolivre.com.br/ofertas')[0]
  assert.ok(oferta.urlOriginal?.includes('/up/MLBU4248401786'))
  assert.equal(new URL(oferta.urlOriginal).hash.includes('wid=MLB4857636451'), true)
})

test('extrai várias ofertas do JSON Nordic real, sem inventar ITEM_ID ou horário', () => {
  const offers = extrairOfertasRelampagoHtml(html([
    card('MLB123', 1, { end: '2026-10-16T03:00:00Z' }),
    card('MLB456', 2, { previous: null, discount: null }),
    card('MLB123', 3),
    card(null, 4),
    card('MLB789', 5, { current: null, discount: null, previous: null }),
    { ...card('MLB999', 6), card: { ...card('MLB999', 6).card,
      metadata: { ...card('MLB999', 6).card.metadata, url_params: '?pdp_filters=item_id%3AMLB111' } } },
  ]))
  assert.equal(offers.length, 5)
  assert.deepEqual(offers.map((offer) => offer.posicao), [1, 2, 4, 5, 6])
  assert.equal(offers[0].itemId, 'MLB123')
  assert.equal(offers[0].userProductId, 'MLBU1')
  assert.equal(offers[0].productId, 'MLB91')
  assert.equal(offers[0].titulo, 'Produto 1')
  assert.equal(offers[0].precoAtual, 60)
  assert.equal(offers[0].precoAnterior, 100)
  assert.equal(offers[0].percentualDesconto, 40)
  assert.equal(offers[0].fonteDesconto, 'MERCADO LIVRE')
  assert.equal(offers[0].ofertaFim, '2026-10-16T03:00:00Z')
  assert.match(offers[0].imagem, /^https:/)
  assert.equal(offers[0].ofertaInicio, null)
  assert.equal(offers[1].precoAnterior, null)
  assert.equal(offers[1].percentualDesconto, null)
  assert.equal(offers[1].ofertaFim, null)
  assert.equal(offers[1].fonteTempo, null)
  assert.equal(offers[2].itemId, null)
  assert.equal(offers[2].situacao, 'SEM ITEM_ID')
  assert.equal(offers[3].situacao, 'SEM PREÇO')
  assert.equal(offers[4].situacao, 'REVISAR')
  assert.throws(() => extrairOfertasRelampagoHtml('<html>sem JSON</html>'), /não contém o JSON/)
})

test('URL estruturada do anúncio é normalizada sem parâmetros artificiais nem link afiliado', () => {
  const principal = card('MLB7614206226', 1)
  principal.card.metadata.url = ' www.mercadolivre.com.br/anuncio-real/p/MLB7614206226 '
  principal.card.metadata.affiliate_url = 'https://meli.la/nao-usar'
  principal.card.url = 'https://www.mercadolivre.com.br/outra-url'
  const alternativa = card('MLB456', 2)
  delete alternativa.card.metadata.url
  alternativa.card.permalink = '//www.mercadolivre.com.br/oferta-alternativa/p/MLB456'
  const [primeira, segunda] = extrairOfertasRelampagoHtml(html([principal, alternativa]))
  assert.equal(primeira.urlOriginal, 'https://www.mercadolivre.com.br/anuncio-real/p/MLB7614206226')
  assert.equal(segunda.urlOriginal, 'https://www.mercadolivre.com.br/oferta-alternativa/p/MLB456')
  assert.ok(!primeira.urlOriginal.includes('pdp_filters'))
  assert.ok(!primeira.urlOriginal.includes('meli.la'))
})

test('URL ausente ou inválida permanece ausente, sem inventar anúncio pelo ITEM_ID', () => {
  const semUrl = card('MLB7614206226', 1)
  delete semUrl.card.metadata.url
  semUrl.card.metadata.affiliate_url = 'https://meli.la/afiliado'
  const invalida = card('MLB789', 2)
  invalida.card.metadata.url = 'https://exemplo.invalid/produto'
  const [primeira, segunda] = extrairOfertasRelampagoHtml(html([semUrl, invalida]))
  assert.equal(primeira.urlOriginal, null)
  assert.equal(segunda.urlOriginal, null)
  assert.equal(primeira.itemId, 'MLB7614206226')
  assert.equal(primeira.situacao, 'PRONTO')
})

test('extrai URL individual em ordem de metadata, permalink, canonical e url/href do item/card', () => {
  const origem = 'https://www.mercadolivre.com.br/ofertas?container_id=relampago'
  for (const [alvo, campo] of [['metadata', 'url'], ['metadata', 'permalink'], ['card', 'permalink'],
    ['item', 'permalink'], ['metadata', 'canonical'], ['card', 'canonical'], ['item', 'canonical'],
    ['item', 'url'], ['item', 'href'], ['card', 'url'], ['card', 'href']]) {
    const oferta = card('MLB5357067365', 1)
    delete oferta.card.metadata.url
    const objeto = alvo === 'metadata' ? oferta.card.metadata : alvo === 'card' ? oferta.card : oferta
    objeto[campo] = '/produto-real/p/MLB5357067365'
    assert.equal(extrairOfertasRelampagoHtml(html([oferta]), origem)[0].urlOriginal,
      'https://www.mercadolivre.com.br/produto-real/p/MLB5357067365', `${alvo}.${campo}`)
  }
  const oferta = card('MLB123', 1)
  oferta.card.metadata.url = 'https://produto.mercadolivre.com.br/MLB-123-principal'
  oferta.card.permalink = 'https://produto.mercadolivre.com.br/MLB-123-alternativo'
  assert.equal(extrairOfertasRelampagoHtml(html([oferta]))[0].urlOriginal, oferta.card.metadata.url)
})

test('catálogo usa seletor real do HTML sem inventar parâmetros nem confundir product_id com ITEM_ID', () => {
  const oferta = card('MLB5357067365', 1)
  oferta.card.metadata.url = 'www.mercadolivre.com.br/produto/p/MLB987654'
  oferta.card.metadata.url_params = '?pdp_filters=item_id%3AMLB5357067365'
  const url = extrairOfertasRelampagoHtml(html([oferta]))[0].urlOriginal
  assert.equal(url, 'https://www.mercadolivre.com.br/produto/p/MLB987654?pdp_filters=item_id%3AMLB5357067365')
  delete oferta.card.metadata.url_params
  assert.equal(extrairOfertasRelampagoHtml(html([oferta]))[0].urlOriginal, null)
})

test('URL genérica, HTTP, terceiros, afiliada e conflito ITEM_ID x URL não viram URL individual', () => {
  for (const url of ['https://www.mercadolivre.com.br/ofertas?item_id=MLB123',
    'https://www.mercadolivre.com.br/ofertas/MLB123', 'https://www.mercadolivre.com.br/%6ffertas/MLB123',
    'http://produto.mercadolivre.com.br/MLB-123-produto', 'https://meli.la/14jMKEN',
    'https://exemplo.com/MLB123', 'https://produto.mercadolivre.com.br/MLB-456-outro',
    'https://www.mercadolivre.com.br/produto/p/MLB123?wid=MLB456']) {
    const oferta = card('MLB123', 1)
    oferta.card.metadata.url = url
    delete oferta.card.metadata.url_params
    assert.equal(extrairOfertasRelampagoHtml(html([oferta]))[0].urlOriginal, null, url)
  }
  const conflitante = card('MLB123', 1)
  conflitante.card.metadata.url = 'https://produto.mercadolivre.com.br/MLB-456-outro'
  conflitante.card.href = 'https://produto.mercadolivre.com.br/MLB-123-correto'
  assert.equal(extrairOfertasRelampagoHtml(html([conflitante]))[0].urlOriginal, null)
})

test('calcula desconto apenas a partir de dois preços reais e ignora timestamp sem fuso', () => {
  const [calculated, invalid] = extrairOfertasRelampagoHtml(html([
    card('MLB101', 1, { previous: 80, current: 60, discount: null }),
    card('MLB102', 2, { previous: 50, current: 60, discount: null, end: 'amanhã' }),
  ]))
  assert.equal(calculated.percentualDesconto, 25)
  assert.equal(calculated.fonteDesconto, 'CALCULADO')
  assert.equal(invalid.percentualDesconto, null)
  assert.equal(invalid.ofertaFim, null)
})

test('prévia separa existente e novo; preserva link oficial e bloqueia link direto, recusado e pausado', () => {
  const offers = extrairOfertasRelampagoHtml(html([card('MLB123', 1), card('MLB456', 2), card(null, 3)]))
  const selected = new Set(offers.map((offer) => offer.chave))
  const existing = new Map([['MLB123', { mercadoLivreId: 'MLB123', linkAfiliado: 'https://meli.la/existente' }]])
  const checked = new Set(['MLB123', 'MLB456'])
  const categories = new Map([['MLB456', 'Achados para Casa']])
  const batch = [{ ordem: 1, itemId: 'MLB456', titulo: 'Produto 2', urlNormalizada: offers[1].urlOriginal }]
  const returned = processarRetornoGerador(batch, 'https://meli.la/novo')
  const result = prepararOfertasSelecionadas(offers, selected, existing, checked, categories, returned)
  assert.equal(result.prontos.length, 2)
  assert.equal(result.bloqueados.length, 1)
  assert.equal(result.prontos[0].tipo, 'ATUALIZAR_OFERTA')
  assert.deepEqual(Object.keys(result.prontos[0].dados).sort(), [
    'mercadoLivreId', 'ofertaFim', 'ofertaInicio', 'ofertaRelampago', 'percentualDesconto', 'precoAnterior', 'textoOferta', 'prioridadeOferta',
  ].sort())
  assert.equal(result.prontos[1].tipo, 'NOVO_PRODUTO')
  assert.equal(result.prontos[1].dados.linkAfiliado, 'https://meli.la/novo')
  assert.equal(result.prontos[1].dados.ofertaRelampago, true)
  assert.equal(result.prontos[1].dados.prioridadeOferta, 0)
  assert.ok(!JSON.stringify(result.prontos).includes(offers[1].urlOriginal))
  for (const response of ['https://www.mercadolivre.com.br/p/MLB456',
    'Este produto não cumpre com os requisitos do Programa.', 'Este URL corresponde a um produto pausado.']) {
    const blocked = prepararOfertasSelecionadas(offers, selected, existing, checked, categories,
      processarRetornoGerador(batch, response))
    assert.equal(blocked.prontos.length, 1)
    assert.ok(blocked.bloqueados.some((item) => item.itemId === 'MLB456'))
  }
})

test('prioridade e desativação entram apenas na prévia de ofertas, sem alterar produto existente', () => {
  const offers = extrairOfertasRelampagoHtml(html([card('MLB123', 1), card('MLB456', 2)]))
  const selected = new Set(offers.map((offer) => offer.chave))
  const existing = new Map([['MLB123', { mercadoLivreId: 'MLB123', linkAfiliado: 'https://meli.la/existente',
    categoria: 'Achados para Casa', titulo: 'Título salvo', imagem: 'https://imagem.test/salva.webp' }]])
  const checked = new Set(['MLB123', 'MLB456'])
  const categories = new Map([['MLB456', 'Achados para Casa']])
  const retorno = processarRetornoGerador([{ ordem: 1, itemId: 'MLB456', titulo: 'Produto 2' }], 'https://meli.la/novo')
  const priorities = new Map([[offers[0].chave, 100], [offers[1].chave, 50]])
  const result = prepararOfertasSelecionadas(offers, selected, existing, checked, categories, retorno, priorities)
  assert.deepEqual(result.prontos.map((item) => item.dados.prioridadeOferta), [100, 50])
  assert.deepEqual(Object.keys(result.prontos[0].dados).sort(), [
    'mercadoLivreId', 'ofertaFim', 'ofertaInicio', 'ofertaRelampago', 'percentualDesconto', 'precoAnterior', 'textoOferta', 'prioridadeOferta',
  ].sort())
  assert.equal(result.prontos[1].dados.linkAfiliado, 'https://meli.la/novo')
  const disabled = prepararOfertasSelecionadas(offers, selected, existing, checked, categories, retorno, priorities,
    new Set([offers[0].chave]))
  assert.deepEqual(disabled.prontos[0].dados, { mercadoLivreId: 'MLB123', ofertaRelampago: false })
  assert.equal(JSON.stringify(disabled.prontos).includes('https://meli.la/existente'), false)
  assert.ok(!JSON.stringify(disabled.prontos[0]).includes('categoria'))
})

test('produto novo desativado é bloqueado e exige meli.la para ativação', () => {
  const [offer] = extrairOfertasRelampagoHtml(html([card('MLB456', 1)]))
  const selected = new Set([offer.chave]); const checked = new Set(['MLB456'])
  const categories = new Map([['MLB456', 'Achados para Casa']])
  const stopped = prepararOfertasSelecionadas([offer], selected, new Map(), checked, categories, null, new Map(), selected)
  assert.equal(stopped.prontos.length, 0)
  assert.match(stopped.bloqueados[0].motivo, /Somente produto existente/)
  const noLink = prepararOfertasSelecionadas([offer], selected, new Map(), checked, categories, null)
  assert.equal(noLink.prontos.length, 0)
  assert.match(noLink.bloqueados[0].motivo, /Retorno do Gerador ausente/)
})

test('interface seleciona, verifica, prepara prévia e limpa somente ofertas atuais', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/ofertas-relampago' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  dom.window.localStorage.setItem('valio-garimpa:affiliate-batch-snapshot:v1', 'snapshot-existente')
  const scrolls = []
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
    assert.equal(this.isConnected, true)
    assert.deepEqual(options, { behavior: 'smooth', block: 'start' })
    scrolls.push(this)
  }
  const calls = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (...args) => {
      calls.push(args)
      const [url] = args
      if (url.endsWith('/prever')) return { ok: true, json: async () => ({ ok: true,
        assinatura: 'assinatura-teste', previa: { modo: 'ATIVAR', emitidaEm: Date.now(), ativasNaPrevia: [],
          desativarAtuais: 0, ativarSelecionadas: 2, operacoes: [
            { itemId: 'MLB123', produto: 'Produto 1', situacaoAtual: 'PRODUTO SEM OFERTA', acao: 'ATIVAR',
              prioridade: 0, precoAnterior: 100, precoAtual: 60, percentualDesconto: 40, ofertaFim: null,
              resultadoEsperado: 'Campos de oferta atualizados.' },
            { itemId: 'MLB456', produto: 'Produto 2', situacaoAtual: 'NOVO PRODUTO', acao: 'CRIAR COMO OFERTA',
              prioridade: 0, precoAnterior: 100, precoAtual: 60, percentualDesconto: 40, ofertaFim: null,
              resultadoEsperado: 'Produto criado como oferta.' },
          ] } }) }
      if (url.endsWith('/confirmar')) return { ok: true, json: async () => ({ ok: true, criadas: 0,
        ativadas: 1, atualizadas: 0, desativadas: 0, semAlteracao: 0, conflitos: 0, erros: 1,
        itens: [{ itemId: 'MLB123', resultado: 'ATIVAR' }, { itemId: 'MLB456', resultado: 'ERRO',
          motivo: 'code: 23514 | message: data_preco viola produtos_data_preco_check' }] }) }
      return { ok: true, json: async () => ({ ok: true, existentes: [{
        mercadoLivreId: 'MLB123', linkAfiliado: 'https://meli.la/existente', categoria: 'Achados para Casa',
      }] }) }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'),
      vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token: 'token-teste', setToken: () => {}, diagnostico: null, setDiagnostico: () => {} } }, createElement(Page))))
    const query = (selector) => dom.window.document.querySelector(selector)
    const button = (label) => [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
    const click = async (element) => act(async () => element.click())
    const fill = async (element, value) => act(async () => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set
      setter.call(element, value)
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(query('label[for="flash-origem"]').textContent, 'URL da página de origem')
    assert.match(query('#flash-origem-ajuda').textContent, /Recomendada.*produtos novos/)
    assert.equal(query('#flash-origem').required, false)
    await fill(query('#flash-html'), html([card('MLB123', 1), card('MLB456', 2)]))
    await click(button('Extrair ofertas'))
    assert.equal(dom.window.document.querySelectorAll('.flash-table tbody tr').length, 2)
    const visibleRows = () => [...dom.window.document.querySelectorAll('.flash-preview .flash-table tbody tr')]
    const visibleIds = () => visibleRows().map((row) => row.cells[2].textContent)
    const statusOf = (id) => visibleRows().find((row) => row.cells[2].textContent === id)?.querySelector('.flash-status')?.textContent
    const filter = async (value) => act(async () => {
      const select = query('#flash-filtro-valio')
      select.value = value
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    assert.equal(statusOf('MLB123'), 'NÃO VERIFICADO')
    assert.equal(statusOf('MLB456'), 'NÃO VERIFICADO')
    assert.match(query('.flash-selecionadas').textContent, /Nenhuma oferta selecionada/)
    await click(button('Selecionar todas válidas'))
    assert.equal(dom.window.document.querySelectorAll('.flash-table input:checked').length, 2)
    await click(button('Limpar seleção'))
    assert.equal(dom.window.document.querySelectorAll('.flash-table input:checked').length, 0)
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], '/api/valio/produtos/verificar')
    assert.equal(calls[0][1].method, 'POST')
    assert.equal(statusOf('MLB123'), 'JÁ EXISTE')
    assert.equal(statusOf('MLB456'), 'NOVO PRODUTO')
    assert.match(dom.window.document.body.textContent, /1 produto\(s\) já existente\(s\); 1 novo\(s\)/)
    await click(button('Limpar seleção'))
    await filter('existentes')
    assert.deepEqual(visibleIds(), ['MLB123'])
    await click(visibleRows()[0].querySelector('input[type="checkbox"]'))
    assert.equal(visibleRows()[0].querySelector('input[type="checkbox"]').checked, true)
    await filter('novos')
    assert.deepEqual(visibleIds(), ['MLB456'])
    assert.match(query('.flash-selecionadas').textContent, /MLB123/)
    await click(visibleRows()[0].querySelector('input[type="checkbox"]'))
    assert.equal(visibleRows()[0].querySelector('input[type="checkbox"]').checked, true)
    assert.match(query('.flash-selecionadas').textContent, /2 ofertas selecionadas · 1 já existentes · 1 novos produtos/)
    assert.deepEqual([...query('.flash-selecionadas').querySelectorAll('li')].map((item) => item.textContent), [
      'MLB123Produto 1JÁ EXISTE', 'MLB456Produto 2NOVO PRODUTO',
    ])
    assert.equal(calls.length, 1)
    assert.equal(scrolls.length, 0) // filtros e seleção não solicitam scroll
    await filter('todos')
    assert.deepEqual(visibleIds(), ['MLB123', 'MLB456'])
    assert.equal(visibleRows().filter((row) => row.querySelector('input[type="checkbox"]').checked).length, 2)
    await click(button('Limpar seleção'))
    assert.match(query('.flash-selecionadas').textContent, /Nenhuma oferta selecionada/)
    assert.match(query('.flash-selecionadas').textContent, /0 ofertas selecionadas · 0 já existentes · 0 novos produtos/)
    assert.equal(visibleRows().filter((row) => row.querySelector('input[type="checkbox"]').checked).length, 0)
    assert.equal(calls.length, 1)
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'snapshot-existente')
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1'), null)
    await click(button('Selecionar todas válidas'))
    const linhaNova = visibleRows().find((row) => row.cells[2].textContent === 'MLB456')
    const linhaExistente = visibleRows().find((row) => row.cells[2].textContent === 'MLB123')
    assert.equal(linhaExistente.querySelector('.flash-category'), null)
    assert.equal(linhaNova.querySelectorAll('.flash-category select').length, 1)
    assert.equal(linhaNova.querySelector('.flash-category').closest('td'), linhaNova.cells[1])
    assert.equal(linhaNova.querySelector('.flash-category label').textContent, 'Categoria — Produto 2')
    assert.equal(linhaNova.querySelector('.flash-category small').textContent, 'MLB456')
    assert.ok(linhaNova.querySelector('[aria-label="Prioridade de MLB456"]'))
    assert.equal(query('.flash-preview > .flash-category'), null)
    assert.doesNotMatch(query('.flash-preview').textContent, /Categoria de MLB/)
    assert.match(query('.flash-category-progress').textContent, /Categorias definidas: 0\/1/)
    assert.ok(linhaNova.querySelector('.flash-category--pendente'))
    assert.deepEqual([...linhaNova.querySelector('.flash-category select').options].map((option) => option.value),
      ['', 'Achados para Casa', 'Achados para Maridos', 'Achados para Elas', 'Achados para Presentear'])
    await act(async () => {
      const select = query('.flash-category select')
      select.value = 'Achados para Casa'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    assert.match(query('.flash-category-progress--completo').textContent, /Categorias definidas: 1\/1.*Classificação concluída/)
    assert.equal(linhaNova.querySelector('.flash-category--pendente'), null)
    await click(button('Preparar ofertas selecionadas'))
    assert.equal(scrolls.at(-1), query('.flash-payload'))
    assert.match(query('.flash-payload').textContent, /1 pronta\(s\) · 1 bloqueada\(s\)/)
    await click(button('Preparar lote para o Gerador'))
    const snapshotKey = 'valio-garimpa:flash-batch-snapshot:v1'
    assert.equal(scrolls.at(-1), query('.flash-generator'))
    assert.ok(dom.window.localStorage.getItem(snapshotKey))
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'snapshot-existente')
    await fill(query('#flash-retorno'), 'https://meli.la/novo')
    await act(async () => {
      const select = query('.flash-category select'); select.value = ''
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /Selecione a categoria do produto novo/)
    assert.match(query('.flash-payload').textContent, /1 pronta\(s\) · 1 bloqueada\(s\)/)
    await act(async () => {
      const select = query('.flash-category select'); select.value = 'Achados para Maridos'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /"categoria": "Achados para Maridos"/)
    await act(async () => {
      const select = query('.flash-category select'); select.value = 'Achados para Casa'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /2 pronta\(s\) · 0 bloqueada\(s\)/)
    assert.match(query('.flash-preview').textContent, /2 ofertas selecionadas/)
    const modoAgenda = query('.flash-preview > label select')
    await act(async () => { modoAgenda.value = 'depois'; modoAgenda.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    const inicioInput = query('.flash-preview input[type="datetime-local"]')
    const inicioBrasilia = new Date(Date.now() + 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
    await fill(inicioInput, inicioBrasilia)
    assert.equal(query('.flash-payload'), null)
    await click(button('Preparar ofertas selecionadas'))
    const payloadAgendado = JSON.parse(query('.flash-payload pre').textContent)
    assert.deepEqual(payloadAgendado.map((item) => item.dados.ofertaInicio),
      Array(2).fill(new Date(`${inicioBrasilia}:00-03:00`).toISOString()))
    assert.deepEqual(payloadAgendado.map((item) => item.dados.ofertaFim), [null, null])
    const chamadasAntesAgenda = calls.length
    await click(button('Enviar selecionadas para Ofertas Relâmpago'))
    assert.deepEqual(JSON.parse(calls.at(-1)[1].body).itens.map((item) => item.dados.ofertaInicio),
      Array(2).fill(new Date(`${inicioBrasilia}:00-03:00`).toISOString()))
    assert.deepEqual(JSON.parse(query('.flash-payload pre').textContent), payloadAgendado)
    calls.splice(chamadasAntesAgenda)
    await fill(inicioInput, '')
    assert.equal(query('.flash-payload'), null)
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-import [role="alert"]').textContent, /Escolha um início futuro/)
    await fill(inicioInput, inicioBrasilia)
    await act(async () => { modoAgenda.value = 'agora'; modoAgenda.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(query('.flash-payload'), null)
    await click(button('Preparar ofertas selecionadas'))
    assert.deepEqual(JSON.parse(query('.flash-payload pre').textContent).map((item) => item.dados.ofertaInicio), [null, null])
    await act(async () => {
      const prioridade = query('[aria-label="Prioridade de MLB123"]')
      prioridade.value = '100'
      prioridade.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const snapshotAntesReextracao = dom.window.localStorage.getItem(snapshotKey)
    const chamadasAntesReextracao = calls.length
    await click(button('Extrair ofertas'))
    assert.equal(query('[aria-label="Prioridade de MLB123"]').value, '100')
    assert.equal(query('.flash-category select').value, 'Achados para Casa')
    assert.equal(dom.window.document.querySelectorAll('.flash-preview input:checked').length, 2)
    assert.equal(query('#flash-retorno').value, 'https://meli.la/novo')
    assert.equal(dom.window.localStorage.getItem(snapshotKey), snapshotAntesReextracao)
    assert.equal(calls.length, chamadasAntesReextracao)
    assert.match(query('.flash-selecionadas').textContent, /1 já existentes · 1 novos produtos/)
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /"prioridadeOferta": 100/)
    await act(async () => {
      const acao = query('[aria-label="Ação de MLB123"]')
      acao.value = 'desativar'
      acao.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /"ofertaRelampago": false/)
    assert.ok(!JSON.stringify(dom.window.localStorage).includes('token-teste'))
    const scrollAntesEdicao = scrolls.length
    await fill(query('#flash-retorno'), 'https://meli.la/novo')
    await filter('novos')
    await filter('todos')
    assert.equal(scrolls.length, scrollAntesEdicao)
    for (const label of ['Enviar selecionadas para Ofertas Relâmpago', 'Substituir ofertas ativas pelas selecionadas']) {
      const antes = scrolls.length
      await click(button(label))
      assert.equal(scrolls.length, antes + 1)
      assert.equal(scrolls.at(-1), query('[aria-label="Prévia de gravação"]'))
    }
    await click(visibleRows()[1].querySelector('input[type="checkbox"]'))
    for (const label of ['Desativar selecionadas', 'Atualizar prioridade']) {
      const antes = scrolls.length
      await click(button(label))
      assert.equal(scrolls.length, antes + 1)
      assert.equal(scrolls.at(-1), query('[aria-label="Prévia de gravação"]'))
    }
    await click(visibleRows()[1].querySelector('input[type="checkbox"]'))
    const fetchAnterior = globalThis.fetch
    const antesFalha = scrolls.length
    try {
      globalThis.fetch = async () => { throw new Error('Falha de rede simulada') }
      await click(button('Enviar selecionadas para Ofertas Relâmpago'))
      assert.equal(scrolls.length, antesFalha)
      assert.match(query('.flash-import [role="alert"]').textContent, /conectar à API de ofertas/)
    } finally { globalThis.fetch = fetchAnterior }
    calls.splice(1) // As consultas extras acima foram verificadas; mantém as contagens do fluxo original.
    await click(button('Ativar selecionadas'))
    assert.equal(scrolls.at(-1), query('[aria-label="Prévia de gravação"]'))
    assert.equal(calls.length, 2)
    assert.equal(calls[1][0], '/api/valio/ofertas-relampago/prever')
    assert.equal(JSON.parse(calls[1][1].body).itens[1].dados.linkAfiliado, 'https://meli.la/novo')
    assert.match(query('.flash-confirmacao').textContent, /CRIAR COMO OFERTA/)
    assert.ok(button('Confirmar ativação de 2 oferta(s)'))
    await click(button('Confirmar ativação de 2 oferta(s)'))
    assert.equal(scrolls.at(-1), query('.flash-confirmacao[role="status"]'))
    assert.equal(calls.length, 3)
    assert.equal(calls[2][0], '/api/valio/ofertas-relampago/confirmar')
    assert.match(query('.flash-confirmacao').textContent, /Criadas: 0/)
    assert.match(query('.flash-confirmacao').textContent, /Ativadas: 1/)
    assert.match(query('.flash-confirmacao').textContent, /Erros: 1/)
    assert.match(query('.flash-confirmacao').textContent, /MLB456: ERRO — code: 23514/)
    await click(button('Limpar ofertas atuais'))
    assert.equal(query('#flash-html').value, '')
    assert.equal(query('.flash-table'), null)
    assert.ok(dom.window.localStorage.getItem(snapshotKey))
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'snapshot-existente')
    assert.match(dom.window.document.body.textContent, /Nenhum produto do Valiô foi alterado/)
    assert.equal(calls.length, 3)
    await fill(query('#flash-html'), html(Array.from({ length: 30 }, (_, index) => card(`MLB${10001 + index}`, index + 1))))
    await click(button('Extrair ofertas'))
    await click(button('Selecionar todas válidas'))
    assert.equal(dom.window.document.querySelectorAll('.flash-table input:checked').length, 30)
    assert.match(query('.flash-preview').textContent, /30 ofertas selecionadas/)
    assert.doesNotMatch(query('.flash-preview').textContent, /30\/12/)
    await click(button('Verificar selecionadas no Valiô'))
    assert.equal(JSON.parse(calls[3][1].body).mercadoLivreIds.length, 30)
  } finally {
    if (root) {
      const { act } = await import('react')
      await act(async () => root.unmount())
    }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('lote do Gerador informa motivo antes da verificação e prepara só MLB7614206226 sem meli.la', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/ofertas-relampago' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const scrolls = []
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
    assert.equal(this.isConnected, true)
    assert.deepEqual(options, { behavior: 'smooth', block: 'start' })
    scrolls.push(this)
  }
  const calls = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (...args) => { calls.push(args); return { ok: true, json: async () => ({
      ok: true, existentes: [{ mercadoLivreId: 'MLB123', linkAfiliado: 'https://meli.la/existente',
        categoria: 'Achados para Casa' }],
    }) } } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token: 'token-teste', setToken: () => {}, diagnostico: null, setDiagnostico: () => {} } }, createElement(Page))))
    const query = (selector) => dom.window.document.querySelector(selector)
    const button = (label) => [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
    const click = async (element) => act(async () => element.click())
    const fillHtml = async (value) => act(async () => {
      const input = query('#flash-html')
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const existente = card('MLB123', 1)
    delete existente.card.metadata.url
    const novo = card('MLB7614206226', 2)
    novo.card.metadata.url = 'www.mercadolivre.com.br/anuncio-original/p/MLB7614206226'
    await fillHtml(html([existente, novo]))
    await click(button('Extrair ofertas'))
    const linhas = [...dom.window.document.querySelectorAll('.flash-preview .flash-table tbody tr')]
    assert.equal(linhas[0].cells[11].textContent, 'SEM URL PARA GERADOR')
    assert.equal(linhas[1].cells[11].textContent, 'URL PARA GERADOR DISPONÍVEL')
    await click(button('Selecionar todas válidas'))
    await click(button('Preparar lote para o Gerador'))
    assert.match(query('.flash-generator [role="alert"]').textContent, /selecione e verifique ao menos um produto novo/)
    assert.equal(scrolls.length, 0) // erro do Gerador não solicita scroll
    assert.equal(calls.length, 0)
    await click(button('Verificar selecionadas no Valiô'))
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /1 pronta\(s\) · 1 bloqueada\(s\)/)
    assert.match(query('.flash-payload').textContent, /MLB7614206226/)
    await click(button('Preparar lote para o Gerador'))
    const registro = JSON.parse(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1'))
    assert.equal(registro.status, 'AGUARDANDO RETORNO')
    assert.equal(registro.snapshot.quantidade, 1)
    assert.deepEqual(registro.snapshot.produtos.map((produto) => produto.itemId), ['MLB7614206226'])
    assert.equal(registro.snapshot.produtos[0].urlNormalizada,
      'https://www.mercadolivre.com.br/anuncio-original/p/MLB7614206226')
    assert.match(query('.flash-generator [role="status"]').textContent, /Lote para o Gerador preparado com 1 produto/)
    assert.match(query('.flash-generator').textContent, /Snapshot ativo · AGUARDANDO RETORNO · 1 produto/)
    assert.match(query('.flash-generator-lista').textContent, /MLB7614206226/)
    assert.doesNotMatch(query('.flash-generator-lista').textContent, /MLB123/)
    assert.equal(query('#flash-urls-gerador').value, registro.snapshot.urlsParaGerador)
    assert.equal(query('#flash-urls-gerador').value,
      'https://www.mercadolivre.com.br/anuncio-original/p/MLB7614206226')
    assert.ok(!query('#flash-urls-gerador').value.includes('meli.la'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], '/api/valio/produtos/verificar')
    const preencher = async (element, valor) => act(async () => {
      Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, valor)
      element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
    await preencher(query('#flash-retorno'), 'https://meli.la/jaPareado')
    await preencher(query('.flash-category select'), 'Achados para Elas')
    await preencher(query('[aria-label="Prioridade de MLB7614206226"]'), '100')
    const snapshotPareado = dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1')
    const novoMesmoId = structuredClone(novo)
    novoMesmoId.card.metadata.url = 'https://produto.mercadolivre.com.br/MLB-7614206226-outro-slug'
    await fillHtml(html([novoMesmoId, existente]))
    await click(button('Extrair ofertas'))
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /2 pronta\(s\) · 0 bloqueada\(s\)/)
    assert.match(query('.flash-payload').textContent, /https:\/\/meli.la\/jaPareado/)
    assert.match(query('.flash-payload').textContent, /"prioridadeOferta": 100/)
    assert.match(query('.flash-payload').textContent, /Achados para Elas/)
    assert.equal(query('[aria-label="Selecionar oferta 1"]').checked, true)
    const outroProduto = card('MLB999', 3)
    outroProduto.card.metadata.url = 'https://produto.mercadolivre.com.br/MLB-999-outro'
    await fillHtml(html([novoMesmoId, existente, outroProduto]))
    await click(button('Extrair ofertas'))
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /2 pronta\(s\) · 1 bloqueada\(s\)/)
    assert.match(query('.flash-payload').textContent, /MLB999: ITEM_ID ausente do snapshot/)
    assert.ok(button('Prévia somente das ofertas compatíveis — preservar seleção'))
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1'), snapshotPareado)
    assert.equal(query('.flash-category select').value, 'Achados para Elas')
    assert.equal(query('[aria-label="Prioridade de MLB7614206226"]').value, '100')
    await act(async () => root.unmount())
    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token: 'token-teste', setToken: () => {}, diagnostico: null, setDiagnostico: () => {} } }, createElement(Page))))
    assert.match(query('.flash-generator').textContent, /MLB7614206226/)
    assert.equal(query('#flash-urls-gerador').value, registro.snapshot.urlsParaGerador)
    await click(button('Descartar snapshot de ofertas'))
    const invalido = card('MLB7614206226', 2)
    invalido.card.metadata.url = 'https://exemplo.invalid/anuncio'
    await fillHtml(html([existente, invalido]))
    await click(button('Extrair ofertas'))
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    assert.equal([...dom.window.document.querySelectorAll('.flash-preview .flash-table tbody tr')][1].cells[11].textContent,
      'SEM URL PARA GERADOR')
    await click(button('Preparar lote para o Gerador'))
    assert.match(query('.flash-generator [role="alert"]').textContent, /URL original válida/)
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1'), null)
    const antesReextrair = scrolls.length
    await act(async () => {
      const input = query('#flash-origem')
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input,
        'https://www.mercadolivre.com.br/ofertas?container_id=relampago')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const recuperado = card('MLB7614206226', 2)
    delete recuperado.card.metadata.url
    recuperado.card.href = '/anuncio-original/p/MLB7614206226'
    const faltante = card('MLB999999', 3)
    delete faltante.card.metadata.url
    await fillHtml(html([existente, recuperado, faltante]))
    await click(button('Extrair ofertas'))
    assert.equal(scrolls.length, antesReextrair)
    assert.equal(query('#flash-origem').value, 'https://www.mercadolivre.com.br/ofertas?container_id=relampago')
    assert.equal(query('.flash-preview input:checked') !== null, true)
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    await click(button('Preparar lote para o Gerador'))
    assert.equal(query('#flash-urls-gerador').value, 'https://www.mercadolivre.com.br/anuncio-original/p/MLB7614206226')
    assert.match(query('.flash-generator').textContent, /Fora do lote.*MLB999999/)
    assert.equal(dom.window.document.querySelectorAll('.flash-preview input:checked').length, 3)
    assert.deepEqual(calls.map(([url]) => url), Array(4).fill('/api/valio/produtos/verificar'))
    await click(button('Descartar snapshot de ofertas'))
    await fillHtml(html(urlsReais.items))
    await click(button('Extrair ofertas'))
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    assert.equal(dom.window.document.querySelectorAll('.flash-preview .flash-table tbody tr').length, 2)
    for (const linha of dom.window.document.querySelectorAll('.flash-preview .flash-table tbody tr')) {
      assert.equal(linha.cells[11].textContent, 'URL PARA GERADOR DISPONÍVEL')
    }
    await click(button('Preparar lote para o Gerador'))
    const loteReal = JSON.parse(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1'))
    assert.ok(loteReal, query('.flash-generator').textContent)
    assert.deepEqual(loteReal.snapshot.produtos.map((produto) => produto.itemId), ['MLB4857636451', 'MLB5226420562'])
    assert.equal(loteReal.snapshot.produtos[0].urlNormalizada,
      `https://${urlsReais.items[0].card.metadata.url}${urlsReais.items[0].card.metadata.url_params}${urlsReais.items[0].card.metadata.url_fragments}`)
    assert.equal(query('#flash-urls-gerador').value.split('\n').length, 2)
  } finally {
    if (root) {
      const { act } = await import('react')
      await act(async () => root.unmount())
    }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('URL do Gerador usa somente a URL individual armazenada no item', async () => {
  const { resolverUrlGerador, normalizarUrlIndividual } = await vite.ssrLoadModule('/src/features/ofertas-relampago/urlGerador.ts')
  const original = 'https://www.mercadolivre.com.br/original/p/MLB123'
  const origem = 'https://produto.mercadolivre.com.br/MLB-123-produto'
  assert.deepEqual(resolverUrlGerador({ itemId: 'MLB123', urlOriginal: original }), { url: original, fallback: false })
  assert.equal(normalizarUrlIndividual(null, 'MLB123', origem), null)
  for (const invalida of ['', 'https://www.mercadolivre.com.br/ofertas', 'https://www.mercadolivre.com.br/ofertas?foo=MLB123', 'https://exemplo.com/MLB123',
    'https://produto.mercadolivre.com.br/MLB-456-outro', 'https://www.mercadolivre.com.br/MLB123?wid=MLB456',
    'https://www.mercadolivre.com.br/%zz/MLB123']) {
    assert.equal(resolverUrlGerador({ itemId: 'MLB123', urlOriginal: invalida }).url, null)
  }
})

test('ciclo do lote acumula sucessos e mantém erros, conflitos e retornos inválidos pendentes', async () => {
  const { criarRegistroSnapshot } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts')
  const { registrarRetornoLote, registrarConfirmacaoLote, validarLoteOfertas } = await vite.ssrLoadModule('/src/features/ofertas-relampago/cicloLote.ts')
  const produtos = ['MLB5357067365', 'MLB4189368533'].map((itemId, i) => ({ ordem: i + 1, itemId,
    titulo: 'Fixture', urlOriginal: `https://produto.mercadolivre.com.br/${itemId}-fixture`,
    urlNormalizada: `https://produto.mercadolivre.com.br/${itemId}-fixture` }))
  const inicial = criarRegistroSnapshot({ produtos })
  assert.equal(inicial.status, 'AGUARDANDO RETORNO')
  const pronto = registrarRetornoLote(inicial, 'https://meli.la/14jMKEN\nhttps://meli.la/segundo')
  assert.equal(pronto.status, 'RETORNO PROCESSADO')
  const previa = { modo: 'ENVIAR', operacoes: produtos.map((p) => ({ itemId: p.itemId, acao: 'CRIAR COMO OFERTA' })) }
  const resultado = (a, b) => ({ erros: [a, b].filter((r) => r === 'ERRO').length,
    conflitos: [a, b].filter((r) => r === 'CONFLITO').length,
    itens: [{ itemId: produtos[0].itemId, resultado: a }, { itemId: produtos[1].itemId, resultado: b }] })
  for (const falha of ['ERRO', 'CONFLITO', 'DESATIVAR', 'DESCONHECIDO']) {
    const parcial = registrarConfirmacaoLote(pronto, previa, resultado('CRIADA', falha))
    assert.notEqual(parcial.status, 'FINALIZADO')
    assert.deepEqual(parcial.novosConcluidos, ['MLB5357067365'])
    const corrigido = registrarRetornoLote(parcial, 'https://meli.la/14jMKEN\nhttps://meli.la/corrigido')
    assert.deepEqual(corrigido.novosConcluidos, ['MLB5357067365'])
    const restaurado = JSON.parse(JSON.stringify(corrigido))
    assert.equal(validarLoteOfertas(restaurado), true)
    const final = registrarConfirmacaoLote(restaurado, { modo: 'ENVIAR', operacoes: [previa.operacoes[1]] },
      { erros: 0, conflitos: 0, itens: [{ itemId: produtos[1].itemId, resultado: 'CRIADA' }] })
    assert.equal(final.status, 'FINALIZADO')
    assert.equal(validarLoteOfertas(JSON.parse(JSON.stringify(final))), true)
    assert.equal(registrarRetornoLote(final, '').status, 'FINALIZADO')
  }
  for (const texto of ['revisar', 'Este URL corresponde a um produto pausado',
    'Este produto não cumpre com os requisitos do programa', 'https://meli.la/um']) {
    const invalido = registrarRetornoLote(pronto, texto)
    assert.equal(invalido.status, 'AGUARDANDO RETORNO')
    assert.notEqual(registrarConfirmacaoLote(invalido, previa, resultado('CRIADA', 'CRIADA')).status, 'FINALIZADO')
  }
  assert.notEqual(registrarConfirmacaoLote(pronto, { ...previa, modo: 'PRIORIDADE' }, resultado('ATUALIZAR', 'ATUALIZAR')).status, 'FINALIZADO')
  assert.notEqual(registrarConfirmacaoLote(pronto, previa, { erros: 0, conflitos: 0, itens: [] }).status, 'FINALIZADO')
  const existente = registrarConfirmacaoLote(pronto, { modo: 'ENVIAR', operacoes: previa.operacoes.map((op) => ({ ...op, acao: 'SEM ALTERAÇÃO' })) }, resultado('SEM ALTERAÇÃO', 'SEM ALTERAÇÃO'))
  assert.equal(existente.status, 'FINALIZADO')
  for (const registro of [inicial, pronto, existente]) assert.equal(validarLoteOfertas(JSON.parse(JSON.stringify(registro))), true)
})

test('19 links e 1 recusado sobrevivem ao salvamento e reload sem publicar o recusado', async () => {
  const { criarRegistroSnapshot } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts')
  const { registrarRetornoLote, validarLoteOfertas } = await vite.ssrLoadModule('/src/features/ofertas-relampago/cicloLote.ts')
  const { vincularSnapshot } = await vite.ssrLoadModule('/src/features/ofertas-relampago/vinculoSnapshot.ts')
  const produtos = Array.from({ length: 20 }, (_, i) => ({ ordem: i + 1, itemId: `MLB${100 + i}`, titulo: 'Teste',
    urlOriginal: `https://produto.mercadolivre.com.br/MLB-${100 + i}-teste`, urlNormalizada: `https://produto.mercadolivre.com.br/MLB-${100 + i}-teste` }))
  const texto = [
    'https://meli.la/32jgjwy', 'https://meli.la/1S2LMBt', 'https://meli.la/1VqSSDy',
    'https://meli.la/2Vc4jnX', 'https://meli.la/1fQMfKt', 'https://meli.la/1TeNDyJ',
    'https://meli.la/1p7simK', 'https://meli.la/2YKES1e', 'https://meli.la/1k636hq',
    'https://meli.la/2WUgWAG', 'https://meli.la/1u9TmX7', 'https://meli.la/2ezB8oC',
    'https://meli.la/14YYuXi', 'https://meli.la/1TNsecV', 'https://meli.la/347VFGt',
    'https://meli.la/2hP3gnU', 'https://meli.la/1eb7Tt4', 'https://meli.la/2iDzrmH',
    'https://meli.la/2i2oSTT', '⚠️ Este produto não cumpre com os requisitos do Programa.',
  ].join('\n')
  const registro = registrarRetornoLote(criarRegistroSnapshot({ produtos }), texto)
  assert.equal(registro.status, 'RETORNO PROCESSADO')
  assert.equal(registro.retornoTexto, texto)
  const restaurado = JSON.parse(JSON.stringify(registro))
  assert.equal(validarLoteOfertas(restaurado), true)
  const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
  const retorno = processarRetornoGerador(restaurado.snapshot.produtos, restaurado.retornoTexto)
  assert.equal(retorno.linksValidos, 19)
  assert.equal(retorno.recusados, 1)
  const ofertas = produtos.map((p) => ({ ...p, chave: p.itemId, situacao: 'PRONTO', precoAtual: 50, precoAnterior: null,
    percentualDesconto: null, textoOferta: null, ofertaInicio: null, ofertaFim: null, imagem: 'https://img.test/produto.jpg' }))
  const vinculo = vincularSnapshot(restaurado, ofertas.toReversed(), retorno)
  const preparo = prepararOfertasSelecionadas(ofertas, new Set(produtos.map((p) => p.itemId)), new Map(),
    new Set(produtos.map((p) => p.itemId)), new Map(produtos.map((p) => [p.itemId, 'Achados para Casa'])), vinculo.retornoSeguro)
  assert.equal(preparo.prontos.length, 19)
  assert.deepEqual(preparo.bloqueados, [{ itemId: 'MLB119', motivo: 'RECUSADO: não publicar.' }])
  assert.equal(preparo.prontos[0].dados.linkAfiliado, 'https://meli.la/32jgjwy')
})

test('fixture real finaliza, restaura e encerra somente o lote local sem tocar no produto ou meli.la', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const publicado = new Map()
  const calls = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (url, options) => {
      calls.push(url)
      if (url.endsWith('/verificar')) return { ok: true, json: async () => ({ ok: true, existentes: [] }) }
      if (url.endsWith('/prever')) return { ok: true, json: async () => ({ ok: true, assinatura: 'teste', previa: {
        modo: 'ENVIAR', operacoes: [{ itemId: 'MLB5357067365', acao: 'CRIAR COMO OFERTA', produto: 'Fixture', precoAtual: 60 }],
      } }) }
      assert.ok(url.endsWith('/confirmar'))
      assert.ok(JSON.parse(options.body).assinatura)
      publicado.set('MLB5357067365', { linkAfiliado: 'https://meli.la/14jMKEN', ofertaRelampago: true })
      return { ok: true, json: async () => ({ ok: true, criadas: 1, ativadas: 0, atualizadas: 0, desativadas: 0,
        semAlteracao: 0, conflitos: 0, erros: 0, itens: [{ itemId: 'MLB5357067365', resultado: 'CRIADA' }] }) }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    const query = (s) => dom.window.document.querySelector(s)
    const button = (label) => [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
    const click = async (b) => act(async () => b.click())
    const fill = async (s, value) => act(async () => {
      const input = query(s)
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const mount = async () => {
      root = createRoot(query('#root'))
      await act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token: 'teste' } }, createElement(Page))))
    }
    const reload = async () => { await act(async () => root.unmount()); await mount() }
    const key = 'valio-garimpa:flash-batch-snapshot:v1'
    const registro = () => JSON.parse(dom.window.localStorage.getItem(key))
    dom.window.localStorage.setItem('valio-garimpa:affiliate-batch-snapshot:v1', 'preservar')
    await mount()
    await fill('#flash-html', html([card('MLB5357067365', 1)]))
    await click(button('Extrair ofertas'))
    await click(button('Selecionar todas válidas'))
    await click(button('Verificar selecionadas no Valiô'))
    await click(button('Preparar lote para o Gerador'))
    assert.equal(registro().status, 'AGUARDANDO RETORNO')
    const aguardando = dom.window.localStorage.getItem(key)
    await fill('#flash-retorno', 'https://meli.la/14jMKEN')
    assert.equal(registro().status, 'RETORNO PROCESSADO')
    const pronto = dom.window.localStorage.getItem(key)
    await act(async () => {
      const select = query('.flash-category select'); select.value = 'Achados para Casa'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Enviar selecionadas para Ofertas Relâmpago'))
    await click(button('Confirmar ativação de 1 oferta(s)'))
    assert.equal(registro().status, 'FINALIZADO')
    assert.ok(button('Encerrar lote'))
    assert.equal(button('Descartar snapshot de ofertas'), undefined)
    const finalizado = dom.window.localStorage.getItem(key)
    for (const [salvo, status] of [[aguardando, 'AGUARDANDO RETORNO'], [pronto, 'PRONTO'], [finalizado, 'FINALIZADO']]) {
      dom.window.localStorage.setItem(key, salvo)
      await reload()
      assert.match(query('.flash-generator').textContent, new RegExp(`Status do lote: ${status}`))
      if (status !== 'AGUARDANDO RETORNO') assert.equal(query('#flash-retorno').value, 'https://meli.la/14jMKEN')
    }
    const chamadasAntes = calls.length
    const produtoAntes = structuredClone(publicado.get('MLB5357067365'))
    await click(button('Encerrar lote'))
    assert.equal(dom.window.localStorage.getItem(key), null)
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'preservar')
    assert.equal(calls.length, chamadasAntes)
    assert.deepEqual(publicado.get('MLB5357067365'), produtoAntes)
    assert.equal(produtoAntes.linkAfiliado, 'https://meli.la/14jMKEN')
    assert.match(dom.window.document.body.textContent, /Lote encerrado. As ofertas publicadas permanecem no Valiô./)
    assert.equal(query('#flash-retorno'), null)
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('gerenciamento independente usa prévia/confirmação, mantém produto ativo e preserva lote e classificação', async () => {
  const [{ criarPreviaOfertas, criarPreviaLimpezaExpiradas, confirmarPreviaOfertas }, { criarRegistroSnapshot }] = await Promise.all([
    vite.ssrLoadModule('/server/ofertasRelampagoLote.ts'),
    vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts'),
  ])
  const agora = Date.now()
  const rows = new Map(Array.from({ length: 17 }, (_, i) => {
    const id = `MLB${9001 + i}`
    return [id, { mercado_livre_id: id, titulo: `Oferta publicada ${i + 1}`, preco: 60, preco_anterior: 100,
      percentual_desconto: 40, prioridade_oferta: 0, oferta_inicio: i === 16 ? new Date(agora + 86_400_000).toISOString() : null,
      oferta_fim: new Date(agora + (i === 15 ? -1 : 2) * 86_400_000).toISOString(),
      imagem: 'https://img.test/item.webp', categoria: 'Achados para Casa', ativo: true,
      oferta_relampago: true, texto_oferta: null, home_oferta_mode: 'auto', link_afiliado: `https://meli.la/original${i}` }]
  }))
  const escritas = []
  const homeScrolls = []
  const gateway = {
    async buscar(id) { return rows.has(id) ? [structuredClone(rows.get(id))] : [] },
    async listarAtivas() { return [...rows.values()].filter((r) => r.oferta_relampago).map((r) => structuredClone(r)) },
    async atualizar(id, anterior, alteracao) {
      assert.deepEqual(rows.get(id), anterior)
      escritas.push({ id, alteracao }); rows.set(id, { ...anterior, ...alteracao })
      return [structuredClone(rows.get(id))]
    },
    async inserir() { assert.fail('Gerenciamento não pode criar produto') },
  }
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
    if (this.getAttribute('aria-label') === 'Prévia do gerenciamento') {
      assert.equal(this.isConnected, true)
      assert.match(this.textContent, /Prévia da posição na Home/)
      assert.deepEqual(options, { behavior: 'smooth', block: 'start' })
      homeScrolls.push(this.textContent)
    }
  }
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (url, options) => {
      calls.push(url)
      const body = JSON.parse(options.body)
      let resposta
      if (url.endsWith('/verificar')) resposta = { ok: true, existentes: [] }
      else if (url.endsWith('/listar')) resposta = { ok: true, produtos: body.itemId ? await gateway.buscar(body.itemId) : await gateway.listarAtivas() }
      else if (url.endsWith('/expiradas/prever')) resposta = { ok: true, previa: await criarPreviaLimpezaExpiradas(gateway), assinatura: 'assinada-no-teste' }
      else if (url.endsWith('/prever')) {
        if (body.modo === 'HOME') {
          assert.deepEqual(Object.keys(body.itens[0].dados).sort(), ['homeOfertaMode', 'mercadoLivreId'])
        }
        resposta = { ok: true, previa: await criarPreviaOfertas(body, gateway), assinatura: 'assinada-no-teste' }
      }
      else if (url.endsWith('/confirmar')) resposta = { ok: true, ...await confirmarPreviaOfertas(body.previa, gateway, undefined, [], async () => {}) }
      else assert.fail(`Rota inesperada: ${url}`)
      return { ok: true, json: async () => resposta }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    const snapshot = criarRegistroSnapshot({ produtos: [{ ordem: 1, itemId: 'MLB777', titulo: 'Lote em andamento',
      urlOriginal: 'https://produto.mercadolivre.com.br/MLB-777-produto', urlNormalizada: 'https://produto.mercadolivre.com.br/MLB-777-produto' }] })
    const chave = 'valio-garimpa:flash-batch-snapshot:v1'
    dom.window.localStorage.setItem(chave, JSON.stringify(snapshot))
    dom.window.localStorage.setItem('valio-garimpa:affiliate-batch-snapshot:v1', 'preservar-afiliados')
    const preparadoAntes = await fixturePreparado()
    dom.window.localStorage.setItem(preparadoAntes.CHAVE_LOTE_PREPARADO, JSON.stringify(preparadoAntes.lote))
    const armazenamentoAntes = JSON.stringify(dom.window.localStorage)
    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token: 'token-teste' } }, createElement(Page))))
    const query = (s) => dom.window.document.querySelector(s)
    const botao = (texto, area = dom.window.document) => [...area.querySelectorAll('button')].find((b) => b.textContent.trim() === texto)
    const click = async (el) => { assert.ok(el); await act(async () => el.click()) }
    const fill = async (el, value) => act(async () => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
    const manager = query('.flash-manager')
    assert.ok(manager)
    assert.equal(query('.flash-preview'), null)
    assert.equal(calls.length, 0)
    await click(botao('Carregar ofertas do catálogo', manager))
    const linhas = () => [...manager.querySelectorAll('tbody tr')]
    const linha = (id) => linhas().find((r) => r.textContent.includes(id))
    assert.equal(linhas().length, 16)
    assert.equal(linha('MLB9016'), undefined)
    assert.match(manager.textContent, /17 ofertas marcadas · 15 ativas agora · 1 agendadas · 12 na Home · 3 na fila · 1 expiradas/)
    assert.equal(manager.querySelectorAll('.flash-manager-home').length, 12)
    assert.equal(manager.querySelectorAll('.flash-manager-queue').length, 3)
    const filtro = [...manager.querySelectorAll('label')].find((l) => l.textContent.startsWith('Filtrar ofertas')).querySelector('select')
    await fill(filtro, 'Expiradas / Histórico'); assert.equal(linhas().length, 1)
    await fill(filtro, 'Agendadas'); assert.equal(linhas().length, 1)
    await fill(filtro, 'Na fila'); assert.equal(linhas().length, 3)
    await fill(filtro, 'Todas')
    // Preenche a área de extração para garantir que o gerenciamento não a modifica.
    const htmlAtual = html([card('MLB777', 1)])
    await fill(query('#flash-html'), htmlAtual)
    await click(botao('Extrair ofertas'))
    await click(botao('Selecionar todas válidas'))
    await click(botao('Verificar selecionadas no Valiô'))
    await fill(query('.flash-category select'), 'Achados para Elas')
    await fill(query('[aria-label="Prioridade de MLB777"]'), '100')
    await fill(linha('MLB9015').querySelector('select'), '100')
    assert.equal(escritas.length, 0)
    await click(botao('Prévia de prioridade', linha('MLB9015')))
    assert.ok(manager.querySelector('[aria-label="Prévia do gerenciamento"]'))
    assert.equal(escritas.length, 0)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.equal(rows.get('MLB9015').prioridade_oferta, 100)
    assert.deepEqual(escritas.at(-1).alteracao, { prioridade_oferta: 100 })
    assert.ok(linha('MLB9015').querySelector('.flash-manager-home'))
    const original = structuredClone(rows.get('MLB9015'))
    await click(botao('Desativar Oferta Relâmpago', linha('MLB9015')))
    assert.equal(rows.get('MLB9015').oferta_relampago, true)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.deepEqual(rows.get('MLB9015'), { ...original, oferta_relampago: false })
    assert.deepEqual(escritas.at(-1).alteracao, { oferta_relampago: false })
    await fill(filtro, 'Desativadas')
    await click(botao('Reativar Oferta Relâmpago', linha('MLB9015')))
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.deepEqual(rows.get('MLB9015'), original)
    assert.deepEqual(escritas.at(-1).alteracao, { oferta_relampago: true })
    await fill(filtro, 'Todas')
    for (const id of ['MLB9001', 'MLB9002']) await click(linha(id).querySelector('input[type="checkbox"]'))
    const seletorLote = [...manager.querySelectorAll('label')].find((l) => l.textContent.startsWith('Prioridade em lote')).querySelector('select')
    await fill(seletorLote, '50')
    await click(botao('Prévia de prioridade em lote', manager))
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    for (const id of ['MLB9001', 'MLB9002']) {
      assert.equal(rows.get(id).prioridade_oferta, 50)
      assert.equal(linha(id).querySelector('input[type="checkbox"]').checked, true)
    }
    await click(botao('Desativar Ofertas Relâmpago selecionadas', manager))
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    for (const id of ['MLB9001', 'MLB9002']) {
      assert.equal(rows.get(id).oferta_relampago, false)
      assert.equal(rows.get(id).ativo, true)
      assert.ok(rows.get(id).link_afiliado.startsWith('https://meli.la/original'))
    }
    await fill(manager.querySelector('input:not([type="checkbox"])'), 'MLB9001')
    await click(botao('Consultar ITEM_ID', manager))
    assert.ok(botao('Reativar Oferta Relâmpago', linha('MLB9001')))
    await fill(filtro, 'Todas')
    const geminiAntes = structuredClone(rows.get('MLB9003'))
    const colchaoAntes = structuredClone(rows.get('MLB9014'))
    await fill(linha('MLB9003').querySelector('[aria-label="Posição na Home de MLB9003"]'), 'fila')
    const escritasAntesHome = escritas.length
    assert.equal(homeScrolls.length, 0)
    await click(botao('Prévia da posição na Home', linha('MLB9003')))
    assert.equal(homeScrolls.length, 1)
    assert.equal(dom.window.document.activeElement, manager.querySelector('[aria-label="Prévia do gerenciamento"]'))
    assert.equal(escritas.length, escritasAntesHome)
    assert.match(manager.querySelector('[aria-label="Prévia do gerenciamento"]').textContent, /Automática → Enviar para fila/)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.deepEqual(escritas.at(-1).alteracao, { home_oferta_mode: 'fila' })
    await fill(linha('MLB9014').querySelector('[aria-label="Posição na Home de MLB9014"]'), 'fixada')
    await click(botao('Prévia da posição na Home', linha('MLB9014')))
    assert.equal(homeScrolls.length, 2)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.match(linha('MLB9014').textContent, /FIXADA NA HOME/)
    assert.ok(linha('MLB9003').querySelector('.flash-manager-queue'))
    assert.equal(linha('MLB9003').querySelector('.flash-manager-home'), null)
    assert.deepEqual(rows.get('MLB9003'), { ...geminiAntes, home_oferta_mode: 'fila' })
    assert.deepEqual(rows.get('MLB9014'), { ...colchaoAntes, home_oferta_mode: 'fixada' })
    const expiradoAntes = structuredClone(rows.get('MLB9016'))
    const escritasAntesLimpeza = escritas.length
    await click(botao('Limpar ofertas expiradas', manager))
    assert.equal(escritas.length, escritasAntesLimpeza)
    assert.match(manager.querySelector('[aria-label="Prévia do gerenciamento"]').textContent, /1 ofertas expiradas serão limpas/)
    assert.match(manager.querySelector('[aria-label="Prévia do gerenciamento"]').textContent, /Esses produtos sairão.*permanecerão ativos no catálogo/)
    assert.match(manager.querySelector('[aria-label="Prévia do gerenciamento"]').textContent, /Oferta publicada 16.*MLB9016/)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.deepEqual(escritas.at(-1).alteracao, { oferta_relampago: false })
    assert.deepEqual(rows.get('MLB9016'), { ...expiradoAntes, oferta_relampago: false })
    assert.match(manager.textContent, /0 expiradas aguardando limpeza/)
    await fill(filtro, 'Expiradas / Histórico'); assert.equal(linhas().length, 0)
    assert.equal(manager.querySelectorAll('input[type="checkbox"]:checked').length, 0)
    await fill(filtro, 'Todas')
    assert.equal(rows.size, 17)
    assert.equal(JSON.stringify(dom.window.localStorage), armazenamentoAntes)
    assert.equal(query('#flash-html').value, htmlAtual)
    assert.equal(query('.flash-category select').value, 'Achados para Elas')
    assert.equal(query('[aria-label="Prioridade de MLB777"]').value, '100')
    assert.equal(query('.flash-preview input[type="checkbox"]').checked, true)
    assert.ok(calls.every((url) => !url.includes('/status')))
    const antesAgenda = structuredClone(rows.get('MLB9004'))
    const inicioAgenda = new Date(agora + 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 16)
    const gravacoesAntesAgenda = escritas.length
    await fill(linha('MLB9004').querySelector('input[type="datetime-local"]'), inicioAgenda)
    await click(botao('Agendar Oferta Relâmpago', linha('MLB9004')))
    assert.equal(escritas.length, gravacoesAntesAgenda)
    assert.match(manager.querySelector('[aria-label="Prévia do gerenciamento"]').textContent, /Início:.*→.*Fim:/)
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.match(linha('MLB9004').textContent, /AGENDADA.*Agendada para:/)
    assert.equal(rows.get('MLB9004').link_afiliado, antesAgenda.link_afiliado)
    await click(botao('Cancelar agendamento e ativar agora — prévia', linha('MLB9004')))
    await click(botao('Confirmar alterações das ofertas publicadas', manager))
    assert.equal(rows.get('MLB9004').oferta_inicio, null)
    assert.equal(rows.get('MLB9004').ativo, true)
    assert.equal(JSON.stringify(dom.window.localStorage), armazenamentoAntes)
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('salvar/carregar lote preparado exige revalidação e nova prévia sem alterar o lote atual ou o Gerador', async () => {
  const { CHAVE_LOTE_PREPARADO } = await fixturePreparado()
  const [{ criarPreviaOfertas, confirmarPreviaOfertas }, { criarRegistroSnapshot }, { registrarRetornoLote }] = await Promise.all([
    vite.ssrLoadModule('/server/ofertasRelampagoLote.ts'),
    vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts'),
    vite.ssrLoadModule('/src/features/ofertas-relampago/cicloLote.ts'),
  ])
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const rows = new Map()
  const chamadas = []
  let falharConsulta = false
  const gateway = {
    async buscar(id) { return rows.has(id) ? [structuredClone(rows.get(id))] : [] },
    async listarAtivas() { return [] },
    async inserir(produto) { assert.equal(rows.has(produto.mercado_livre_id), false); rows.set(produto.mercado_livre_id, structuredClone(produto)) },
    async atualizar() { assert.fail('Os itens deste teste eram novos; nenhuma atualização é permitida') },
  }
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (url, options) => {
      const body = JSON.parse(options.body)
      chamadas.push({ url, body })
      if (url.endsWith('/verificar')) {
        if (falharConsulta) throw new Error('API indisponível')
        return { ok: true, json: async () => ({ ok: true, existentes: [] }) }
      }
      if (url.endsWith('/prever')) {
        assert.equal(body.exigirPrazoValido, true)
        assert.deepEqual(body.itens.map((item) => item.dados.mercadoLivreId), ['MLB8001'])
        assert.equal(body.itens[0].dados.linkAfiliado, 'https://meli.la/salvo1')
        return { ok: true, json: async () => ({ ok: true, previa: await criarPreviaOfertas(body, gateway), assinatura: 'nova-assinatura-preparada' }) }
      }
      assert.ok(url.endsWith('/confirmar'))
      assert.equal(body.assinatura, 'nova-assinatura-preparada')
      assert.equal(body.previa.exigirPrazoValido, true)
      return { ok: true, json: async () => ({ ok: true, ...await confirmarPreviaOfertas(body.previa, gateway, undefined, [], async () => {}) }) }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    const query = (s) => dom.window.document.querySelector(s)
    const botao = (texto, area = dom.window.document) => [...area.querySelectorAll('button')].find((b) => b.textContent.trim() === texto)
    const click = async (el) => { assert.ok(el); await act(async () => el.click()) }
    const fill = async (el, value) => act(async () => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
    const mount = async () => {
      root = createRoot(query('#root'))
      await act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token: 'token-preparado-secreto' } }, createElement(Page))))
    }
    const snapshot = criarRegistroSnapshot({ produtos: [8001, 8002].map((id, i) => ({ ordem: i + 1, itemId: `MLB${id}`, titulo: `Produto ${i + 1}`,
      urlOriginal: `https://produto.mercadolivre.com.br/MLB-${id}-produto`, urlNormalizada: `https://produto.mercadolivre.com.br/MLB-${id}-produto` })) })
    const gerador = registrarRetornoLote(snapshot, 'https://meli.la/salvo1\nhttps://meli.la/salvo2')
    const chaveGerador = 'valio-garimpa:flash-batch-snapshot:v1'
    const brutoGerador = JSON.stringify(gerador)
    dom.window.localStorage.setItem(chaveGerador, brutoGerador)
    dom.window.localStorage.setItem('valio-garimpa:affiliate-batch-snapshot:v1', 'afiliados-intactos')
    await mount()
    const htmlSalvar = html([card('MLB8001', 1, { end: '2099-01-01T00:00:00Z' }), card('MLB8002', 2, { end: '2000-01-01T00:00:00Z' })])
    await fill(query('#flash-html'), htmlSalvar)
    await click(botao('Extrair ofertas')); await click(botao('Selecionar todas válidas')); await click(botao('Verificar selecionadas no Valiô'))
    await fill(query('#flash-categoria-MLB8001'), 'Achados para Elas')
    await fill(query('#flash-categoria-MLB8002'), 'Achados para Casa')
    await fill(query('[aria-label="Prioridade de MLB8001"]'), '100')
    await fill(query('[aria-label="Prioridade de MLB8002"]'), '50')
    const chamadasAntes = chamadas.length
    await click(botao('Salvar lote para depois'))
    assert.equal(chamadas.length, chamadasAntes)
    assert.equal(rows.size, 0)
    assert.match(query('.flash-prepared').textContent, /Lote salvo para depois. Nenhuma oferta foi publicada./)
    const salvo = () => JSON.parse(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO))
    assert.equal(salvo().status, 'PREPARADO')
    assert.deepEqual(salvo().itens.map((item) => [item.itemId, item.categoria, item.prioridade, item.linkMeli]), [
      ['MLB8001', 'Achados para Elas', 100, 'https://meli.la/salvo1'], ['MLB8002', 'Achados para Casa', 50, 'https://meli.la/salvo2'],
    ])
    assert.equal(query('.flash-preview input[type="checkbox"]').checked, true)
    assert.equal(query('[aria-label="Prioridade de MLB8001"]').value, '100')
    assert.equal(dom.window.localStorage.getItem(chaveGerador), brutoGerador)
    const brutoSalvo = dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO)
    await click(botao('Salvar lote para depois'))
    assert.ok(query('[aria-label="Substituir lote preparado"]'))
    assert.equal(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO), brutoSalvo)
    await click(botao('Cancelar substituição'))
    await click(botao('Salvar lote para depois')); await click(botao('Substituir lote preparado'))
    assert.equal(rows.size, 0)
    await act(async () => root.unmount()); await mount()
    assert.equal(query('.flash-preview'), null)
    assert.match(query('.flash-prepared').textContent, /2 produtos/)
    assert.equal(query('[aria-label="Prévia do lote preparado"]'), null)
    // Outro lote corrente pode continuar sendo preparado independentemente.
    const htmlCorrente = html([card('MLB777', 1)])
    await fill(query('#flash-html'), htmlCorrente)
    await click(botao('Extrair ofertas')); await click(botao('Selecionar todas válidas')); await click(botao('Verificar selecionadas no Valiô'))
    await fill(query('#flash-categoria-MLB777'), 'Achados para Maridos')
    await fill(query('[aria-label="Prioridade de MLB777"]'), '50')
    const preparados = query('.flash-prepared')
    await click(botao('Carregar lote preparado', preparados))
    assert.equal(salvo().status, 'REVALIDAÇÃO NECESSÁRIA')
    assert.match(preparados.textContent, /Lote carregado. Revalide antes de publicar./)
    const antesSemValidar = chamadas.length
    assert.equal(botao('Gerar nova prévia do lote preparado', preparados).disabled, true)
    await click(botao('Gerar nova prévia do lote preparado', preparados))
    assert.equal(chamadas.length, antesSemValidar)
    falharConsulta = true
    await click(botao('Revalidar agora', preparados))
    assert.equal(salvo().status, 'REVALIDAÇÃO NECESSÁRIA')
    assert.equal(botao('Gerar nova prévia do lote preparado', preparados).disabled, true)
    falharConsulta = false
    await click(botao('Revalidar agora', preparados))
    assert.equal(salvo().status, 'PARCIALMENTE BLOQUEADO')
    assert.match(preparados.textContent, /Oferta expirada/)
    assert.match(preparados.textContent, /Revalidação parcial/)
    assert.equal(query('[aria-label="Prévia do lote preparado"]'), null)
    await click(botao('Gerar nova prévia do lote preparado', preparados))
    assert.ok(query('[aria-label="Prévia do lote preparado"]'))
    assert.equal(rows.size, 0)
    assert.doesNotMatch(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO), /token-preparado-secreto|nova-assinatura-preparada|assinatura|"previa"/)
    await click(botao('Confirmar publicação do lote preparado', preparados))
    assert.equal(rows.size, 1)
    assert.equal(rows.get('MLB8001').link_afiliado, 'https://meli.la/salvo1')
    assert.equal(rows.get('MLB8001').categoria, 'Achados para Elas')
    assert.equal(rows.get('MLB8001').prioridade_oferta, 100)
    assert.equal(salvo().itens[0].concluido, true)
    assert.equal(salvo().itens[1].concluido, false)
    assert.notEqual(salvo().status, 'FINALIZADO')
    const antesExcluir = chamadas.length
    await click(botao('Excluir lote preparado', preparados)); await click(botao('Confirmar exclusão do lote preparado', preparados))
    assert.equal(chamadas.length, antesExcluir)
    assert.equal(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO), null)
    assert.equal(dom.window.localStorage.getItem(chaveGerador), brutoGerador)
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'afiliados-intactos')
    assert.equal(query('#flash-html').value, htmlCorrente)
    assert.equal(query('#flash-categoria-MLB777').value, 'Achados para Maridos')
    assert.equal(query('[aria-label="Prioridade de MLB777"]').value, '50')
    assert.equal(query('.flash-preview input[type="checkbox"]').checked, true)
    assert.equal(rows.get('MLB8001').link_afiliado, 'https://meli.la/salvo1')
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('status revalidado salvo não autoriza após reload; edição exige nova consulta e conclusão persiste FINALIZADO', async () => {
  const { lote, CHAVE_LOTE_PREPARADO } = await fixturePreparado()
  lote.itens = [lote.itens[0]]
  lote.status = 'REVALIDADO'
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const chamadas = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (url, options) => {
      const body = JSON.parse(options.body); chamadas.push({ url, body })
      if (url.endsWith('/verificar')) return { ok: true, json: async () => ({ ok: true, existentes: [] }) }
      if (url.endsWith('/prever')) return { ok: true, json: async () => ({ ok: true, assinatura: 'assinatura-somente-memoria',
        previa: { modo: 'ENVIAR', operacoes: [{ itemId: 'MLB8001', produto: 'Produto 1', acao: 'CRIAR COMO OFERTA', prioridade: 50 }] } }) }
      assert.ok(url.endsWith('/confirmar'))
      return { ok: true, json: async () => ({ ok: true, criadas: 1, ativadas: 0, atualizadas: 0, desativadas: 0, semAlteracao: 0,
        conflitos: 0, erros: 0, itens: [{ itemId: 'MLB8001', resultado: 'CRIADA' }] }) }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Panel }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/features/ofertas-relampago/LotePreparadoPanel.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    dom.window.localStorage.setItem(CHAVE_LOTE_PREPARADO, JSON.stringify(lote))
    const query = (s) => dom.window.document.querySelector(s)
    const botao = (s) => [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent.trim() === s)
    const click = async (el) => { assert.ok(el); await act(async () => el.click()) }
    const mount = async () => {
      root = createRoot(query('#root'))
      await act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token: 'token-nunca-salvo' } },
        createElement(Panel, { criarAtual: () => lote, podeSalvar: false }))))
    }
    await mount()
    assert.equal(chamadas.length, 0)
    assert.equal(botao('Confirmar publicação do lote preparado'), undefined)
    await click(botao('Carregar lote preparado'))
    assert.match(query('.flash-prepared').textContent, /REVALIDAÇÃO NECESSÁRIA/)
    assert.equal(botao('Gerar nova prévia do lote preparado').disabled, true)
    await click(botao('Revalidar agora'))
    assert.equal(JSON.parse(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO)).status, 'REVALIDADO')
    assert.match(query('.flash-prepared').textContent, /Lote revalidado. Gere uma nova prévia antes da confirmação./)
    const editar = async (indice, valor) => act(async () => {
      const select = query('.flash-prepared-items li').querySelectorAll('select')[indice]
      select.value = valor; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await editar(0, 'Achados para Presentear'); await editar(1, '50')
    assert.equal(botao('Gerar nova prévia do lote preparado').disabled, true)
    const atualizado = JSON.parse(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO))
    assert.equal(atualizado.itens[0].categoria, 'Achados para Presentear')
    assert.equal(atualizado.itens[0].prioridade, 50)
    assert.equal(atualizado.itens[0].linkMeli, 'https://meli.la/salvo1')
    await click(botao('Revalidar agora')); await click(botao('Gerar nova prévia do lote preparado'))
    const pedido = chamadas.find((c) => c.url.endsWith('/prever')).body
    assert.equal(pedido.exigirPrazoValido, true)
    assert.equal(pedido.itens[0].dados.categoria, 'Achados para Presentear')
    assert.equal(pedido.itens[0].dados.prioridadeOferta, 50)
    assert.doesNotMatch(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO), /assinatura-somente-memoria|token-nunca-salvo/)
    await click(botao('Confirmar publicação do lote preparado'))
    assert.equal(JSON.parse(dom.window.localStorage.getItem(CHAVE_LOTE_PREPARADO)).status, 'FINALIZADO')
    await act(async () => root.unmount()); await mount()
    assert.match(query('.flash-prepared').textContent, /Status: FINALIZADO/)
    assert.equal(botao('Carregar lote preparado').disabled, true)
    assert.equal(botao('Confirmar publicação do lote preparado'), undefined)
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('prévia mantém 2 de 20 selecionados, bloqueia controles em loading e rejeita seleção antiga antes de confirmar', async () => {
  const [{ criarRegistroSnapshot }, { registrarRetornoLote }, { resolverUrlGerador }, backend] = await Promise.all([
    vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts'),
    vite.ssrLoadModule('/src/features/ofertas-relampago/cicloLote.ts'),
    vite.ssrLoadModule('/src/features/ofertas-relampago/urlGerador.ts'),
    vite.ssrLoadModule('/server/ofertasRelampagoLote.ts'),
  ])
  const cards = Array.from({ length: 21 }, (_, i) => card(`MLB${6001 + i}`, i + 1))
  const ofertas = extrairOfertasRelampagoHtml(html(cards), '')
  const registro = registrarRetornoLote(criarRegistroSnapshot({ produtos: ofertas.slice(0, 20).map((o, i) => ({
    ordem: i + 1, itemId: o.itemId, titulo: o.titulo, urlOriginal: resolverUrlGerador(o).url, urlNormalizada: resolverUrlGerador(o).url,
  })) }), ofertas.slice(0, 20).map((_, i) => `https://meli.la/preservar${i}`).join('\n'))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  dom.window.localStorage.setItem('valio-garimpa:flash-batch-snapshot:v1', JSON.stringify(registro))
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const anteriores = new Map(globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const pedidos = [], publicados = []
  let liberar, confirmacoes = 0, assinaturaEmitida
  const gateway = { buscar: async () => [], listarAtivas: async () => [],
    inserir: async (produto) => publicados.push(produto.mercado_livre_id), atualizar: async () => assert.fail('Somente produtos novos') }
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true,
    value: k === 'fetch' ? async (url, options) => {
      const body = JSON.parse(options.body)
      const resposta = (dados) => ({ ok: true, json: async () => ({ ok: true, ...dados }) })
      if (url.endsWith('/verificar')) return resposta({ existentes: [] })
      if (url.endsWith('/prever')) {
        pedidos.push(body)
        const previa = await backend.criarPreviaOfertas(body, gateway)
        assinaturaEmitida = backend.assinarPrevia(previa, 'segredo-teste')
        return new Promise((resolve) => { liberar = () => resolve(resposta({ previa, assinatura: assinaturaEmitida })) })
      }
      assert.ok(url.endsWith('/confirmar'))
      assert.deepEqual(Object.keys(body).sort(), ['assinatura', 'previa'])
      assert.equal(backend.validarAssinatura(body.previa, body.assinatura, 'segredo-teste'), true)
      assert.equal(body.assinatura, assinaturaEmitida)
      confirmacoes++
      return resposta(await backend.confirmarPreviaOfertas(body.previa, gateway, undefined, [], async () => {}))
    } : dom.window[k] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'), vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token: 'teste' } }, createElement(Page))))
    const query = (s) => dom.window.document.querySelector(s)
    const botao = (texto) => [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent.trim() === texto)
    const checkbox = (n) => query(`[aria-label="Selecionar oferta ${n}"]`)
    const click = async (el) => { assert.ok(el); await act(async () => el.click()) }
    const fill = async (el, value) => act(async () => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
    const iniciar = async (parcial = false) => {
      await click(botao(parcial ? 'Prévia somente das ofertas compatíveis — preservar seleção' : 'Enviar selecionadas para Ofertas Relâmpago'))
      assert.ok(liberar)
      assert.deepEqual(pedidos.at(-1).itens.map((i) => i.dados.mercadoLivreId), ['MLB6001', 'MLB6002'])
      assert.equal([...query('.flash-preview').querySelectorAll('input[type="checkbox"]')].every((c) => c.disabled), true)
      for (const label of ['Selecionar todas válidas', 'Limpar seleção', 'Limpar ofertas atuais', 'Extrair ofertas']) assert.equal(botao(label).disabled, true)
      await click(checkbox(3))
      await click(botao('Selecionar todas válidas'))
      assert.equal(checkbox(3).checked, false)
      await act(async () => liberar())
      liberar = null
      assert.equal(query('[aria-label="Prévia de gravação"]').querySelectorAll('tbody tr').length, 2)
      assert.equal(checkbox(3).disabled, false)
    }
    await fill(query('#flash-html'), html(cards))
    await click(botao('Extrair ofertas'))
    await click(checkbox(1)); await click(checkbox(2))
    await click(botao('Verificar selecionadas no Valiô'))
    for (const categoria of query('.flash-preview').querySelectorAll('.flash-category select')) await fill(categoria, 'Achados para Casa')
    await iniciar()
    // Alteração e clique na confirmação no mesmo lote de eventos: o handler
    // antigo ainda está montado; a versão síncrona deve impedir a gravação.
    const confirmarAntigo = botao('Confirmar ativação de 2 oferta(s)')
    await act(async () => { checkbox(3).click(); confirmarAntigo.click() })
    const mensagem = 'A seleção mudou após a geração da prévia. Gere uma nova prévia antes de confirmar.'
    assert.match(query('.flash-import').textContent, new RegExp(mensagem.replaceAll('.', '\\.')))
    assert.equal(query('[aria-label="Prévia de gravação"]'), null)
    assert.equal(confirmacoes, 0)
    await click(checkbox(3))
    // A seleção manual inclui um incompatível; somente os dois compatíveis
    // entram na prévia. Retirar o excluído também deve invalidar essa prévia.
    await click(checkbox(21))
    await click(botao('Verificar selecionadas no Valiô'))
    await iniciar(true)
    assert.equal(checkbox(21).checked, true)
    await click(checkbox(21))
    assert.equal(query('[aria-label="Prévia de gravação"]'), null)
    assert.ok(query('.flash-import').textContent.includes(mensagem))
    assert.equal(confirmacoes, 0)
    await iniciar()
    await click(botao('Confirmar ativação de 2 oferta(s)'))
    assert.equal(confirmacoes, 1)
    assert.deepEqual(publicados, ['MLB6001', 'MLB6002'])
    assert.equal(checkbox(1).checked, true)
    assert.equal(checkbox(2).checked, true)
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:flash-batch-snapshot:v1').includes('https://meli.la/preservar19'), true)
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const k of globals) { const anterior = anteriores.get(k); if (anterior) Object.defineProperty(globalThis, k, anterior); else delete globalThis[k] }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test('verificação habilita para seleção manual parcial e consulta somente seus ITEM_IDs', async () => {
  const ids = ['MLB6782961960', 'MLB3909054631', 'MLB6003', 'MLB6004', 'MLB6005', 'MLB6006']
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ofertas-relampago' })
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'Element', 'fetch']
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls = []
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === 'fetch' ? async (url, options) => {
      assert.equal(url, '/api/valio/produtos/verificar')
      calls.push(JSON.parse(options.body).mercadoLivreIds)
      return { ok: true, json: async () => ({ ok: true, existentes: [] }) }
    } : dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const [{ createRoot }, { act, createElement }, { default: Page }, { ContextoSessao }] = await Promise.all([
      import('react-dom/client'), import('react'), vite.ssrLoadModule('/src/pages/OfertasRelampagoPage.tsx'),
      vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts'),
    ])
    root = createRoot(dom.window.document.getElementById('root'))
    const render = async (token) => act(async () => root.render(createElement(ContextoSessao.Provider, { value: { token } }, createElement(Page))))
    const button = (label) => [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
    const verify = () => button('Verificar selecionadas no Valiô')
    const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
    const checkbox = (position) => dom.window.document.querySelector(`[aria-label="Selecionar oferta ${position}"]`)
    const fill = async (element, value) => act(async () => {
      Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await render('token-teste')
    await fill(dom.window.document.querySelector('#flash-html'), html(ids.map((id, index) => card(id, index + 1))))
    await click(button('Extrair ofertas'))
    assert.equal(verify().disabled, true)
    await click(checkbox(1))
    assert.equal(verify().disabled, false)
    await click(verify())
    assert.deepEqual(calls.at(-1), ids.slice(0, 1))
    await click(checkbox(2))
    assert.match(dom.window.document.querySelector('.flash-selecionadas').textContent, /2 ofertas selecionadas/)
    assert.equal(verify().disabled, false)
    await click(verify())
    assert.deepEqual(calls.at(-1), ids.slice(0, 2))
    for (const position of [3, 4, 5]) await click(checkbox(position))
    assert.equal(verify().disabled, false)
    await click(verify())
    assert.deepEqual(calls.at(-1), ids.slice(0, 5))
    await click(button('Selecionar todas válidas'))
    assert.equal(verify().disabled, false)
    await click(verify())
    assert.deepEqual(calls.at(-1), ids)
    await click(button('Limpar seleção'))
    assert.equal(verify().disabled, true)
    assert.equal(calls.length, 4)
    await click(checkbox(1))
    await render('')
    assert.equal(verify().disabled, true)
    assert.equal(checkbox(1).checked, true)
    assert.equal(calls.length, 4)
  } finally {
    if (root) { const { act } = await import('react'); await act(async () => root.unmount()) }
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test.after(async () => vite.close())
