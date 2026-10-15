import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('prévia da lista e cópia de URLs ficam isoladas dos fluxos de publicação', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root
  let vite
  const chamadas = []
  const copiados = []
  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (texto) => { copiados.push(texto) } } })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (...args) => { chamadas.push(args); throw new Error('Requisição inesperada') }

    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: ExtrairAfiliados } = await vite.ssrLoadModule('/src/pages/ExtrairAfiliados.tsx')
    const { SessaoOperacionalProvider } = await vite.ssrLoadModule('/src/app/SessaoOperacional.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(SessaoOperacionalProvider, null, createElement(ExtrairAfiliados))))

    assert.ok(document.getElementById('json-afiliados'))
    assert.ok(document.getElementById('html-produto'))
    assert.ok(document.getElementById('link-html-produto'))
    assert.equal(document.querySelector('.lista-afiliados #link-html-produto'), null)

    const entrada = JSON.stringify({ type: 'affiliate', polycards: [
      { metadata: { id: 'MLB2', url: 'www.mercadolivre.com.br/dois' }, title: 'Produto dois' },
      { metadata: { id: 'MLB1', url: 'produto.mercadolivre.com.br/MLB-1' } },
      { metadata: { id: 'MLB2', url: 'www.mercadolivre.com.br/duplicado' } },
    ] })
    const textarea = document.getElementById('html-lista-afiliados')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => { setter.call(textarea, `<script>window.lista = ${entrada};</script>`)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    await act(async () => botao('Extrair produtos da lista').click())
    assert.equal(document.querySelectorAll('.lista-afiliados-tabela tbody tr').length, 2)
    assert.deepEqual([...document.querySelectorAll('.lista-afiliados-contadores strong')].map((item) => item.textContent), ['3', '2', '0', '1'])
    assert.equal(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]').value,
      'https://www.mercadolivre.com.br/dois\nhttps://produto.mercadolivre.com.br/MLB-1')
    assert.equal(document.querySelectorAll('.extrair-produto').length, 0)
    assert.equal(document.querySelector('#json-valio-titulo'), null)
    await act(async () => botao('Copiar URLs').click())
    assert.deepEqual(copiados, ['https://www.mercadolivre.com.br/dois\nhttps://produto.mercadolivre.com.br/MLB-1'])
    const retorno = document.getElementById('retorno-gerador-lista')
    await act(async () => { setter.call(retorno, 'https://meli.la/dois\n⚠️ Este produto não cumpre com os requisitos do Programa.')
      retorno.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await act(async () => botao('Processar retorno').click())
    assert.deepEqual([...document.querySelectorAll('.lista-afiliados-pareamento tbody tr')].map((linha) => linha.cells[1].textContent), ['MLB2', 'MLB1'])
    assert.equal(document.querySelector('[aria-label="Bloco ITEM_ID | link"]').value, 'MLB2 | https://meli.la/dois')
    await act(async () => botao('Copiar bloco ITEM_ID | link').click())
    assert.equal(copiados[1], 'MLB2 | https://meli.la/dois')
    await act(async () => { setter.call(retorno, 'https://meli.la/dois')
      retorno.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await act(async () => botao('Processar retorno').click())
    assert.match(document.querySelector('.lista-afiliados-pareamento [role="alert"]').textContent, /Lote inconsistente/)
    assert.equal(botao('Copiar bloco ITEM_ID | link').disabled, true)
    assert.deepEqual(chamadas, [])
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    Object.assign(globalThis, { window: original.window, document: original.document, HTMLElement: original.HTMLElement,
      fetch: original.fetch, IS_REACT_ACT_ENVIRONMENT: original.actEnvironment })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
  }
})
