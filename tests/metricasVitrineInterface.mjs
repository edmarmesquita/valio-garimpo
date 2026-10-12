import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('painel exibe métricas agregadas, troca período e preserva dados após falha', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let root; let vite
  const chamadas = []
  let falhar = false
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      if (falhar) throw new TypeError('Failed to fetch')
      return { ok: true, json: async () => ({ ok: true, periodo: url.split('=')[1], totalCliques: 12,
        totalProdutosComClique: 2, produtosSemClique: 3,
        rankingProdutos: [{ mercadoLivreId: 'MLB1', titulo: 'Produto um', categoria: 'Achados para Casa', cliques: 8 }],
        rankingCategorias: [{ categoria: 'Achados para Casa', cliques: 10 }], cliquesPorDia: [{ data: '12/10/2026', cliques: 12 }] }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Metricas } = await vite.ssrLoadModule('/src/pages/MetricasVitrine.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Metricas, { token: 'token-de-teste' })))
    const botao = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Carregar métricas')
    await act(async () => botao.click())
    assert.equal(chamadas[0].url, '/api/valio/metricas/cliques?periodo=30dias')
    assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
    assert.deepEqual([...document.querySelectorAll('.metricas-resumo strong')].slice(0, 3).map((el) => el.textContent), ['12', '2', '3'])
    assert.match(document.querySelector('.metricas-listas').textContent, /Produto um.*Achados para Casa.*12\/10\/2026/s)
    const select = document.getElementById('periodo-metricas')
    await act(async () => { select.value = '7dias'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => botao.click())
    assert.equal(chamadas[1].url, '/api/valio/metricas/cliques?periodo=7dias')
    falhar = true
    await act(async () => botao.click())
    assert.match(document.querySelector('[role="alert"]').textContent, /Não foi possível conectar/)
    assert.equal(document.querySelector('.metricas-resumo strong').textContent, '12')
    assert.equal(document.querySelector('#root').textContent.includes('token-de-teste'), false)
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
