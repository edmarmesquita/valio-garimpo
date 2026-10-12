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
const catalogo = ['MLB1', 'MLB2', 'MLB3'].map((id) => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco: 100,
  dataPreco: '01/10/2026', categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}`,
  imagem: `https://http2.mlstatic.com/imagem-${id}.webp`, rating: 4.8, ativo: true, updatedAt: '2026-10-01T12:00:00Z' }))

test('interface acumula dois JSONs, deduplica, atualiza preço, confirma igual e limpa lotes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let root; let vite
  const envios = []
  let falhar = false
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/valio/produtos/precos-lote')
      if (falhar) throw new TypeError('Failed to fetch')
      const produtos = JSON.parse(options.body).produtos
      envios.push(produtos)
      return { ok: true, json: async () => ({ ok: true, resultados: produtos.map((item) => ({ mercadoLivreId: item.mercadoLivreId,
        status: item.atualizarPreco ? 'atualizado' : 'confirmado', dataPreco: '12/10/2026', updatedAt: '2026-10-12T12:00:00Z' })) }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Fila } = await vite.ssrLoadModule('/src/pages/FilaRevisaoPrecos.tsx')
    root = createRoot(document.getElementById('root'))
    const aplicados = []
    await act(async () => root.render(createElement(Fila, { catalogo, token: 'token-de-teste', onResultados: (resultados, entradas) => aplicados.push({ resultados, entradas }) })))
    const botao = (texto) => [...document.querySelectorAll('button')].find((el) => el.textContent === texto)
    const campo = document.getElementById('json-lote-revisao')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    const adicionar = async (json) => {
      await act(async () => { setter.call(campo, json); campo.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
      await act(async () => botao('Adicionar lote').click())
    }
    await adicionar(lote(card('MLB1', 90)))
    await adicionar(lote(card('MLB1', 80), card('MLB2', 100)))
    assert.match(document.querySelector('.fila-estatisticas').textContent, /Lotes adicionados: 2.*Produtos brutos encontrados: 3.*Produtos únicos acumulados: 2.*Duplicados ignorados: 1/s)
    assert.match(document.querySelector('.fila-item').textContent, /Diferença:.*20,00/s)
    assert.equal(document.querySelectorAll('.fila-item').length, 3)
    await act(async () => botao('Selecionar todos encontrados').click())
    assert.match(document.querySelector('.fila-revisao').textContent, /2 produtos selecionados/)
    await act(async () => botao('Atualizar preços selecionados').click())
    assert.deepEqual(envios[0], [{ mercadoLivreId: 'MLB1', preco: 80, atualizarPreco: true }])
    await act(async () => botao('Confirmar preços iguais selecionados').click())
    assert.deepEqual(envios[1], [{ mercadoLivreId: 'MLB2', preco: 100, atualizarPreco: false }])
    assert.equal(aplicados.length, 2)
    falhar = true
    await act(async () => botao('Selecionar todos com preço alterado').click())
    await act(async () => botao('Atualizar preços selecionados').click())
    assert.match(document.querySelector('.extrair-resumo-envio').textContent, /1 erros/)
    assert.match(document.querySelector('.fila-revisao').textContent, /1 produtos selecionados/)
    assert.equal(document.querySelectorAll('.fila-item').length, 3)
    await act(async () => botao('Limpar lotes de revisão').click())
    assert.match(document.querySelector('.fila-estatisticas').textContent, /Lotes adicionados: 0.*Produtos únicos acumulados: 0/s)
    assert.equal(document.querySelector('.fila-revisao').textContent.includes('token-de-teste'), false)
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
