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
  const produto = (id, ativo) => ({ id: Number(id.replace('MLB', '')), mercadoLivreId: id,
    titulo: id === 'MLB1' ? 'Camiseta Puma' : 'Tênis Nike', preco: 100, dataPreco: '01/10/2026',
    categoria: id === 'MLB1' ? 'Achados para Elas' : 'Achados para Casa', linkAfiliado: `https://mercadolivre.com.br/${id}?affiliate=original`,
    imagem: `https://imagem.com/${id}.webp`, rating: 4.8, ativo, updatedAt: '2026-10-01T12:00:00Z' })
  const catalogo = [produto('MLB1', true), produto('MLB2', false)]
  let falhar = false
  const chamadas = []
  const exclusoes = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      if (falhar) throw new TypeError('Failed to fetch')
      if (options.method === 'GET') return { ok: true, json: async () => ({ ok: true, produtos: catalogo.map((p) => ({ ...p })) }) }
      if (url.endsWith('/exclusao-definitiva')) {
        const body = JSON.parse(options.body); exclusoes.push(body)
        const indice = catalogo.findIndex((p) => p.id === body.id_interno)
        if (indice >= 0) catalogo.splice(indice, 1)
        return { ok: true, json: async () => ({ ok: true, id_interno: body.id_interno }) }
      }
      if (url.endsWith('/link-afiliado')) {
        const body = JSON.parse(options.body)
        const salvo = catalogo.find((p) => p.mercadoLivreId === body.mercado_livre_id)
        const anterior = salvo.linkAfiliado
        salvo.linkAfiliado = body.link_afiliado
        return { ok: true, json: async () => ({ ok: true, produto: salvo.titulo,
          mercado_livre_id: salvo.mercadoLivreId, link_anterior: anterior, link_afiliado: salvo.linkAfiliado }) }
      }
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
    const busca = document.querySelector('[aria-label="Buscar produtos na vitrine"]')
    const digitarBusca = (valor) => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(busca, valor)
      busca.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    await act(async () => digitarBusca('camiseta puma'))
    assert.deepEqual([...document.querySelectorAll('.vitrine-produto h3')].map((el) => el.textContent), ['Camiseta Puma'])
    assert.match(document.querySelector('.vitrine-lista-cabecalho').textContent, /1 de 2 produtos exibidos/)
    await act(async () => digitarBusca('MLB2'))
    assert.deepEqual([...document.querySelectorAll('.vitrine-produto h3')].map((el) => el.textContent), ['Tênis Nike'])
    await act(async () => digitarBusca('casa'))
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1)
    await act(async () => { filtro.value = 'inativos'; filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => digitarBusca('camiseta'))
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 0, 'busca se combina com o filtro de inativos')
    assert.match(document.querySelector('.vitrine-lista-cabecalho').textContent, /0 de 2 produtos exibidos/)
    await act(async () => digitarBusca('tênis'))
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1)
    await act(async () => digitarBusca(''))
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1, 'limpar a busca restaura os itens do filtro ativo')
    await act(async () => botao('Reativar').click())
    assert.equal(catalogo[1].ativo, true)
    assert.equal(catalogo[1].linkAfiliado, produto('MLB2', false).linkAfiliado)
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 0)
    await act(async () => { filtro.value = 'todos'; filtro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    const categoria = document.querySelector('[aria-label="Categoria de Camiseta Puma"]')
    await act(async () => { categoria.value = 'Achados para Casa'; categoria.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await act(async () => [...document.querySelectorAll('.vitrine-produto')][0].querySelector('button').click())
    assert.equal(catalogo[0].categoria, 'Achados para Casa')
    assert.equal(catalogo[0].linkAfiliado, produto('MLB1', true).linkAfiliado)
    await act(async () => botao('Desativar').click())
    assert.equal(catalogo[0].ativo, true)
    assert.ok(botao('Confirmar desativação'))
    await act(async () => botao('Confirmar desativação').click())
    assert.equal(catalogo[0].ativo, false)
    await act(async () => botao('Excluir definitivamente').click())
    const confirmacao = document.querySelector('[role="alertdialog"]')
    assert.match(confirmacao.textContent, /Camiseta Puma/)
    assert.match(confirmacao.textContent, /ITEM_ID:\s*MLB1/)
    assert.match(confirmacao.textContent, /ID interno:\s*1/)
    assert.match(confirmacao.textContent, /Categoria:\s*Achados para Casa/)
    assert.match(confirmacao.textContent, /Esta ação é permanente e não poderá ser desfeita/)
    assert.equal(botao('Confirmar exclusão definitiva').disabled, true)
    assert.equal(exclusoes.length, 0)
    await act(async () => document.querySelector('.vitrine-confirmacao-exclusao input[type="checkbox"]').click())
    await act(async () => botao('Confirmar exclusão definitiva').click())
    assert.deepEqual(exclusoes, [{ id_interno: 1, confirmar: true }])
    assert.deepEqual(catalogo.map((item) => item.mercadoLivreId), ['MLB2'])
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1)
    assert.deepEqual([...document.querySelectorAll('.vitrine-resumo strong')].slice(0, 2).map((el) => el.textContent), ['1', '0'])
    assert.match(document.querySelector('[role="status"].extrair-notificacao').textContent, /Produto excluído definitivamente/)
    falhar = true
    await act(async () => botao('Carregar catálogo').click())
    assert.match(document.querySelector('[role="alert"]').textContent, /Não foi possível conectar/)
    assert.equal(document.querySelectorAll('.vitrine-produto').length, 1)
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
