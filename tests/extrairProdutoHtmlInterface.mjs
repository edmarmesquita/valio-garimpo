import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('HTML manual cria card sem carregar imagem, verifica duplicidade e reutiliza envio', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root
  let vite
  let duplicado = true
  const chamadas = []
  const link = 'https://meli.la/1um2MX7'
  const produto = { id: 'MLB6367832860', name: { text: 'Produto principal' },
    price: { current_value: { value: { fraction: '63', cents: '50' } } },
    image: 'https://http2.mlstatic.com/produto.webp' }
  const html = `<script type="application/json">${JSON.stringify({ product: produto, recommendations: [{ id: 'MLB123', title: 'Outro', price: 1, image: 'https://http2.mlstatic.com/outro.webp' }] })}</script>`
  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      if (url === '/api/valio/produtos/verificar') return { ok: true, json: async () => ({ ok: true,
        existentes: duplicado ? [{ mercadoLivreId: produto.id, titulo: produto.name.text, preco: 63.5,
          categoria: 'Achados para Casa', linkAfiliado: link, imagem: produto.image, ativo: true }] : [] }) }
      if (url === '/api/valio/produtos') return { ok: true, json: async () => ({ ok: true, acao: 'criado' }) }
      throw Error(`Requisição inesperada: ${url}`)
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: ExtrairAfiliados } = await vite.ssrLoadModule('/src/pages/ExtrairAfiliados.tsx')
    const { SessaoOperacionalProvider } = await vite.ssrLoadModule('/src/app/SessaoOperacional.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(SessaoOperacionalProvider, null, createElement(ExtrairAfiliados))))
    const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    const setTextarea = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      const token = document.getElementById('token-publicacao')
      setInput.call(token, 'token-de-teste')
      token.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      const urlPagina = document.getElementById('url-pagina-html')
      setInput.call(urlPagina, 'https://www.mercadolivre.com.br/produto?pdp_filters=item_id%3AMLB6367832860')
      urlPagina.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      const texto = document.getElementById('html-produto')
      setTextarea.call(texto, html)
      texto.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      const campoLink = document.getElementById('link-html-produto')
      setInput.call(campoLink, link)
      campoLink.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    await act(async () => botao('Extrair produto do HTML').click())
    assert.equal(document.querySelector('.extrair-produto h3').textContent, produto.name.text)
    assert.equal(document.querySelector('.extrair-link').href, link)
    assert.equal(document.querySelector('.extrair-produto img'), null)
    assert.match(document.body.textContent, /Já está no Valiô/)
    assert.equal(document.querySelector('.extrair-selecao input').disabled, true)
    assert.equal(botao('Enviar novos para o Valiô').disabled, true)
    assert.deepEqual(chamadas.map((item) => item.url), ['/api/valio/produtos/verificar'])

    duplicado = false
    await act(async () => botao('Extrair produto do HTML').click())
    assert.equal(document.querySelector('.extrair-selecao input').disabled, false)
    await act(async () => document.querySelector('.extrair-selecao input').click())
    await act(async () => {
      const select = document.querySelector('.extrair-categoria select')
      select.value = 'Achados para Casa'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    assert.equal(botao('Enviar novos para o Valiô').disabled, false)
    await act(async () => botao('Enviar novos para o Valiô').click())
    const envio = chamadas.find((item) => item.url === '/api/valio/produtos')
    assert.ok(envio)
    assert.deepEqual(JSON.parse(envio.options.body), {
      mercadoLivreId: produto.id, titulo: produto.name.text, descricao: '', preco: 63.5,
      dataPreco: JSON.parse(envio.options.body).dataPreco, linkAfiliado: link,
      categoria: 'Achados para Casa', imagem: produto.image,
    })
    assert.ok(document.getElementById('json-afiliados'))
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    Object.assign(globalThis, { window: original.window, document: original.document, HTMLElement: original.HTMLElement,
      fetch: original.fetch, IS_REACT_ACT_ENVIRONMENT: original.actEnvironment })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
  }
})
