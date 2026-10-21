import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'

test('confirmação exige revalidação; seleção, HAR, catálogo, CSV e fonte invalidam; payload não contém HAR bruto', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/precos' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let vite; let root
  const envios = []
  let adiar = false; let resolver
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, op) => {
      const body = JSON.parse(op.body); envios.push({ url, body })
      if (url.endsWith('/revalidar')) {
        assert.deepEqual(Object.keys(body).sort(), ['fonte', 'itens', 'versao'])
        assert.deepEqual(Object.keys(body.itens[0]).sort(), ['classificacao', 'evidencia', 'itemId', 'novoPreco', 'precoBase'])
        assert.doesNotMatch(JSON.stringify(body), /arquivoOrigem|headers|cookies|polycard|Authorization|userProductId|urlParams|RAW-SENTINELA/)
        const resposta = { ok: true, previa: { finalidade: 'precos-har-v1', versao: body.versao, fonte: 'api', emitidaEm: Date.now(), itens: body.itens,
          resultados: body.itens.map((i) => ({ ...i, titulo: 'Produto sintético', status: 'PRONTO', motivo: 'Revalidado' })) }, assinatura: 'assinatura-mock' }
        if (adiar) await new Promise((r) => { resolver = r })
        return { ok: true, json: async () => resposta }
      }
      assert.ok(url.endsWith('/confirmar'))
      return { ok: true, json: async () => ({ ok: true, resultados: body.previa.resultados.map((r) => ({ ...r, status: 'ATUALIZADO', motivo: 'Somente preco' })) }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Tela } = await vite.ssrLoadModule('/src/pages/RevisaoHarAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    const render = async (catalogo) => act(async () => root.render(createElement(Tela, { catalogo, erroCatalogo: '', carregandoCatalogo: false, token: 'token-mock' })))
    const button = (texto) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto)
    const clicar = async (texto) => act(async () => button(texto).click())
    const confirmar = () => button('Confirmar atualização dos preços')
    const importar = async () => {
      const input = document.getElementById('har-arquivos')
      const har = JSON.parse(arquivoHar(entradaHar([cardHar()])))
      har.log.entries[0].request.headers = [{ name: 'Authorization', value: 'RAW-SENTINELA' }]
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'local.har', size: 100, text: async () => JSON.stringify(har) }] })
      await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
      await clicar('Analisar HAR')
    }
    const preparar = async () => { await clicar('Selecionar todos os candidatos seguros'); await clicar('Gerar prévia de atualização') }
    const revalidar = async () => { await clicar('Revalidar e preparar atualização'); assert.ok(confirmar()) }
    await render([catalogoHar()]); await importar(); await preparar()
    assert.equal(confirmar(), undefined); assert.equal(envios.length, 0)
    await revalidar(); assert.equal(envios.length, 1)
    await clicar('Limpar seleção'); assert.equal(confirmar(), undefined)
    await preparar(); await revalidar(); await importar(); assert.equal(confirmar(), undefined)
    await preparar(); await revalidar(); await render([catalogoHar('MLB123', { preco: 101 })]); assert.equal(confirmar(), undefined)
    await preparar(); await revalidar()
    const fonte = document.getElementById('har-fonte-catalogo')
    await act(async () => { fonte.value = 'csv'; fonte.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(confirmar(), undefined)
    const csv = document.getElementById('har-catalogo-csv')
    Object.defineProperty(csv, 'files', { configurable: true, value: [{ name: 'local.csv', size: 100,
      text: async () => 'mercado_livre_id,preco,ativo,oferta_relampago\nMLB123,100,true,false' }] })
    await act(async () => csv.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    const antesCsv = envios.length
    await preparar()
    assert.match(document.body.textContent, /Atualização indisponível com catálogo CSV/)
    assert.equal(button('Revalidar e preparar atualização'), undefined); assert.equal(confirmar(), undefined)
    assert.equal(envios.length, antesCsv)
    await act(async () => { fonte.value = 'api'; fonte.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await preparar()
    adiar = true
    await clicar('Revalidar e preparar atualização'); assert.equal(confirmar(), undefined)
    await clicar('Limpar seleção')
    await act(async () => resolver()); assert.equal(confirmar(), undefined)
    adiar = false
    await preparar(); await revalidar(); await clicar('Confirmar atualização dos preços')
    assert.equal(confirmar(), undefined)
    assert.match(document.querySelector('.har-confirmacao').textContent, /Atualizados: 1/)
    assert.match(document.querySelector('.har-confirmacao tbody').textContent, /90,00.*ATUALIZADO/s)
    assert.equal(envios.filter((r) => r.url.endsWith('/confirmar')).length, 1)
    assert.equal(button('Revalidar e preparar atualização').disabled, true)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch; dom.window.close()
  }
})
