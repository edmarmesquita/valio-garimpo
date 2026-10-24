import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

test('Manutenção mostra prévia sem gravar e só atualiza após confirmação explícita', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  const id = 'MLB5348529958'
  const anterior = 'https://www.mercadolivre.com.br/produto/p/MLB123'
  const novo = 'https://meli.la/1Yu9QRC'
  const texto = `${id} | ${novo}\nMLB9999999999 | https://meli.la/OUTRO`
  const chamadas = []
  let escritas = 0
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => {
      chamadas.push({ url, options })
      if (url.endsWith('/previa')) return { ok: true, json: async () => ({ ok: true, solicitadas: 2, linhas: [
        { linha: 1, mercado_livre_id: id, link_novo: novo, titulo: 'Kit 10 Esmaltes', link_anterior: anterior, motivo: null },
        { linha: 2, mercado_livre_id: 'MLB9999999999', link_novo: 'https://meli.la/OUTRO', titulo: null,
          link_anterior: null, motivo: 'Produto não encontrado; nenhum cadastro será criado.' },
      ] }) }
      if (url.endsWith('/links-afiliados')) {
        escritas++
        return { ok: true, json: async () => ({ ok: true, solicitadas: 2, atualizadas: 1, erros: 1,
          idsAtualizados: [id], falhas: [{ linha: 2, mercado_livre_id: 'MLB9999999999', motivo: 'Produto não encontrado.' }] }) }
      }
      throw Error('Requisição inesperada')
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: LinksAfiliadosPanel } = await vite.ssrLoadModule('/src/components/LinksAfiliadosPanel.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(LinksAfiliadosPanel, { token: 'token-de-teste' })))
    const campo = document.getElementById('vitrine-lote-links-texto')
    const setTextarea = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setTextarea.call(campo, texto)
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const botao = (prefixo) => [...document.querySelectorAll('button')].find((item) => item.textContent.startsWith(prefixo))
    assert.match(document.querySelector('.vitrine-lote-links').textContent, /processa automaticamente todos os itens em sublotes de até 50/)
    await act(async () => botao('Ver prévia').click())
    assert.equal(escritas, 0)
    assert.equal(chamadas[0].url, '/api/valio/produtos/links-afiliados/previa')
    assert.equal(chamadas[0].options.method, 'POST')
    assert.equal(JSON.parse(chamadas[0].options.body).texto, texto)
    const previa = document.querySelector('.vitrine-lote-previa')
    assert.match(previa.textContent, /Kit 10 Esmaltes/)
    assert.match(previa.textContent, /Link atual/)
    assert.match(previa.textContent, /Link novo/)
    assert.match(previa.textContent, /Produto não encontrado/)
    await act(async () => botao('Confirmar atualização').click())
    assert.equal(escritas, 1)
    assert.equal(chamadas[1].url, '/api/valio/produtos/links-afiliados')
    assert.equal(chamadas[1].options.method, 'PATCH')
    assert.deepEqual(JSON.parse(chamadas[1].options.body).confirmacoes, [
      { linha: 1, mercado_livre_id: id, link_anterior: anterior },
    ])
    const resultado = document.querySelector('.vitrine-lote-links [role="status"]')
    assert.match(resultado.textContent, /Solicitados: 2/)
    assert.match(resultado.textContent, /Atualizados: 1/)
    assert.match(resultado.textContent, /Com erro: 1/)
    assert.match(resultado.textContent, new RegExp(id))
    assert.match(resultado.textContent, /Linha 2/)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.fetch = original.fetch
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
  }
})
