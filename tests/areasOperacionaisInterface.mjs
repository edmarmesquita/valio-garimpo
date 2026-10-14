import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'

test('rotas diretas e navegação compartilham token somente em memória', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url) => ({ ok: true, json: async () =>
      url === '/api/garimpo/status' ? { ok: true, garimpo: 'Valiô Garimpo', status: 'pronto' }
        : url === '/api/valio/catalogo' ? { ok: true, produtos: [] }
          : url === '/api/valio/produtos/verificar' ? { ok: true, existentes: [] } : { connected: false } })
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Roteador } = await vite.ssrLoadModule('/src/app/Roteador.tsx')
    const { SessaoOperacionalProvider } = await vite.ssrLoadModule('/src/app/SessaoOperacional.tsx')
    root = createRoot(document.getElementById('root'))
    const montar = () => createElement(SessaoOperacionalProvider, null, createElement(Roteador))
    await act(async () => root.render(montar()))
    const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    const token = document.getElementById('token-publicacao')
    await act(async () => { setInput.call(token, 'token-somente-em-memoria'); token.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    const textarea = document.getElementById('json-afiliados')
    const setTextarea = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => { setTextarea.call(textarea, '{"results":[]}'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Extrair produtos').click())
    for (const [path, titulo] of [
      ['/manutencao', 'Manutenção da vitrine'], ['/links-afiliados', 'Links afiliados'],
      ['/precos', 'Preços'], ['/diagnostico', 'Diagnóstico e métricas'],
      ['/extrair-afiliados', 'Produtos garimpados'],
    ]) {
      const link = document.querySelector(`.garimpo-navegacao a[href="${path}"]`)
      await act(async () => link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
      assert.equal(dom.window.location.pathname, path)
      assert.ok([...document.querySelectorAll('h1')].some((item) => item.textContent === titulo))
      assert.equal(document.getElementById('token-publicacao').value, 'token-somente-em-memoria')
      if (path === '/extrair-afiliados') {
        assert.ok(document.querySelector('.extrair-resumo'))
        assert.equal(document.getElementById('json-afiliados').value, '{"results":[]}')
      }
      if (path === '/precos') {
        await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Carregar catálogo').click())
        assert.ok(document.querySelector('.fila-revisao'))
      }
      if (path === '/diagnostico') assert.match(document.querySelector('.extrair-diagnostico').textContent, /IDs enviados: 0/)
    }
    await act(async () => document.querySelector('.garimpo-navegacao a[href="/"]').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
    await act(async () => document.querySelector('.garimpo-link').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
    assert.equal(dom.window.location.pathname, '/extrair-afiliados')
    assert.equal(document.getElementById('token-publicacao').value, 'token-somente-em-memoria')
    assert.equal(dom.window.localStorage.length, 0)
    assert.equal(dom.window.sessionStorage.length, 0)
    await act(async () => root.unmount())
    root = null
    for (const [path, titulo] of [
      ['/', 'Valiô Garimpo'], ['/importar-produtos', 'Importar produtos'],
      ['/extrair-afiliados', 'Produtos garimpados'], ['/manutencao', 'Manutenção da vitrine'],
      ['/links-afiliados', 'Links afiliados'], ['/precos', 'Preços'], ['/diagnostico', 'Diagnóstico e métricas'],
    ]) {
      dom.window.history.replaceState(null, '', path)
      root = createRoot(document.getElementById('root'))
      await act(async () => root.render(montar()))
      assert.ok([...document.querySelectorAll('h1')].some((item) => item.textContent === titulo))
      await act(async () => root.unmount())
      root = null
    }
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    for (const path of ['/extrair-afiliados', '/importar-produtos', '/manutencao', '/links-afiliados', '/precos', '/diagnostico']) {
      assert.ok(vercel.rewrites.some((item) => item.source === path && item.destination === '/index.html'))
    }
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
