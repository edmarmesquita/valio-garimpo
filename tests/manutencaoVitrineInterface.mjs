import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('painel consulta, filtra e mantém a tela em falha de backend', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let root; let vite
  const produto = (id, ativo) => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco: 100, dataPreco: '01/10/2026',
    categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}?affiliate=original`,
    imagem: `https://imagem.com/${id}.webp`, rating: 4.8, ativo, updatedAt: '2026-10-01T12:00:00Z' })
  const catalogo = [produto('MLB1', true), produto('MLB2', false)]
  let falhar = false
  const chamadas = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      if (falhar) throw new TypeError('Failed to fetch')
      if (options.method === 'GET') return { ok: true, json: async () => ({ ok: true, produtos: catalogo.map((p) => ({ ...p })) }) }
      const id = url.match(/MLB\d+/)?.[0]
      if (url.endsWith('/status')) catalogo.find((p) => p.mercadoLivreId === id).ativo = JSON.parse(options.body).ativo
      if (url.endsWith('/categoria')) catalogo.find((p) => p.mercadoLivreId === id).categoria = JSON.parse(options.body).categoria
      return { ok: true, json: async () => ({ ok: true }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Painel } = await vite.ssrLoadModule('/src/pages/ManutencaoVitrine.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Painel, { token: 'token-de-teste', lote: null, categorias: new Map() })))
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    await act(async () => botao('Carregar catálogo').click())
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 2)
    assert.deepEqual([...document.querySelectorAll('.vitrine-resumo strong')].slice(0, 2).map((el) => el.textContent), ['1', '1'])
    assert.equal(chamadas[0].url, '/api/valio/catalogo')
    assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
    const filtro = document.querySelector('[aria-label="Filtrar vitrine"]')
    await act(async () => { filtro.value = 'inativos'; filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1)
    await act(async () => botao('Reativar').click())
    assert.equal(catalogo[1].ativo, true)
    assert.equal(catalogo[1].linkAfiliado, produto('MLB2', false).linkAfiliado)
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 0)
    await act(async () => { filtro.value = 'todos'; filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    const categoria = document.querySelector('[aria-label="Categoria de Produto MLB1"]')
    await act(async () => { categoria.value = 'Achados para Casa'; categoria.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll('.vitrine-produto')][0].querySelector('button').click())
    assert.equal(catalogo[0].categoria, 'Achados para Casa')
    assert.equal(catalogo[0].linkAfiliado, produto('MLB1', true).linkAfiliado)
    await act(async () => botao('Desativar').click())
    assert.equal(catalogo[0].ativo, true)
    assert.ok(botao('Confirmar desativação'))
    await act(async () => botao('Confirmar desativação').click())
    assert.equal(catalogo[0].ativo, false)
    falhar = true
    await act(async () => botao('Carregar catálogo').click())
    assert.match(document.querySelector('[role="alert"]').textContent, /Não foi possível conectar/)
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 2)
    assert.equal(document.querySelector('#root').textContent.includes('service-role-falsa'), false)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch
  }
})
