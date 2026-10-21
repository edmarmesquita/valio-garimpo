import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'

test('prévia local combina arquivos, filtra, bloqueia catálogo indisponível, mostra conflitos e limpa sem requests', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/precos' })
  const original = { window: globalThis.window, document: globalThis.document,
    navigator: globalThis.navigator, HTMLElement: globalThis.HTMLElement,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let vite; let root; let requests = 0
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async () => { requests++; throw new Error('A importação não pode enviar requests') }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Revisao } = await vite.ssrLoadModule('/src/pages/RevisaoHarAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    const render = async (catalogo, erroCatalogo = '') => act(async () => root.render(createElement(Revisao, { catalogo, erroCatalogo, carregandoCatalogo: false })))
    const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
    const selecionar = async (...files) => {
      const input = document.getElementById('har-arquivos')
      Object.defineProperty(input, 'files', { configurable: true, value: files })
      await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    }
    const file = (nome, ...cards) => ({ name: nome, size: 100, text: async () => arquivoHar(entradaHar(cards)) })
    await render(null)
    await selecionar(file('a.har', cardHar()))
    assert.match(document.body.textContent, /a.har/)
    await act(async () => button('Analisar HAR').click())
    assert.match(document.body.textContent, /Carregar catálogo/)
    assert.equal(document.querySelectorAll('tbody tr').length, 0)
    await render([catalogoHar()])
    assert.match(document.querySelector('tbody').textContent, /MLB123.*ALTERADO/s)
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 1)
    await act(async () => document.querySelector('input[type="checkbox"]').click())
    await act(async () => button('Gerar prévia de atualização').click())
    assert.match(document.querySelector('.har-previa-final').textContent, /MLB123/)
    assert.match(document.querySelector('.har-previa-final').textContent, /100,00.*90,00/s)
    await act(async () => button('Limpar seleção').click())
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    const selecionarTodos = async () => act(async () => button('Selecionar todos os candidatos seguros').click())
    const previa = async () => act(async () => button('Gerar prévia de atualização').click())
    await selecionarTodos(); await previa()
    assert.match(document.body.textContent, /1 produtos selecionados de 1 candidatos seguros/)
    await render([catalogoHar('MLB123', { preco: 110 })])
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    await selecionarTodos(); await previa()
    await selecionar(file('b.json', cardHar('MLB123', 95), cardHar('MLB999', 50, { label: '10% OFF no Pix' })))
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    await act(async () => button('Analisar HAR').click())
    await render([catalogoHar(), catalogoHar('MLB999', { ofertaRelampago: true })])
    assert.match(document.querySelector('tbody').textContent, /CONFLITO ENTRE CAPTURAS/)
    assert.match(document.querySelector('tbody').textContent, /a.har:.*90,00.*b.json:.*95,00/s)
    assert.match(document.querySelector('tbody').textContent, /OFERTA_PROTEGIDA/)
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 0)
    const filtro = document.getElementById('har-filtro')
    await act(async () => { filtro.value = 'Conflitos'; filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelectorAll('tbody tr').length, 1)
    await render(null, 'HTTP 401: autenticação recusada')
    assert.match(document.body.textContent, /comparação está bloqueada/)
    assert.equal(document.querySelectorAll('tbody tr').length, 0)
    await render([catalogoHar()])
    await selecionar({ name: 'invalido.har', size: 1, text: async () => '{SEGREDO' })
    await act(async () => button('Analisar HAR').click())
    assert.match(document.body.textContent, /lote não foi incorporado/)
    assert.doesNotMatch(document.body.textContent, /SEGREDO/)
    assert.match(document.querySelector('tbody').textContent, /CONFLITO_HAR/)
    assert.equal(document.querySelectorAll('a, img, iframe').length, 0)
    assert.equal([...document.querySelectorAll('button')].some((b) => /confirmar|update|atualizar/i.test(b.textContent)), false)
    // CSV funciona mesmo com a API indisponível e não mistura as fontes.
    await render(null, 'Não foi possível conectar à API da vitrine.')
    const csvInput = document.getElementById('har-catalogo-csv')
    Object.defineProperty(csvInput, 'files', { configurable: true, value: [{ name: 'catalogo.csv', size: 100,
      text: async () => 'mercado_livre_id,preco,ativo,oferta_relampago,titulo\nMLB999,100,true,true,CSV local' }] })
    await act(async () => csvInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.match(document.body.textContent, /Fonte do catálogo: CSV local/)
    assert.match(document.body.textContent, /catalogo.csv/)
    assert.doesNotMatch(document.body.textContent, /comparação está bloqueada/)
    assert.equal(document.querySelectorAll('tbody tr').length, 1)
    assert.match(document.querySelector('tbody').textContent, /MLB999.*OFERTA_PROTEGIDA/s)
    assert.doesNotMatch(document.querySelector('tbody').textContent, /MLB123/)
    await render([catalogoHar()])
    assert.match(document.querySelector('tbody').textContent, /MLB999/)
    const fonte = document.getElementById('har-fonte-catalogo')
    await act(async () => { fonte.value = 'api'; fonte.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.match(document.body.textContent, /Fonte do catálogo: API da vitrine/)
    assert.match(document.querySelector('tbody').textContent, /MLB123/)
    assert.doesNotMatch(document.querySelector('tbody').textContent, /MLB999/)
    await act(async () => button('Limpar análise').click())
    assert.equal(document.querySelectorAll('tbody tr').length, 0)
    assert.doesNotMatch(document.body.textContent, /a.har|b.json|CONFLITO_HAR/)
    assert.doesNotMatch(document.body.textContent, /catalogo.csv/)
    // Nova análise: somente dois seguros entre quatro produtos; filtros não ampliam a elegibilidade.
    await selecionar(file('seguros.har', cardHar(), cardHar('MLB999', 120, { label: '10% OFF' }),
      cardHar('MLB888', 80, { label: 'Pix' }), cardHar('MLB777', 100)))
    await act(async () => button('Analisar HAR').click())
    await render([catalogoHar(), catalogoHar('MLB999'), catalogoHar('MLB888'), catalogoHar('MLB777')])
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 2)
    await selecionarTodos(); await previa()
    assert.equal(document.querySelectorAll('.har-previa-final tbody tr').length, 2)
    assert.doesNotMatch(document.querySelector('.har-previa-final').textContent, /MLB888|MLB777/)
    await act(async () => { fonte.value = 'csv'; fonte.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelector('.har-previa-final'), null)
    await act(async () => { fonte.value = 'api'; fonte.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal([...document.querySelectorAll('input[type="checkbox"]')].some((c) => c.checked), false)
    await selecionarTodos(); await previa()
    const novoCsv = { name: 'novo.csv', size: 100, text: async () => 'mercado_livre_id,preco,ativo,oferta_relampago\nMLB123,100,true,false' }
    Object.defineProperty(csvInput, 'files', { configurable: true, value: [novoCsv] })
    await act(async () => csvInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    await selecionarTodos(); await previa()
    assert.match(document.querySelector('.har-previa-final').textContent, /CSV local/)
    Object.defineProperty(csvInput, 'files', { configurable: true, value: [{ ...novoCsv, name: 'outro.csv' }] })
    await act(async () => csvInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    await selecionarTodos(); await previa()
    await act(async () => button('Limpar análise').click())
    assert.equal(document.querySelector('.har-previa-final'), null)
    assert.equal(requests, 0)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch; dom.window.close()
  }
})
