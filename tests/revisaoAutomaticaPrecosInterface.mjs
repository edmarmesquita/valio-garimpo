import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const catalogo = Array.from({ length: 12 }, (_, indice) => ({
  mercadoLivreId: `MLB${indice + 1}`, titulo: `Produto ${indice + 1}`, preco: 100,
  dataPreco: '01/10/2026', categoria: 'Achados', linkAfiliado: `https://example.com/${indice + 1}`,
  imagem: 'https://example.com/imagem', rating: 4, ativo: true, updatedAt: '2026-10-01T00:00:00Z',
}))

test('piloto, prévia, conflito, confirmação, pausa e retomada da revisão automática', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const anterior = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let root, vite
  const consultas = [], escritas = [], precos = new Map(catalogo.map((item) => [item.mercadoLivreId, 90]))
  let falhaAutenticacao = false, sessoesExpiradas = 0
  let segurarGrupo = false, liberarGrupo
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      if (url === '/api/mercadolivre/precos/consultar') {
        const ids = JSON.parse(options.body).itemIds
        consultas.push(ids)
        if (falhaAutenticacao) return { ok: false, status: 401, json: async () => ({ erro: 'Sessão expirada' }) }
        if (segurarGrupo && ids[0] === 'MLB6') await new Promise((resolve) => { liberarGrupo = resolve })
        return { ok: true, json: async () => ({ ok: true, resultados: ids.map((itemId) => ({
          itemId, situacao: 'OK', preco: precos.get(itemId), motivo: null,
        })) }) }
      }
      assert.equal(url, '/api/valio/produtos/precos-lote')
      const produtos = JSON.parse(options.body).produtos
      escritas.push(produtos)
      return { ok: true, json: async () => ({ ok: true, resultados: produtos.map((item) => ({
        mercadoLivreId: item.mercadoLivreId, status: 'atualizado', dataPreco: '19/10/2026',
        updatedAt: '2026-10-19T12:00:00Z',
      })) }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Revisao } = await vite.ssrLoadModule('/src/pages/RevisaoAutomaticaPrecos.tsx')
    root = createRoot(document.getElementById('root'))
    const propriedades = { catalogo, token: 'token-de-teste', mercadoLivreConectado: true,
      onSessaoExpirada: () => { sessoesExpiradas++ }, onResultados: () => {} }
    await act(async () => root.render(createElement(Revisao, propriedades)))
    const botao = (nome) => [...document.querySelectorAll('button')].find((item) => item.textContent === nome)
    const clicar = async (nome) => act(async () => botao(nome).click())
    const marcar = async (id) => act(async () => document.querySelector(`input[aria-label="Selecionar ${id}"]`).click())
    await act(async () => root.render(createElement(Revisao, { ...propriedades, mercadoLivreConectado: false })))
    assert.equal(botao('Testar piloto de 5 produtos').disabled, true)
    assert.equal(consultas.length, 0)
    await act(async () => root.render(createElement(Revisao, propriedades)))
    assert.equal(botao('Revisar catálogo inteiro por ITEM_ID').disabled, true)
    const campo = document.getElementById('piloto-ids')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(campo, 'MLB1 MLB2 MLB3 MLB4 MLB5')
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    falhaAutenticacao = true
    await clicar('Testar piloto de 5 produtos')
    assert.equal(sessoesExpiradas, 1)
    assert.match(document.querySelector('.fila-contadores').textContent, /Verificados: 0/)
    assert.equal(botao('Revisar catálogo inteiro por ITEM_ID').disabled, true)
    falhaAutenticacao = false
    await clicar('Testar piloto de 5 produtos')
    assert.deepEqual(consultas, [
      ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'],
      ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'],
    ])
    assert.equal(botao('Revisar catálogo inteiro por ITEM_ID').disabled, false)
    assert.equal(escritas.length, 0)
    const salvo = JSON.parse(dom.window.localStorage.getItem('valio-garimpa:revisao-precos-auto:v1'))
    assert.equal(salvo.pilotoAprovado, true)
    assert.equal(JSON.stringify(salvo).includes('token-de-teste'), false)

    await marcar('MLB1')
    await clicar('Prévia dos preços selecionados')
    assert.match(document.querySelector('.fila-previa').textContent, /MLB1.*100,00.*90,00/s)
    assert.equal(escritas.length, 0)
    precos.set('MLB1', 95)
    await clicar('Confirmar revisão automática')
    assert.equal(escritas.length, 0)
    assert.match(document.querySelector('[role="alert"]').textContent, /MLB1/)
    await clicar('Revisar próximos pendentes')
    await clicar('Prévia dos preços selecionados')
    await clicar('Confirmar revisão automática')
    assert.deepEqual(escritas, [[{ mercadoLivreId: 'MLB1', preco: 95, atualizarPreco: true, precoEsperado: 100 }]])
    assert.equal(document.querySelector('.fila-previa'), null)

    segurarGrupo = true
    await clicar('Revisar catálogo inteiro por ITEM_ID')
    assert.deepEqual(consultas.at(-1), ['MLB6', 'MLB7', 'MLB8', 'MLB9', 'MLB10'])
    await clicar('Pausar')
    segurarGrupo = false
    await act(async () => liberarGrupo())
    assert.match(document.querySelector('[role="status"]').textContent, /interrompida/)
    assert.equal(botao('Continuar').disabled, false)
    await act(async () => root.unmount())
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Revisao, propriedades)))
    assert.match(document.querySelector('[role="status"]').textContent, /interrompida em 10\/12/)
    await clicar('Continuar')
    assert.deepEqual(consultas.at(-1), ['MLB11', 'MLB12'])
    assert.match(document.querySelector('.fila-contadores').textContent, /Verificados: 12/)
    assert.equal(escritas.length, 1)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = anterior.window; globalThis.document = anterior.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: anterior.navigator })
    globalThis.HTMLElement = anterior.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = anterior.actEnvironment
    globalThis.fetch = anterior.fetch
  }
})
