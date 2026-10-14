import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const linkUm = 'https://www.mercadolivre.com.br/produto-um?extra_comm=true&tag=a%2Fb#sid=affiliates'
const linkDois = 'https://www.mercadolivre.com.br/produto-dois?extra_comm=false&src=teste#sid=affiliates'
const card = (id, titulo, preco, link) => ({
  unique_id: id,
  metadata: {
    id, url: link?.split('?')[0], url_params: link ? `?${link.split('?')[1].split('#')[0]}` : undefined,
    url_fragments: link ? `#${link.split('#')[1]}` : undefined,
  },
  pictures: [{ id: `imagem-${id}` }],
  components: [
    { id: 'title', title: { text: titulo } },
    { id: 'price', price: { current_price: { value: preco, currency: 'BRL' } } },
  ],
})
const entrada = JSON.stringify({ polycard_context: { picture_template: 'https://http2.mlstatic.com/{id}.webp' }, results: [
  card('MLB1', 'Produto um', 169.99, linkUm),
  card('MLB2', 'Produto dois', 49.9, linkDois),
  card('MLB3', 'Produto sem link', 25, null),
] })

test('a interface gera e mostra JSON para o Valiô com dois selecionados e erro junto ao botão', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = {
    window: globalThis.window, document: globalThis.document,
    navigator: globalThis.navigator, HTMLElement: globalThis.HTMLElement,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch,
  }
  let root
  let vite
  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { default: ExtrairAfiliados } = await vite.ssrLoadModule('/src/pages/ExtrairAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(createElement(ExtrairAfiliados)))

    const textarea = document.getElementById('json-afiliados')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(textarea, entrada)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => document.querySelector('button').click())
    assert.equal(document.querySelectorAll('.extrair-produto').length, 3)
    assert.equal(document.querySelector('#json-valio-titulo'), null)

    for (const indice of [0, 1]) {
      await act(async () => document.querySelectorAll('.extrair-selecao input')[indice].click())
      const select = document.querySelectorAll('.extrair-categoria select')[indice]
      await act(async () => {
        select.value = indice === 0 ? 'Achados para Elas' : 'Achados para Casa'
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      })
    }
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Gerar produtos para o Valiô').click())
    const secao = document.querySelector('[aria-labelledby="json-valio-titulo"]')
    assert.ok(secao)
    assert.match(secao.textContent, /2 produtos gerados/)
    assert.match(secao.querySelector('[role="status"]').textContent, /gerado com sucesso/)
    assert.equal(secao.querySelector('button').textContent, 'Copiar JSON para o Valiô')
    const gerados = JSON.parse(secao.querySelector('pre').textContent)
    assert.equal(gerados.length, 2)
    assert.deepEqual(gerados.map((p) => p.category), ['Achados para Elas', 'Achados para Casa'])
    assert.deepEqual(gerados.map((p) => p.link), [linkUm, linkDois])
    const dataLocal = new Date()
    assert.equal(gerados[0].priceReferenceDate,
      `${String(dataLocal.getDate()).padStart(2, '0')}/${String(dataLocal.getMonth() + 1).padStart(2, '0')}/${dataLocal.getFullYear()}`)
    assert.equal(gerados[0].price, 169.99)
    assert.equal(document.querySelectorAll('[aria-label="JSON normalizado do Garimpa"]').length, 1)

    const requisicoes = []
    let cadastrados = []
    let falharVerificacao = false
    globalThis.fetch = async (url, options) => {
      if (url === '/api/valio/produtos/verificar') {
        if (falharVerificacao) throw new TypeError('Failed to fetch')
        return { ok: true, json: async () => ({ ok: true, existentes: cadastrados }) }
      }
      requisicoes.push({ url, options, corpo: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ ok: true, acao: requisicoes.length === 1 ? 'criado' : 'atualizado' }) }
    }
    const tokenInput = document.getElementById('token-publicacao')
    const inputSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      inputSetter.call(tokenInput, 'token-de-teste')
      tokenInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Enviar novos para o Valiô').click())
    assert.deepEqual(requisicoes.map((req) => req.corpo.mercadoLivreId), ['MLB1', 'MLB2'])
    assert.deepEqual(requisicoes.map((req) => req.corpo.linkAfiliado), [linkUm, linkDois])
    assert.match(document.querySelector('.extrair-resumo-envio').textContent, /2 produtos enviados ao Valiô/)
    assert.match(document.querySelector('.extrair-resumo-envio').textContent, /1 criado.*1 atualizado.*0 erros/)

    cadastrados = [{ mercadoLivreId: 'MLB2', titulo: 'Produto dois', preco: 59.9,
      dataPreco: '10/10/2026', categoria: 'Achados para Casa', linkAfiliado: linkDois,
      imagem: 'https://http2.mlstatic.com/imagem-MLB2.webp', ativo: false }]
    await act(async () => {
      inputSetter.call(tokenInput, 'token-de-teste-2')
      tokenInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.match(document.querySelectorAll('.extrair-estado')[0].textContent, /Novo/)
    assert.match(document.querySelectorAll('.extrair-estado')[1].textContent, /Já está no Valiô/)
    assert.match(document.querySelector('.extrair-alteracao').textContent, /Preço alterado.*Valiô: R\$\s+59,90.*Agora: R\$\s+49,90/s)
    assert.deepEqual([...document.querySelectorAll('.extrair-resumo strong')].slice(0, 3).map((el) => el.textContent), ['3', '2', '1'])
    assert.match(document.querySelector('.extrair-diagnostico').textContent, /IDs enviados: 3.*MLB1, MLB2, MLB3.*Existentes retornados: 1.*MLB2.*2 novos; 1 existentes/s)
    assert.match(document.querySelector('.extrair-aviso').textContent, /Produtos antigos exibidos no Valiô fora dessa tabela/)

    const filtroCadastro = [...document.querySelectorAll('.extrair-controles select')].find((el) => el.parentElement.textContent.includes('Cadastro no Valiô'))
    await act(async () => { filtroCadastro.value = 'novos'; filtroCadastro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelectorAll('.extrair-produto').length, 2)
    await act(async () => { filtroCadastro.value = 'cadastrados'; filtroCadastro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(document.querySelectorAll('.extrair-produto').length, 1)
    await act(async () => { filtroCadastro.value = 'todos'; filtroCadastro.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })

    requisicoes.length = 0
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Enviar novos para o Valiô').click())
    assert.deepEqual(requisicoes.map((req) => req.corpo.mercadoLivreId), ['MLB1'])
    requisicoes.length = 0
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Atualizar existentes').click())
    assert.deepEqual(requisicoes.map((req) => req.corpo.mercadoLivreId), ['MLB2'])

    cadastrados[0].preco = 49.9
    await act(async () => {
      inputSetter.call(tokenInput, 'token-de-teste-3')
      tokenInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.match(document.querySelector('.extrair-sem-alteracoes').textContent, /Sem alterações relevantes/)
    falharVerificacao = true
    await act(async () => {
      inputSetter.call(tokenInput, 'token-de-teste-4')
      tokenInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.match(document.querySelector('.extrair-aviso').textContent, /Não foi possível verificar/)
    assert.ok(document.querySelector('[aria-labelledby="json-valio-titulo"]'))
    assert.equal([...document.querySelectorAll('button')].find((button) => button.textContent === 'Enviar novos para o Valiô').disabled, true)

    await act(async () => document.querySelectorAll('.extrair-selecao input')[2].click())
    await act(async () => {
      const select = document.querySelectorAll('.extrair-categoria select')[2]
      select.value = 'Achados para Presentear'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Gerar produtos para o Valiô').click())
    assert.equal(document.querySelector('#json-valio-titulo'), null)
    assert.match(document.querySelector('.extrair-erro-exportacao').textContent, /Produto sem link: link original/)

    const oficial = 'https://meli.la/1Yu9QRC'
    await act(async () => {
      const campo = document.querySelectorAll('.extrair-link-oficial input')[2]
      inputSetter.call(campo, oficial)
      campo.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Gerar produtos para o Valiô').click())
    const comLinkOficial = JSON.parse(document.querySelector('[aria-label="JSON para o Valiô"]').textContent)
    assert.equal(comLinkOficial.find((produto) => produto.id === 'MLB3').link, oficial)
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    globalThis.window = original.window
    globalThis.document = original.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
    globalThis.HTMLElement = original.HTMLElement
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.actEnvironment
    globalThis.fetch = original.fetch
  }
})
