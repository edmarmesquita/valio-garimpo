import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('interface seleciona EXATOS, exige confirmação e atualiza a lista após resposta simulada', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/recuperar-inativos' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, File: globalThis.File, fetch: globalThis.fetch,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  const catalogo = [
    { mercadoLivreId: 'MLB1', titulo: 'Produto um', preco: 100, categoria: 'Achados para Casa', ativo: false },
    { mercadoLivreId: 'MLB2', titulo: 'Produto dois', preco: 90, categoria: 'Achados para Casa', ativo: false },
    { mercadoLivreId: 'MLB3', titulo: 'Produto candidato', preco: 80, categoria: 'Achados para Casa', ativo: false },
  ]
  const postagens = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.File = dom.window.File
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); postagens.push(body)
        for (const item of body.produtos) {
          const salvo = catalogo.find((linha) => linha.mercadoLivreId === item.mercado_livre_id)
          salvo.ativo = true; salvo.preco = item.preco
        }
        return { ok: true, json: async () => ({ ok: true, resultados: body.produtos.map((item) =>
          ({ mercado_livre_id: item.mercado_livre_id, status: 'REATIVADO' })) }) }
      }
      return { ok: true, json: async () => ({ ok: true, produtos: catalogo.map((item) => ({ ...item })) }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Page } = await vite.ssrLoadModule('/src/pages/RecuperarInativosPage.tsx')
    const { ContextoSessao } = await vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token: 'token-de-teste', setToken() {}, diagnostico: null, setDiagnostico() {} } }, createElement(Page))))
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    const linhasSemCorrespondencia = () => {
      const titulo = [...document.querySelectorAll('h2')].find((item) => item.textContent.includes('SEM CORRESP'))
      const linhas = []; let atual = titulo?.nextElementSibling
      while (atual?.tagName === 'P' && /^\s*MLB\d+/.test(atual.textContent)) { linhas.push(atual); atual = atual.nextElementSibling }
      return linhas
    }
    await act(async () => botao('Carregar catálogo de inativos').click())
    assert.deepEqual([...document.querySelectorAll('.recuperar-inativos__resumo strong')].map((item) => item.textContent), ['3', '0', '0', '3'])
    assert.equal(linhasSemCorrespondencia().length, 3)
    assert.match(document.body.textContent, /3 de 3 exibidos/)
    assert.equal(botao('Mostrar mais'), undefined)
    catalogo.push(...Array.from({ length: 60 }, (_, indice) => ({ mercadoLivreId: `MLB${indice + 100}`,
      titulo: `Inativo sem correspondencia ${indice + 100}`, preco: 50 + indice, categoria: 'Achados para Casa', ativo: false })))
    await act(async () => botao('Carregar catálogo de inativos').click())
    assert.equal(linhasSemCorrespondencia().length, 25)
    assert.match(document.body.textContent, /25 de 63 exibidos/)
    await act(async () => botao('Mostrar mais').click())
    assert.equal(linhasSemCorrespondencia().length, 50)
    assert.match(document.body.textContent, /50 de 63 exibidos/)
    await act(async () => botao('Mostrar mais').click())
    assert.equal(linhasSemCorrespondencia().length, 63)
    assert.equal(botao('Mostrar mais'), undefined)
    assert.match(document.body.textContent, /63 de 63 exibidos/)
    const html = (...produtos) => produtos.map(([id, titulo, preco]) => `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', sku: id, name: titulo, offers: { price: preco, priceCurrency: 'BRL' },
    })}</script>`).join('\n')
    const arquivo = new dom.window.File([html(['MLB1', 'Produto um', 125], ['MLB2', 'Produto dois', 110],
      ['MLB9', 'Produto candidato', 80])], 'ofertas.html', { type: 'text/html' })
    arquivo.text = async () => html(['MLB1', 'Produto um', 125], ['MLB2', 'Produto dois', 110], ['MLB9', 'Produto candidato', 80])
    const input = document.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { configurable: true, value: [arquivo] })
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.deepEqual([...document.querySelectorAll('.recuperar-inativos__resumo strong')].map((item) => item.textContent), ['63', '2', '1', '60'])
    assert.equal(linhasSemCorrespondencia().length, 25)
    assert.match(document.body.textContent, /25 de 60 exibidos/)
    assert.equal(botao('Mostrar mais')?.textContent, 'Mostrar mais')
    assert.match(linhasSemCorrespondencia()[0].textContent, /^MLB100 · Inativo sem correspondencia 100 ·/)
    assert.match(linhasSemCorrespondencia()[24].textContent, /^MLB124 · Inativo sem correspondencia 124 ·/)
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 2)
    assert.equal(botao('Reativar selecionados').disabled, true)
    await act(async () => document.querySelector('input[aria-label="Selecionar MLB1"]').click())
    assert.equal(document.body.textContent.includes('1 de 2 selecionados'), true)
    await act(async () => botao('Reativar selecionados').click())
    assert.match(document.querySelector('[aria-label="Confirmar reativação"]').textContent, /1 produto\./)
    assert.equal(postagens.length, 0)
    await act(async () => botao('Cancelar').click())
    await act(async () => botao('Selecionar todos os exatos').click())
    assert.equal(document.body.textContent.includes('2 de 2 selecionados'), true)
    await act(async () => botao('Limpar seleção').click())
    assert.equal(botao('Reativar selecionados').disabled, true)
    await act(async () => botao('Selecionar todos os exatos').click())
    await act(async () => botao('Reativar selecionados').click())
    assert.equal(postagens.length, 0)
    assert.match(document.querySelector('[aria-label="Confirmar reativação"]').textContent, /2 produtos/)
    await act(async () => botao('Cancelar').click())
    assert.equal(postagens.length, 0)
    await act(async () => botao('Reativar selecionados').click())
    await act(async () => botao('Confirmar reativação').click())
    assert.equal(postagens.length, 1)
    assert.deepEqual(postagens[0].produtos.map((item) => item.mercado_livre_id), ['MLB1', 'MLB2'])
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 0)
    assert.equal(document.body.textContent.includes('2 produtos reativados'), true)
    assert.equal(catalogo[2].ativo, false)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.File = original.File
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment; globalThis.fetch = original.fetch
  }
})
