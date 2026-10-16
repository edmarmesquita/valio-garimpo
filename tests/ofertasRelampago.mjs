import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
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
    await act(async () => {
      const select = query('.flash-category select')
      select.value = 'Achados para Casa'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await click(button('Preparar ofertas selecionadas'))
    assert.equal(scrolls.at(-1), query('.flash-payload'))
    assert.match(query('.flash-payload').textContent, /1 pronta\(s\) · 1 bloqueada\(s\)/)
    await click(button('Preparar lote para o Gerador'))
    const snapshotKey = 'valio-garimpa:flash-batch-snapshot:v1'
    assert.equal(scrolls.at(-1), query('.flash-generator'))
    assert.ok(dom.window.localStorage.getItem(snapshotKey))
    assert.equal(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1'), 'snapshot-existente')
    await fill(query('#flash-retorno'), 'https://meli.la/novo')
    await click(button('Preparar ofertas selecionadas'))
    assert.match(query('.flash-payload').textContent, /2 pronta\(s\) · 0 bloqueada\(s\)/)
    assert.match(query('.flash-preview').textContent, /2 ofertas selecionadas/)
    await act(async () => {
      const prioridade = query('[aria-label="Prioridade de MLB123"]')
      prioridade.value = '100'
      prioridade.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
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
    assert.equal(linhas[0].cells[11].textContent, 'AUSENTE')
    assert.equal(linhas[1].cells[11].textContent, 'DISPONÍVEL')
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
    const antesFallback = scrolls.length
    await act(async () => {
      const input = query('#flash-origem')
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input,
        'https://produto.mercadolivre.com.br/MLB-7614206226-produto')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(scrolls.length, antesFallback)
    assert.match(linhas[0].ownerDocument.body.textContent, /URL PARA GERADOR DISPONÍVEL/)
    assert.match(query('.flash-preview').textContent, /URL da página de origem usada/)
    await click(button('Preparar lote para o Gerador'))
    assert.equal(scrolls.length, antesFallback + 1)
    assert.equal(query('#flash-urls-gerador').value, 'https://produto.mercadolivre.com.br/MLB-7614206226-produto')
    await click(button('Preparar ofertas selecionadas'))
    assert.doesNotMatch(query('.flash-import').textContent, /snapshot do Gerador pertence a outro lote/)
    assert.deepEqual(calls.map(([url]) => url), ['/api/valio/produtos/verificar', '/api/valio/produtos/verificar'])
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

test('URL do Gerador preserva original e limita fallback à origem do mesmo item', async () => {
  const { resolverUrlGerador } = await vite.ssrLoadModule('/src/features/ofertas-relampago/urlGerador.ts')
  const original = 'https://www.mercadolivre.com.br/original/p/MLB123'
  const origem = 'https://produto.mercadolivre.com.br/MLB-123-produto'
  assert.deepEqual(resolverUrlGerador({ itemId: 'MLB123', urlOriginal: original }, origem), { url: original, fallback: false })
  assert.deepEqual(resolverUrlGerador({ itemId: 'MLB123', urlOriginal: null }, origem), { url: origem, fallback: true })
  for (const invalida of ['', 'https://www.mercadolivre.com.br/ofertas', 'https://www.mercadolivre.com.br/ofertas?foo=MLB123', 'https://exemplo.com/MLB123',
    'https://produto.mercadolivre.com.br/MLB-456-outro', 'https://www.mercadolivre.com.br/MLB123?wid=MLB456',
    'https://www.mercadolivre.com.br/%zz/MLB123']) {
    assert.equal(resolverUrlGerador({ itemId: 'MLB123', urlOriginal: null }, invalida).url, null)
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

test.after(async () => vite.close())
