import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'

const listaHtml = (id, nome, total, cards) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { appProps: { pageProps: { initialState: { list: { id, name: nome, title: nome,
    total_items: total, type: 'affiliate', products: cards.map((card) => ({ card })) } } } } },
})}</script></html>`
const nordicHtml = (id, nome, total, cards) => `<html><script id="__NORDIC_RENDERING_CTX__">
_n.ctx.r = ${JSON.stringify({ appProps: { pageProps: { initialState: { list: { id, name: nome, title: nome,
  total_items: total, type: 'affiliate', elements: { polycards: cards } } } } } })};
_n.ctx.r.scopes = {};
</script></html>`
const arquivo = (nome, conteudo) => ({ name: nome, size: conteudo.length, text: async () => conteudo })

test('interface importa Hub e listas no mesmo lote, mostra completude e prévia com origem sem requests', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/precos' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let vite; let root; let requests = 0
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async () => { requests++; throw new Error('Importação local não faz request') }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Revisao } = await vite.ssrLoadModule('/src/pages/RevisaoHarAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Revisao, { catalogo: [catalogoHar('MLB123'), catalogoHar('MLB124')],
      erroCatalogo: '', carregandoCatalogo: false })))
    const entrada = document.getElementById('har-arquivos')
    const cardsCasa = [cardHar('MLB123', 90), cardHar('MLB124', 80, { metadata: {
      tracks: { price: { promotions: [{ type: 'PIX_CAMPAIGN' }] } } } })]
    const files = [arquivo('hub.har', arquivoHar(entradaHar([cardHar('MLB123', 90)]))),
      arquivo('casa.html', nordicHtml('lista-casa', 'Valio Casa', 3, cardsCasa)),
      arquivo('elas.html', listaHtml('lista-elas', 'Valio Elas', 1, [cardHar('MLB123', 90)]))]
    Object.defineProperty(entrada, 'files', { configurable: true, value: files })
    await act(async () => entrada.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Analisar HAR').click())
    const resumo = document.querySelector('[aria-label="Resumo das listas de afiliados"]')
    assert.ok(resumo); assert.equal(resumo.querySelector('h4').textContent, 'LISTAS DETECTADAS')
    assert.equal(resumo.querySelectorAll('.har-lista').length, 2)
    const dadosLista = (elemento) => Object.fromEntries([...elemento.querySelectorAll('dl > div')]
      .map((campo) => [campo.querySelector('dt').textContent, campo.querySelector('dd').textContent]))
    const [casa, elas] = resumo.querySelectorAll('.har-lista')
    assert.match(casa.querySelector('h5').textContent, /Valio Casa/)
    assert.deepEqual(dadosLista(casa), { Esperados: '3', Extraídos: '2', 'Encontrados no Valiô': '2', Status: 'INCOMPLETA' })
    assert.match(elas.querySelector('h5').textContent, /Valio Elas/)
    assert.deepEqual(dadosLista(elas), { Esperados: '1', Extraídos: '1', 'Encontrados no Valiô': '1', Status: 'COMPLETA' })
    assert.ok(document.querySelector('.har-listas-detectadas').compareDocumentPosition(document.querySelector('.har-cards')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
    assert.match(document.body.textContent, /Documentos de listas detectados.*Listas detectadas/s)
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 1)
    await act(async () => document.querySelector('input[type="checkbox"]').click())
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Gerar prévia de atualização').click())
    assert.match(document.querySelector('.har-previa-final').textContent, /casa\.html.*Valio Casa.*elas\.html.*Valio Elas/s)
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Limpar análise').click())
    const tresPaginas = [
      arquivo('casa.html', nordicHtml('lista-casa', 'Valio Casa', 3, [cardHar('MLB123', 90)])),
      arquivo('casa-2.html.txt', nordicHtml('lista-casa', 'Valio Casa', 3, [cardHar('MLB124', 80)])),
      arquivo('casa-3.html.txt', nordicHtml('lista-casa', 'Valio Casa', 3, [cardHar('MLB125', 70)])),
    ]
    Object.defineProperty(entrada, 'files', { configurable: true, value: tresPaginas })
    await act(async () => entrada.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Analisar HAR').click())
    assert.equal(document.querySelectorAll('[aria-label="Resumo das listas de afiliados"] .har-lista').length, 1)
    assert.deepEqual(dadosLista(document.querySelector('.har-lista')),
      { Esperados: '3', Extraídos: '3', 'Encontrados no Valiô': '2', Status: 'COMPLETA' })
    assert.doesNotMatch(document.body.textContent, /O lote não foi incorporado/)
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Limpar análise').click())
    Object.defineProperty(entrada, 'files', { configurable: true,
      value: [arquivo('sem-total.html', nordicHtml('lista-sem-total', 'Sem total', undefined, [cardHar('MLB123')]))] })
    await act(async () => entrada.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Analisar HAR').click())
    assert.deepEqual(dadosLista(document.querySelector('.har-lista')),
      { Esperados: 'Não informado', Extraídos: '1', 'Encontrados no Valiô': '1', Status: 'TOTAL_DESCONHECIDO' })
    assert.equal(requests, 0)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch; dom.window.close()
  }
})
