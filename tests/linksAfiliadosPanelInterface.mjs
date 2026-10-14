import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('painel de links individual funciona fora da Manutenção', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/links-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  const chamadas = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      return { ok: true, json: async () => ({ ok: true, produto: 'Produto de teste', mercado_livre_id: 'MLB123',
        link_anterior: 'https://mercadolivre.com.br/MLB123', link_afiliado: 'https://meli.la/ABC123' }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: LinksAfiliadosPanel } = await vite.ssrLoadModule('/src/components/LinksAfiliadosPanel.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(LinksAfiliadosPanel, { token: 'token-de-teste' })))
    const [id, link] = document.querySelectorAll('.vitrine-atualizar-link input')
    const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setInput.call(id, 'MLB123'); id.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      setInput.call(link, 'https://meli.la/ABC123'); link.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => document.querySelector('.vitrine-atualizar-link').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, '/api/valio/produtos/link-afiliado')
    assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
    assert.deepEqual(JSON.parse(chamadas[0].options.body), { mercado_livre_id: 'MLB123', link_afiliado: 'https://meli.la/ABC123' })
    assert.match(document.querySelector('.vitrine-link-resultado').textContent, /Link novo: https:\/\/meli.la\/ABC123/)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.fetch = original.fetch
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
  }
})
