import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

async function montar(executar, responder = async () => { throw Error('Requisição inesperada') }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  const chamadas = []
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async (url, options) => { chamadas.push({ url, options }); return responder(url, options) }
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { ContextoSessao } = await vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts')
    const { default: Painel } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/ImportarListaAfiliadosPanel.tsx')
    root = createRoot(document.getElementById('root'))
    const renderizar = async (token = 'token-de-teste') => act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token, setToken: () => {}, diagnostico: null, setDiagnostico: () => {} } }, createElement(Painel))))
    await renderizar()
    const reiniciar = async () => {
      await act(async () => root.unmount())
      root = createRoot(document.getElementById('root'))
      await renderizar()
    }
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    const preencher = async (id, valor) => act(async () => {
      const campo = document.getElementById(id)
      setter.call(campo, valor)
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const preencherUrl = async (valor) => act(async () => {
      const campo = document.getElementById('url-lista-afiliados')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(campo, valor)
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    const extrair = async (ids) => {
      const html = JSON.stringify({ polycards: ids.map((id) => ({ metadata: { id, url: `www.mercadolivre.com.br/${id}` } })) })
      await preencher('html-lista-afiliados', html)
      await act(async () => botao('Extrair produtos da lista').click())
      await act(async () => botao('Preparar lote para o Gerador').click())
    }
    const processar = async (texto) => {
      await preencher('retorno-gerador-lista', texto)
      await act(async () => botao('Processar retorno').click())
    }
    await executar({ chamadas, botao, extrair, processar, renderizar, reiniciar, preencher, preencherUrl, dom })
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    Object.assign(globalThis, { window: original.window, document: original.document, HTMLElement: original.HTMLElement,
      fetch: original.fetch, IS_REACT_ACT_ENVIRONMENT: original.actEnvironment })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
  }
}

test('envia apenas LINK para prévia sem gravar e confirma explicitamente só produto existente', async () => {
  const atual = 'https://mercadolivre.com.br/produto-atual'
  await montar(async ({ chamadas, botao, extrair, processar }) => {
    await extrair(['MLB11', 'MLB22', 'MLB33', 'MLB44'])
    await processar('https://meli.la/primeiro\nEste produto não cumpre com os requisitos do Programa.\nEste URL corresponde a um produto pausado.\nhttps://meli.la/quarto')
    assert.equal(chamadas.length, 0)
    assert.equal(botao('Confirmar atualização dos links válidos'), undefined)
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, '/api/valio/produtos/links-afiliados/previa')
    assert.equal(chamadas[0].options.method, 'POST')
    assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
    assert.equal(JSON.parse(chamadas[0].options.body).texto, 'MLB11 | https://meli.la/primeiro\nMLB44 | https://meli.la/quarto')
    const previa = document.querySelector('.lista-afiliados-previa')
    assert.match(previa.textContent, /Solicitados/)
    assert.match(previa.textContent, /Prontos/)
    assert.match(previa.textContent, /Erros/)
    assert.match(previa.textContent, /Produto ainda não existe no Valiô/)
    assert.match(previa.textContent, /Produto existente/)
    assert.match(previa.textContent, /https:\/\/meli.la\/primeiro/)
    assert.equal(chamadas.length, 1)
    await act(async () => botao('Confirmar atualização dos links válidos').click())
    assert.equal(chamadas.length, 2)
    assert.equal(chamadas[1].url, '/api/valio/produtos/links-afiliados')
    assert.equal(chamadas[1].options.method, 'PATCH')
    assert.deepEqual(JSON.parse(chamadas[1].options.body).confirmacoes, [
      { linha: 1, mercado_livre_id: 'MLB11', link_anterior: atual },
    ])
    assert.match(document.querySelector('.lista-afiliados-confirmacao').textContent, /Atualizados: 1/)
  }, async (url) => url.endsWith('/previa') ? { ok: true, json: async () => ({ ok: true, solicitadas: 2, linhas: [
    { linha: 1, mercado_livre_id: 'MLB11', titulo: 'Produto existente', link_anterior: atual, link_novo: 'https://meli.la/primeiro', motivo: null },
    { linha: 2, mercado_livre_id: 'MLB44', titulo: null, link_anterior: null, link_novo: 'https://meli.la/quarto', motivo: 'Produto não encontrado; nenhum cadastro será criado.' },
  ] }) } : { ok: true, json: async () => ({ ok: true, solicitadas: 2, atualizadas: 1, erros: 1,
    idsAtualizados: ['MLB11'], falhas: [{ linha: 2, mercado_livre_id: 'MLB44', motivo: 'Produto não encontrado.' }] }) })
})

test('bloqueia prévia com REVISAR, quantidade divergente ou nenhum link válido', async () => {
  await montar(async ({ chamadas, botao, extrair, processar }) => {
    await extrair(['MLB11', 'MLB22'])
    for (const retorno of [
      'Este produto não cumpre com os requisitos do Programa.\nEste URL corresponde a um produto pausado.',
      'https://meli.la/primeiro\n⚠️ Mensagem desconhecida',
      'https://meli.la/primeiro',
      'https://meli.la/primeiro\nhttps://meli.la/segundo\nhttps://meli.la/terceiro',
    ]) {
      if (botao('Encerrar lote')) {
        await act(async () => botao('Encerrar lote').click())
        await act(async () => botao('Preparar lote para o Gerador').click())
      }
      await processar(retorno)
      assert.equal(botao('Enviar válidos para prévia').disabled, true)
      assert.equal(botao('Confirmar atualização dos links válidos'), undefined)
    }
    assert.equal(chamadas.length, 0)
  })
})

test('token diferente invalida confirmação da prévia anterior', async () => {
  await montar(async ({ botao, extrair, processar, renderizar, chamadas }) => {
    await extrair(['MLB11'])
    await processar('https://meli.la/primeiro')
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.ok(botao('Confirmar atualização dos links válidos'))
    await renderizar('outro-token')
    assert.equal(botao('Confirmar atualização dos links válidos'), undefined)
    assert.equal(chamadas.length, 1)
  }, async () => ({ ok: true, json: async () => ({ ok: true, solicitadas: 1, linhas: [
    { linha: 1, mercado_livre_id: 'MLB11', titulo: 'Produto', link_anterior: 'https://meli.la/antigo', link_novo: 'https://meli.la/primeiro', motivo: null },
  ] }) }))
})

test('lista, retorno e prévia permanecem ao alternar áreas da sessão', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/extrair-afiliados' })
  const original = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement, fetch: globalThis.fetch, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let root; let vite
  try {
    globalThis.window = dom.window; globalThis.document = dom.window.document
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
    globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, solicitadas: 1, linhas: [
      { linha: 1, mercado_livre_id: 'MLB11', titulo: 'Produto', link_anterior: 'https://meli.la/antigo', link_novo: 'https://meli.la/novo', motivo: null },
    ] }) })
    const { createRoot } = await import('react-dom/client')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
    const { ContextoSessao } = await vite.ssrLoadModule('/src/app/sessaoOperacionalContext.ts')
    const { default: ExtrairAfiliados } = await vite.ssrLoadModule('/src/pages/ExtrairAfiliados.tsx')
    root = createRoot(document.getElementById('root'))
    const renderizar = async (visivel) => act(async () => root.render(createElement(ContextoSessao.Provider,
      { value: { token: 'token-de-teste', setToken: () => {}, diagnostico: null, setDiagnostico: () => {} } },
      createElement(ExtrairAfiliados, { visivel }))))
    await renderizar(true)
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    const preencher = async (id, texto) => act(async () => {
      const campo = document.getElementById(id)
      setter.call(campo, texto)
      campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const botao = (texto) => [...document.querySelectorAll('button')].find((item) => item.textContent === texto)
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: [{ metadata: { id: 'MLB11', url: 'www.mercadolivre.com.br/MLB11' } }] }))
    await act(async () => botao('Extrair produtos da lista').click())
    await act(async () => botao('Preparar lote para o Gerador').click())
    await preencher('retorno-gerador-lista', 'https://meli.la/novo')
    await act(async () => botao('Processar retorno').click())
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.ok(document.querySelector('.lista-afiliados-previa'))
    await renderizar(false)
    assert.equal(document.querySelector('.extrair-afiliados').hidden, true)
    await renderizar(true)
    assert.equal(document.querySelector('#retorno-gerador-lista').value, 'https://meli.la/novo')
    assert.ok(document.querySelector('.lista-afiliados-pareamento'))
    assert.ok(document.querySelector('.lista-afiliados-previa'))
    assert.ok(botao('Confirmar atualização dos links válidos'))
  } finally {
    if (root) await act(async () => root.unmount())
    if (vite) await vite.close()
    dom.window.close()
    Object.assign(globalThis, { window: original.window, document: original.document, HTMLElement: original.HTMLElement,
      fetch: original.fetch, IS_REACT_ACT_ENVIRONMENT: original.actEnvironment })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator })
  }
})

test('novo completo só é publicado após confirmação e payload usa meli.la pareado', async () => {
  const oficial = 'https://meli.la/novo'
  await montar(async ({ chamadas, botao, processar, preencher, dom }) => {
    const card = { unique_id: 'card-MLB11', metadata: { id: 'MLB11', url: 'www.mercadolivre.com.br/produto-direto' },
      pictures: [{ id: 'imagem-11' }], components: [
        { id: 'title', title: { text: 'Produto novo' } },
        { id: 'price', price: { current_price: { value: 49.9, currency: 'BRL' } } },
      ] }
    await preencher('html-lista-afiliados', JSON.stringify({ polycard_context: {
      picture_template: 'https://http2.mlstatic.com/D_{id}-O.webp',
    }, polycards: [card] }))
    await act(async () => botao('Extrair produtos da lista').click())
    await act(async () => botao('Preparar lote para o Gerador').click())
    await processar(oficial)
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.equal(document.querySelector('.lista-afiliados-novos tbody tr').cells[5].textContent, 'SEM CATEGORIA')
    assert.equal(botao('Publicar novos no Valiô').disabled, true)
    const select = document.querySelector('[aria-label="Categoria de MLB11"]')
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, 'Achados para Casa'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.match(document.querySelector('.lista-afiliados-novos tbody tr').textContent, /PRONTO PARA PUBLICAR/)
    await act(async () => botao('Publicar novos no Valiô').click())
    assert.equal(chamadas.length, 1)
    assert.match(document.querySelector('.lista-afiliados-publicacao-previa').textContent, /nenhuma alteração feita/)
    await act(async () => botao('Confirmar publicação dos novos').click())
    assert.deepEqual(chamadas.map((item) => item.url), [
      '/api/valio/produtos/links-afiliados/previa', '/api/valio/produtos/verificar', '/api/valio/produtos',
    ])
    const payload = JSON.parse(chamadas[2].options.body)
    assert.equal(payload.linkAfiliado, oficial)
    assert.equal(payload.somenteCriar, true)
    assert.equal(payload.imagem, 'https://http2.mlstatic.com/D_imagem-11-O.webp')
    assert.notEqual(payload.linkAfiliado, 'https://www.mercadolivre.com.br/produto-direto')
    assert.equal(JSON.parse(dom.window.localStorage.getItem('valio-garimpa:affiliate-batch-snapshot:v1')).status, 'FINALIZADO')
  }, async (url) => {
    if (url.endsWith('/links-afiliados/previa')) return { ok: true, json: async () => ({ ok: true, solicitadas: 1, linhas: [
      { linha: 1, mercado_livre_id: 'MLB11', titulo: null, link_anterior: null, link_novo: oficial,
        motivo: 'Produto não encontrado; nenhum cadastro será criado.' },
    ] }) }
    if (url.endsWith('/verificar')) return { ok: true, json: async () => ({ ok: true, existentes: [] }) }
    return { ok: true, json: async () => ({ ok: true, acao: 'criado' }) }
  })
})

test('reinício restaura lote congelado; outra lista exige troca explícita e não muda o pareamento', async () => {
  await montar(async ({ botao, extrair, processar, reiniciar, preencher, dom }) => {
    await extrair(['MLB111', 'MLB222', 'MLB333'])
    const chave = 'valio-garimpa:affiliate-batch-snapshot:v1'
    assert.ok(dom.window.localStorage.getItem(chave))
    await reiniciar()
    assert.match(document.body.textContent, /Lote restaurado da sessão anterior/)
    assert.equal(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]').value.split('\n').length, 3)
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: [
      { metadata: { id: 'MLB999', url: 'www.mercadolivre.com.br/MLB999' } },
      { metadata: { id: 'MLB888', url: 'www.mercadolivre.com.br/MLB888' } },
      { metadata: { id: 'MLB777', url: 'www.mercadolivre.com.br/MLB777' } },
    ] }))
    await act(async () => botao('Extrair produtos da lista').click())
    assert.match(document.body.textContent, /A nova lista não altera esse lote/)
    assert.match(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]').value, /MLB111/)
    let copiado = ''
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true,
      value: { writeText: async (valor) => { copiado = valor } } })
    await act(async () => botao('Copiar URLs').click())
    assert.match(copiado, /MLB111/)
    assert.doesNotMatch(copiado, /MLB999/)
    await act(async () => botao('Preparar novo lote').click())
    assert.match(document.body.textContent, /Já existe um lote ativo/)
    await act(async () => botao('Usar lote atual').click())
    assert.match(dom.window.localStorage.getItem(chave), /MLB111/)
    await processar('https://meli.la/primeiro\nhttps://meli.la/segundo\nhttps://meli.la/terceiro')
    assert.equal(document.querySelector('[aria-label="Bloco ITEM_ID | link"]').value,
      'MLB111 | https://meli.la/primeiro\nMLB222 | https://meli.la/segundo\nMLB333 | https://meli.la/terceiro')
    assert.match(dom.window.localStorage.getItem(chave), /RETORNO PROCESSADO/)
    await act(async () => botao('Preparar novo lote').click())
    await act(async () => botao('Descartar e criar novo lote').click())
    assert.match(dom.window.localStorage.getItem(chave), /MLB999/)
    assert.doesNotMatch(dom.window.localStorage.getItem(chave), /MLB111/)
  })
})

test('snapshot corrompido é bloqueado e pode ser descartado', async () => {
  await montar(async ({ botao, reiniciar, dom }) => {
    const chave = 'valio-garimpa:affiliate-batch-snapshot:v1'
    dom.window.localStorage.setItem(chave, '{corrompido')
    await reiniciar()
    assert.match(document.body.textContent, /Snapshot salvo inválido/)
    await act(async () => botao('Descartar snapshot salvo').click())
    assert.equal(dom.window.localStorage.getItem(chave), null)
  })
})

test('lote finalizado fica persistido até encerramento explícito', async () => {
  await montar(async ({ botao, extrair, processar, reiniciar, dom }) => {
    const chave = 'valio-garimpa:affiliate-batch-snapshot:v1'
    await extrair(['MLB11'])
    await processar('https://meli.la/novo')
    await act(async () => botao('Enviar válidos para prévia').click())
    await act(async () => botao('Confirmar atualização dos links válidos').click())
    assert.match(dom.window.localStorage.getItem(chave), /FINALIZADO/)
    await reiniciar()
    assert.match(document.body.textContent, /FINALIZADO/)
    await act(async () => botao('Encerrar lote').click())
    assert.equal(dom.window.localStorage.getItem(chave), null)
    assert.equal(document.querySelector('.lista-afiliados-pareamento'), null)
  }, async (url) => url.endsWith('/previa') ? { ok: true, json: async () => ({ ok: true, solicitadas: 1, linhas: [
    { linha: 1, mercado_livre_id: 'MLB11', titulo: 'Produto', link_anterior: 'https://meli.la/antigo', link_novo: 'https://meli.la/novo', motivo: null },
  ] }) } : { ok: true, json: async () => ({ ok: true, solicitadas: 1, atualizadas: 1, erros: 0,
    idsAtualizados: ['MLB11'], falhas: [] }) })
})

test('limpar lista atual remove somente extração e mantém snapshot, retorno, status e token', async () => {
  await montar(async ({ botao, extrair, processar, preencher, preencherUrl, chamadas, dom }) => {
    await extrair(['MLB111', 'MLB222'])
    await processar('https://meli.la/primeiro\nhttps://meli.la/segundo')
    await preencherUrl('https://www.mercadolivre.com.br/lista-atual')
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: [
      { metadata: { id: 'MLB999', url: 'www.mercadolivre.com.br/MLB999' } },
      { metadata: { id: 'MLB888', url: 'www.mercadolivre.com.br/MLB888' } },
    ] }))
    await act(async () => botao('Extrair produtos da lista').click())
    assert.match(document.querySelector('.lista-afiliados-previa-lista').textContent, /MLB999/)
    const chave = 'valio-garimpa:affiliate-batch-snapshot:v1'
    const antes = dom.window.localStorage.getItem(chave)
    assert.equal(JSON.parse(antes).status, 'RETORNO PROCESSADO')
    await act(async () => botao('Limpar lista atual').click())
    assert.equal(document.getElementById('url-lista-afiliados').value, '')
    assert.equal(document.getElementById('html-lista-afiliados').value, '')
    assert.equal(document.querySelector('.lista-afiliados-previa-lista'), null)
    assert.doesNotMatch(document.body.textContent, /Encontrados|Únicos|Ignorados|Duplicados/)
    assert.doesNotMatch(document.body.textContent, /MLB999|MLB888/)
    assert.deepEqual([...document.querySelectorAll('.lista-afiliados-snapshot-tabela tbody tr')].map((linha) => linha.cells[1].textContent), ['MLB111', 'MLB222'])
    assert.match(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]').value, /MLB111/)
    assert.equal(document.querySelector('[aria-label="Bloco ITEM_ID | link"]').value,
      'MLB111 | https://meli.la/primeiro\nMLB222 | https://meli.la/segundo')
    assert.equal(document.getElementById('retorno-gerador-lista').value, 'https://meli.la/primeiro\nhttps://meli.la/segundo')
    assert.equal(dom.window.localStorage.getItem(chave), antes)
    assert.match(document.body.textContent, /RETORNO PROCESSADO/)
    assert.match(document.querySelector('.lista-afiliados-lista-limpa').textContent,
      /Lista atual limpa. Nenhum produto do Valiô foi excluído. O lote ativo foi preservado./)
    assert.equal(chamadas.length, 0)
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
    assert.equal(chamadas.length, 1)
  }, async () => ({ ok: true, json: async () => ({ ok: true, solicitadas: 2, linhas: [
    { linha: 1, mercado_livre_id: 'MLB111', titulo: 'Um', link_anterior: 'https://meli.la/antigo', link_novo: 'https://meli.la/primeiro', motivo: null },
    { linha: 2, mercado_livre_id: 'MLB222', titulo: 'Dois', link_anterior: 'https://meli.la/antigo', link_novo: 'https://meli.la/segundo', motivo: null },
  ] }) }))
})

test('limpar sem snapshot remove URLs atuais, desabilita botão e permite extrair nova lista', async () => {
  await montar(async ({ botao, preencher, preencherUrl, chamadas, dom }) => {
    assert.equal(botao('Limpar lista atual').disabled, true)
    await preencherUrl('https://www.mercadolivre.com.br/lista-antiga')
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: [
      { metadata: { id: 'MLB111', url: 'www.mercadolivre.com.br/MLB111' } },
    ] }))
    await act(async () => botao('Extrair produtos da lista').click())
    assert.match(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]').value, /MLB111/)
    await act(async () => botao('Limpar lista atual').click())
    assert.equal(document.getElementById('url-lista-afiliados').value, '')
    assert.equal(document.getElementById('html-lista-afiliados').value, '')
    assert.equal(document.querySelector('.lista-afiliados-previa-lista'), null)
    assert.equal(document.querySelector('[aria-label="URLs para o Gerador Mercado Livre"]'), null)
    assert.equal(botao('Limpar lista atual').disabled, true)
    assert.match(document.querySelector('.lista-afiliados-lista-limpa').textContent, /Nenhum produto do Valiô foi excluído/)
    assert.equal(dom.window.localStorage.length, 0)
    assert.equal(chamadas.length, 0)
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: [
      { metadata: { id: 'MLB222', url: 'www.mercadolivre.com.br/MLB222' } },
    ] }))
    await act(async () => botao('Extrair produtos da lista').click())
    assert.match(document.querySelector('.lista-afiliados-previa-lista').textContent, /MLB222/)
    assert.doesNotMatch(document.querySelector('.lista-afiliados-previa-lista').textContent, /MLB111/)
    assert.equal(chamadas.length, 0)
  })
})

test('interface mostra lote misto de dez e envia à prévia somente sete links', async () => {
  const ids = Array.from({ length: 10 }, (_, indice) => `MLB${indice + 1}`)
  const validos = [1, 2, 4, 6, 7, 9, 10]
  const links = validos.map((indice) => `https://meli.la/link${indice}`)
  const retorno = [links[0], links[1], 'Este produto não cumpre com os requisitos do Programa.', links[2],
    'Este URL corresponde a um produto pausado.', links[3], links[4],
    'Este produto não cumpre com os requisitos do Programa.', links[5], links[6]].join('\n')
  await montar(async ({ botao, extrair, processar, chamadas }) => {
    await extrair(ids)
    await processar(retorno)
    assert.match(document.querySelector('.lista-afiliados-snapshot').textContent, /AGUARDANDO RETORNO|RETORNO PROCESSADO/)
    const contadores = [...document.querySelectorAll('.lista-afiliados-contadores-retorno strong')].map((item) => item.textContent)
    assert.deepEqual(contadores, ['10', '7', '2', '1', '0', '0'])
    const linhas = [...document.querySelectorAll('.lista-afiliados-pareamento > .lista-afiliados-tabela tbody tr')]
    assert.deepEqual(linhas.map((linha) => linha.cells[3].textContent),
      ['LINK', 'LINK', 'RECUSADO', 'LINK', 'PAUSADO', 'LINK', 'LINK', 'RECUSADO', 'LINK', 'LINK'])
    assert.deepEqual(linhas.map((linha) => linha.cells[5].textContent),
      ['PRONTO', 'PRONTO', 'NÃO PUBLICAR', 'PRONTO', 'NÃO PUBLICAR', 'PRONTO', 'PRONTO', 'NÃO PUBLICAR', 'PRONTO', 'PRONTO'])
    assert.deepEqual(document.querySelector('[aria-label="Bloco ITEM_ID | link"]').value.split('\n'),
      validos.map((indice) => `MLB${indice} | https://meli.la/link${indice}`))
    assert.equal(botao('Enviar válidos para prévia').disabled, false)
    await act(async () => botao('Enviar válidos para prévia').click())
    assert.equal(chamadas.length, 1)
    assert.deepEqual(JSON.parse(chamadas[0].options.body).texto.split('\n'),
      validos.map((indice) => `MLB${indice} | https://meli.la/link${indice}`))
    assert.equal(document.querySelectorAll('.lista-afiliados-novos tbody tr').length, 7)
    assert.doesNotMatch(document.querySelector('.lista-afiliados-novos').textContent, /MLB3|MLB5|MLB8/)
    assert.equal(botao('Publicar novos no Valiô').disabled, true)
  }, async () => ({ ok: true, json: async () => ({ ok: true, solicitadas: 7, linhas: validos.map((indice, posicao) => ({
    linha: posicao + 1, mercado_livre_id: `MLB${indice}`, titulo: null, link_anterior: null,
    link_novo: `https://meli.la/link${indice}`, motivo: 'Produto não encontrado; nenhum cadastro será criado.',
  })) }) }))
})

test('interface bloqueia REVISAR, falta e excedente mesmo com links válidos', async () => {
  await montar(async ({ botao, extrair, processar, chamadas }) => {
    await extrair(['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'])
    for (const [retorno, esperado] of [
      ['https://meli.la/a\nMensagem desconhecida\nhttps://meli.la/c\nhttps://meli.la/d\nhttps://meli.la/e', /Mensagem desconhecida/],
      ['https://meli.la/a\nhttps://meli.la/b\nhttps://meli.la/c\nhttps://meli.la/d', /Lote inconsistente/],
      ['https://meli.la/a\nhttps://meli.la/b\nhttps://meli.la/c\nhttps://meli.la/d\nhttps://meli.la/e\nhttps://meli.la/f', /Resultados sem produto correspondente/],
    ]) {
      await processar(retorno)
      assert.match(document.querySelector('.lista-afiliados-pareamento').textContent, esperado)
      assert.equal(document.querySelector('[aria-label="Bloco ITEM_ID | link"]').value, '')
      assert.equal(botao('Enviar válidos para prévia').disabled, true)
      assert.equal(botao('Publicar novos no Valiô'), undefined)
    }
    assert.equal(chamadas.length, 0)
  })
})

test('interface usa snapshot misto após trocar a lista atual e mantém lote ativo visível', async () => {
  await montar(async ({ botao, extrair, processar, preencher, chamadas }) => {
    await extrair(['MLB111', 'MLB222', 'MLB333', 'MLB444', 'MLB555'])
    await preencher('html-lista-afiliados', JSON.stringify({ polycards: ['MLB999', 'MLB888', 'MLB777', 'MLB666', 'MLB000']
      .map((id) => ({ metadata: { id, url: `www.mercadolivre.com.br/${id}` } })) }))
    await act(async () => botao('Extrair produtos da lista').click())
    await processar('https://meli.la/a\nEste produto não cumpre com os requisitos do Programa.\nEste URL corresponde a um produto pausado.\nhttps://meli.la/d\nMensagem desconhecida')
    assert.deepEqual([...document.querySelectorAll('.lista-afiliados-pareamento > .lista-afiliados-tabela tbody tr')]
      .map((linha) => linha.cells[1].textContent), ['MLB111', 'MLB222', 'MLB333', 'MLB444', 'MLB555'])
    assert.match(document.querySelector('.lista-afiliados-previa-lista').textContent, /MLB999/)
    assert.match(document.querySelector('.lista-afiliados-snapshot').textContent, /Lote ativo para o Gerador/)
    assert.equal(botao('Enviar válidos para prévia').disabled, true)
    assert.equal(chamadas.length, 0)
  })
})
