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
    { id: 101, mercadoLivreId: 'MLB1', titulo: 'Produto um', preco: 100, categoria: 'Achados para Casa', ativo: false, imagem: 'https://http2.mlstatic.com/old.webp', linkAfiliado: 'https://meli.la/old' },
    { id: 102, mercadoLivreId: 'MLB2', titulo: 'Produto dois', preco: 90, categoria: 'Achados para Casa', ativo: false, imagem: 'https://http2.mlstatic.com/old2.webp', linkAfiliado: 'https://meli.la/old2' },
    { id: 103, mercadoLivreId: 'MLB3', titulo: 'Produto candidato modelo especial alfa', preco: 80, categoria: 'Achados para Casa', ativo: false, imagem: 'https://http2.mlstatic.com/old3.webp', linkAfiliado: 'https://meli.la/old3' },
  ]
  const postagens = []
  const substituicoes = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.File = dom.window.File
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST' && url === '/api/valio/produtos/substituir-inativo') {
        const body = JSON.parse(options.body); substituicoes.push(body)
        const salvo = catalogo.find((linha) => linha.id === body.id_interno)
        Object.assign(salvo, { mercadoLivreId: body.mercado_livre_id, titulo: body.titulo, preco: body.preco,
          imagem: body.imagem, linkAfiliado: body.link_afiliado, categoria: body.categoria, ativo: true })
        return { ok: true, json: async () => ({ ok: true, id_interno: body.id_interno, mercado_livre_id: body.mercado_livre_id }) }
      }
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
      '@type': 'Product', sku: id, name: titulo, image: `https://http2.mlstatic.com/${id}.webp`, offers: { price: preco, priceCurrency: 'BRL' },
    })}</script>`).join('\n')
    const arquivo = new dom.window.File([html(['MLB1', 'Produto um', 125], ['MLB2', 'Produto dois', 110],
      ['MLB9', 'Produto candidato modelo especial alfa diferente', 80])], 'ofertas.html', { type: 'text/html' })
    arquivo.text = async () => html(['MLB1', 'Produto um', 125], ['MLB2', 'Produto dois', 110], ['MLB9', 'Produto candidato modelo especial alfa diferente', 80])
    const input = document.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { configurable: true, value: [arquivo] })
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.deepEqual([...document.querySelectorAll('.recuperar-inativos__resumo strong')].map((item) => item.textContent), ['63', '2', '1', '60'])
    assert.match(document.querySelector('[aria-label="Resumo dos arquivos"]').textContent,
      /Arquivos processados: 1 · Cards lidos: 3 · ITEM_IDs únicos: 3 · Duplicados: 0 · Não reconhecidos: 0/)
    assert.equal(linhasSemCorrespondencia().length, 25)
    assert.match(document.body.textContent, /25 de 60 exibidos/)
    assert.equal(botao('Mostrar mais')?.textContent, 'Mostrar mais')
    assert.match(linhasSemCorrespondencia()[0].textContent, /^MLB100 · Inativo sem correspondencia 100 ·/)
    assert.match(linhasSemCorrespondencia()[24].textContent, /^MLB124 · Inativo sem correspondencia 124 ·/)
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 2)
    assert.equal(botao('Reativar selecionados').disabled, true)
    let selecionarCandidato = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Selecionar para substituição')
    await act(async () => selecionarCandidato.click())
    assert.equal(document.body.textContent.includes('M\u00c9DIA'), true)
    await act(async () => botao('Revisar substituições selecionadas').click())
    assert.match(document.querySelector('[aria-label="Revisar substituições"]').textContent, /Esta ação substituirá o produto antigo/)
    assert.match(document.querySelector('[aria-label="Revisar substituições"]').textContent, /Link afiliado necessário/)
    assert.equal(botao('Confirmar substituição e reativação').disabled, true)
    await act(async () => botao('Cancelar').click())
    assert.equal(substituicoes.length, 0, 'cancelar a prévia não escreve')
    await act(async () => botao('Revisar substituições selecionadas').click())
    const inputLink = document.querySelector('input[aria-label="Link afiliado para MLB9"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(inputLink, 'https://meli.la/validado')
      inputLink.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(botao('Confirmar substituição e reativação').disabled, false)
    await act(async () => botao('Confirmar substituição e reativação').click())
    assert.equal(substituicoes.length, 1)
    assert.equal(substituicoes[0].id_interno, 103)
    assert.equal(substituicoes[0].mercado_livre_id, 'MLB9')
    assert.equal(substituicoes[0].link_afiliado, 'https://meli.la/validado')
    assert.equal(catalogo.find((item) => item.id === 103).ativo, true)
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
    assert.equal(catalogo[2].ativo, true)
    assert.equal(catalogo[2].mercadoLivreId, 'MLB9')
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
