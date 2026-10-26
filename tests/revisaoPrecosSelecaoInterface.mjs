import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const card = (id, preco) => ({ unique_id: id, metadata: { id, url: `https://mercadolivre.com.br/${id}` },
  pictures: [{ id: `imagem-${id}` }], components: [
    { id: 'title', title: { text: `Produto ${id}` } }, { id: 'price', price: { current_price: { value: preco, currency: 'BRL' } } },
  ] })
const lote = (...cards) => JSON.stringify({ polycard_context: { picture_template: 'https://http2.mlstatic.com/{id}.webp' }, results: cards })

test('seleciona os seis produtos alterados e preserva IDs ao filtrar, ordenar e paginar', async () => {
  const ids = Array.from({ length: 200 }, (_, index) => `MLB${1000 + index}`)
  const catalogo = ids.map((id) => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco: 100,
    dataPreco: '01/10/2026', categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}`,
    imagem: `https://http2.mlstatic.com/imagem-${id}.webp`, rating: 4.8, ativo: true, updatedAt: '2026-10-01T12:00:00Z' }))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Fila } = await vite.ssrLoadModule('/src/pages/FilaRevisaoPrecos.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Fila, { catalogo, token: 'token-de-teste', onResultados: () => {} })))

    const campo = document.getElementById('json-lote-revisao')
    const setterTexto = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    const adicionar = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Adicionar lote')
    const alterados = ids.slice(0, 6).map((id, index) => card(id, 90 + index))
    const iguais = ids.slice(6, 26).map((id) => card(id, 100))
    await act(async () => {
      setterTexto.call(campo, lote(...alterados, ...iguais))
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => adicionar.click())
    const resumo = document.querySelector('.fila-revisao').textContent
    assert.match(resumo, /26 encontrados nos lotes/)
    assert.match(resumo, /6 com .+ alterado/)
    assert.match(resumo, /20 com .+ igual/)

    const filtro = document.querySelector('select[aria-label="Filtrar fila"]')
    const setterSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
    await act(async () => { setterSelect.call(filtro, 'preco-alterado'); filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    const selecionar = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Selecionar todos com'))
    await act(async () => selecionar.click())
    assert.match(document.querySelector('.fila-revisao').textContent, /6 produtos selecionados.*6 selecionados para atualizar.*0 selecionados para confirmar/)
    assert.equal([...document.querySelectorAll('.fila-item input[type="checkbox"]')].filter((checkbox) => checkbox.checked).length, 6)
    const previa = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Pr'))
    assert.equal(previa.disabled, false)

    const ordenar = document.querySelector('select[aria-label="Ordenar fila"]')
    await act(async () => { setterSelect.call(ordenar, 'maior-aumento'); ordenar.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.match(document.querySelector('.fila-revisao').textContent, /6 produtos selecionados/)
    await act(async () => { setterSelect.call(filtro, 'todos'); filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => { setterSelect.call(ordenar, 'antigos'); ordenar.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    const proxima = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Próxima'))
    assert.ok(proxima)
    await act(async () => proxima.click())
    assert.match(document.querySelector('.fila-revisao').textContent, /6 produtos selecionados/)
    const anterior = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Anterior'))
    await act(async () => anterior.click())
    assert.equal([...document.querySelectorAll('.fila-item input[type="checkbox"]')].filter((checkbox) => checkbox.checked).length, 6)

    const desmarcar = [...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Desmarcar todos'))
    await act(async () => desmarcar.click())
    assert.match(document.querySelector('.fila-revisao').textContent, /0 produtos selecionados.*0 selecionados para atualizar.*0 selecionados para confirmar/)
    await act(async () => document.querySelector('.fila-item input[type="checkbox"]').click())
    assert.match(document.querySelector('.fila-revisao').textContent, /1 produtos selecionados/)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
  }
})
