import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const linkUm = 'https://www.mercadolivre.com.br/produto-um?extra_comm=true&tag=a%2Fb#sid=affiliates'
const linkDois = 'https://www.mercadolivre.com.br/produto-dois?extra_comm=false&src=teste#sid=affiliates'
const card = (id, titulo, preco, link) => ({
  unique_id: id,
  metadata: {
    id, url: link?.split('?')[0], url_params: link ? `?${link.split('?')[1].split('#')[0]}` : undefined,
    url_fragments: link ? `#${link.split('#')[1]}` : undefined,
  },
  pictures: [],
  components: [
    { id: 'title', title: { text: titulo } },
    { id: 'price', price: { current_price: { value: preco, currency: 'BRL' } } },
  ],
})
const entrada = JSON.stringify({ results: [
  card('MLB1', 'Produto um', 169.99, linkUm),
  card('MLB2', 'Produto dois', 49.9, linkDois),
  card('MLB3', 'Produto sem link', 25, null),
] })

test('a interface gera e mostra JSON para o Valiô com dois selecionados e erro junto ao botão', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = {
    window: globalThis.window, document: globalThis.document,
    navigator: globalThis.navigator, HTMLElement: globalThis.HTMLElement,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  let root
  let vite
  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: ExtrairAfiliados } = await vite.ssrLoadModule('/src/pages/ExtrairAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(ExtrairAfiliados)))

    const textarea = document.getElementById('json-afiliados')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(textarea, entrada)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => document.querySelector('button').click())
    assert.equal(document.querySelectorAll('.extrair-produto').length, 3)
    assert.equal(document.querySelector('#json-valio-titulo'), null)

    for (const indice of [0, 1]) {
      await act(async () => document.querySelectorAll('.extrair-selecao input')[indice].click())
      const select = document.querySelectorAll('.extrair-categoria select')[indice]
      await act(async () => {
        select.value = indice === 0 ? 'Achados para Elas' : 'Achados para Casa'
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      })
    }
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Gerar produtos para o Valiô').click())
    const secao = document.querySelector('[aria-labelledby="json-valio-titulo"]')
    assert.ok(secao)
    assert.match(secao.textContent, /2 produtos gerados/)
    assert.match(secao.querySelector('[role="status"]').textContent, /gerado com sucesso/)
    assert.equal(secao.querySelector('button').textContent, 'Copiar JSON para o Valiô')
    const gerados = JSON.parse(secao.querySelector('pre').textContent)
    assert.equal(gerados.length, 2)
    assert.deepEqual(gerados.map((p) => p.category), ['Achados para Elas', 'Achados para Casa'])
    assert.deepEqual(gerados.map((p) => p.link), [linkUm, linkDois])
    assert.match(gerados[0].priceReferenceDate, /^\d{2}\/\d{2}$/)
    assert.equal(gerados[0].price, 169.99)
    assert.equal(document.querySelectorAll('[aria-label="JSON normalizado do Garimpa"]').length, 1)

    await act(async () => document.querySelectorAll('.extrair-selecao input')[2].click())
    await act(async () => {
      const select = document.querySelectorAll('.extrair-categoria select')[2]
      select.value = 'Achados para Presentear'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Gerar produtos para o Valiô').click())
    assert.equal(document.querySelector('#json-valio-titulo'), null)
    assert.match(document.querySelector('.extrair-erro-exportacao').textContent, /Produto sem link: link original/)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window
    globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
  }
})
