import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act } from 'react'
import { extrairIdItem, processarLinks, validarLink } from '../src/lib/processarLinks.ts'

const link = 'https://www.mercadolivre.com.br/colchao-inflavel-casal-com-inflador-embutido-multiuso-homefy/p/MLB29179705?pdp_filters=deal%3AMLB1578289-1&extra_comm=false&brand_comm=false#polycard_client=affiliates&wid=MLB3910897819&sid=affiliates'

test('o submit de ImportarProdutos aceita o anúncio no fragmento e inicia o POST', async () => {
  assert.equal(validarLink(link), undefined)
  assert.equal(extrairIdItem(link), 'MLB3910897819')
  assert.equal(processarLinks(link)[0].status, 'valido')

  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/importar-produtos' })
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    fetch: globalThis.fetch,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  const requests = []
  let root
  let vite

  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ source: 'api-catalog', produto: {
        id: 'MLB29179705', titulo: 'Colchão inflável', preco: null, moeda: null,
        imagemPrincipal: null, permalink: link, status: 'active', quantidadeDisponivel: null,
      } }) }
    }

    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: ImportarProdutos } = await vite.ssrLoadModule('/src/pages/ImportarProdutos.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render((await import('react')).createElement(ImportarProdutos)))

    const textarea = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(textarea, link)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(textarea.value, link)

    await act(async () => {
      document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    assert.equal(requests.length, 1, document.querySelector('[role="alert"]')?.textContent)
    assert.equal(requests[0].url, '/api/mercadolivre/produto')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), { link })
    assert.match(document.body.textContent, /Consulte o preço no Mercado Livre/)
    assert.doesNotMatch(document.body.textContent, /0,00/)
    assert.equal(document.querySelector('a[href*="MLB29179705"]')?.href, link)

    const semHash = new URL(link)
    semHash.hash = ''
    await act(async () => {
      setter.call(textarea, semHash.href)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(requests.length, 1)

    await act(async () => {
      setter.call(textarea, `${link}&access_token=segredo-de-teste`)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(requests.length, 2)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window
    globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement
    globalThis.fetch = original.fetch
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
  }
})
