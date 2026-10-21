import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'

test('piloto 66 → 5: alteração manual, limpar, nova prévia e resposta atrasada invalidam assinatura e botão antigos', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/precos' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch }
  let root; let vite; let atrasar = false; let resolver
  const envios = []; let assinaturaAntiga
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, op) => {
      const body = JSON.parse(op.body); envios.push({ url, body })
      if (url.endsWith('/revalidar')) {
        const dados = { ok: true, previa: { finalidade: 'precos-har-v1', fonte: 'api', versao: body.versao, emitidaEm: Date.now(), itens: body.itens,
          resultados: body.itens.map((p) => ({ ...p, titulo: 'Mock', status: p.novoPreco > 130 ? 'BLOQUEADO_VARIACAO_EXTREMA' : 'PRONTO', motivo: 'Mock' })) }, assinatura: 'assinatura-' + body.versao }
        assinaturaAntiga ??= dados
        if (atrasar) await new Promise((r) => { resolver = r })
        return { ok: true, json: async () => dados }
      }
      assert.ok(url.endsWith('/confirmar'))
      assert.equal(body.selecaoAtual.itens.length, 5)
      assert.notEqual(body.assinatura, assinaturaAntiga.assinatura)
      assert.equal(body.selecaoAtual.versao, body.previa.versao)
      assert.deepEqual(body.selecaoAtual.itens.map((p) => p.itemId), body.previa.itens.map((p) => p.itemId))
      return { ok: true, json: async () => ({ ok: true, resultados: body.previa.resultados.map((p) => ({ ...p, status: 'ATUALIZADO' })) }) }
    }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: Tela } = await vite.ssrLoadModule('/src/pages/RevisaoHarAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(Tela, { catalogo: Array.from({ length: 66 }, (_, n) => catalogoHar(`MLB${n + 1}`)),
      erroCatalogo: '', carregandoCatalogo: false, token: 'token-mock' })))
    const input = document.getElementById('har-arquivos')
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'piloto.har', size: 100,
      text: async () => arquivoHar(entradaHar(Array.from({ length: 66 }, (_, n) => cardHar(`MLB${n + 1}`, n < 62 ? 110 : 140)))) }] })
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    const button = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)
    const click = async (t) => act(async () => button(t).click())
    const confirmar = () => button('Confirmar atualização dos preços')
    const revalidar = async () => { await click('Gerar prévia de atualização'); await click('Revalidar e preparar atualização') }
    await click('Analisar HAR'); await click('Selecionar todos os candidatos seguros'); await revalidar()
    assert.equal(assinaturaAntiga.previa.itens.length, 66)
    assert.equal(assinaturaAntiga.previa.resultados.filter((p) => p.status === 'PRONTO').length, 62)
    assert.ok(confirmar())
    // Redução por checkboxes, sem depender do botão Limpar seleção.
    const botaoAnterior = confirmar()
    await act(async () => {
      document.querySelector('[aria-label="Selecionar MLB66"]').click()
      // Tentativa com referência ao botão antigo antes de concluir o mesmo lote de eventos.
      botaoAnterior.click()
    })
    for (let n = 65; n > 5; n--) await act(async () => document.querySelector(`[aria-label="Selecionar MLB${n}"]`).click())
    assert.match(document.body.textContent, /5 produtos selecionados de 66 candidatos seguros/)
    assert.equal(document.querySelector('.har-previa-final'), null); assert.equal(confirmar(), undefined)
    assert.equal(envios.filter((p) => p.url.endsWith('/confirmar')).length, 0)
    await revalidar(); assert.ok(confirmar())
    await click('Gerar prévia de atualização')
    assert.equal(confirmar(), undefined); assert.equal(document.querySelector('.har-confirmacao tbody'), null)
    await click('Revalidar e preparar atualização'); assert.ok(confirmar())
    await click('Limpar seleção'); assert.equal(confirmar(), undefined)
    assert.match(document.body.textContent, /0 produtos selecionados de 66 candidatos seguros/)
    // Vários eventos na mesma atualização React não podem ressuscitar os 66 IDs anteriores.
    await act(async () => { for (let n = 1; n <= 5; n++) document.querySelector(`[aria-label="Selecionar MLB${n}"]`).click() })
    assert.match(document.body.textContent, /5 produtos selecionados de 66 candidatos seguros/)
    await click('Gerar prévia de atualização'); atrasar = true
    await click('Revalidar e preparar atualização'); await click('Limpar seleção')
    await act(async () => resolver()); assert.equal(confirmar(), undefined)
    atrasar = false
    await act(async () => { for (let n = 1; n <= 5; n++) document.querySelector(`[aria-label="Selecionar MLB${n}"]`).click() })
    await revalidar(); await click('Confirmar atualização dos preços')
    assert.equal(envios.filter((p) => p.url.endsWith('/confirmar')).length, 1)
    assert.match(document.querySelector('.har-confirmacao').textContent, /Atualizados: 5/)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    globalThis.window = original.window; globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch; dom.window.close()
  }
})
