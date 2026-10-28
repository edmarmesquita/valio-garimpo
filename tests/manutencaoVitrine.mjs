import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const logica = await vite.ssrLoadModule('/src/lib/manutencaoVitrine.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
after(async () => vite.close())

const token = 'token-local-de-teste-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
const produto = (id, overrides = {}) => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco: 100,
  dataPreco: '01/10/2026', categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}?affiliate=original`,
  imagem: `https://imagem.com/${id}.webp`, rating: 4.8, ativo: true, updatedAt: '2026-10-01T12:00:00Z', ...overrides })

test('idade do preço respeita limites de 7 e 15 dias e data inválida exige revisão', () => {
  const hoje = new Date(2026, 9, 12)
  assert.equal(logica.classificarIdadePreco('05/10/2026', hoje), 'Atualizado')
  assert.equal(logica.classificarIdadePreco('04/10/2026', hoje), 'Revisar em breve')
  assert.equal(logica.classificarIdadePreco('27/09/2026', hoje), 'Revisar em breve')
  assert.equal(logica.classificarIdadePreco('26/09/2026', hoje), 'Precisa revisão')
  assert.equal(logica.classificarIdadePreco('31/02/2026', hoje), 'Precisa revisão')
})

test('compara preço e campos sem mudar cadastro; ausência no lote é informativa', () => {
  const salvo = produto('MLB1', { ativo: false })
  const extraido = { itemId: 'MLB1', titulo: 'Título novo', precoAtual: 137,
    imagemUrl: 'https://imagem.com/nova.webp', linkOriginal: 'https://mercadolivre.com.br/novo?affiliate=novo' }
  const itens = logica.analisarCatalogo([salvo, produto('MLB2')], [extraido], new Map([[0, 'Achados para Casa']]), new Date(2026, 9, 12))
  assert.equal(itens[0].precoAlterado, true)
  assert.deepEqual(itens[0].camposAlterados, ['título', 'imagem', 'link', 'categoria'])
  assert.equal(itens[0].produto.ativo, false)
  assert.equal(itens[0].produto.preco, 100)
  assert.equal(itens[1].encontrado, false)
  assert.equal(itens[1].precoAlterado, false)
  assert.equal(logica.resumirCatalogo(itens).precosAlterados, 1)
  assert.deepEqual(logica.filtrarCatalogo(itens, 'inativos', 'antigos').map((item) => item.produto.mercadoLivreId), ['MLB1'])
  assert.deepEqual(logica.filtrarCatalogo(itens, 'revisar-catalogo', 'antigos').map((item) => item.produto.mercadoLivreId), ['MLB1'])
})

test('API lista ativos e inativos e altera somente status ou categoria com autenticação', async () => {
  const linhas = new Map([['MLB1', produto('MLB1')], ['MLB2', produto('MLB2', { ativo: false })]])
  const escritas = []
  const gateway = { async listar() { return [...linhas.values()] },
    async alterarStatus(id, ativo) { const linha = linhas.get(id); if (!linha) return false; linhas.set(id, { ...linha, ativo }); escritas.push({ id, ativo }); return true },
    async alterarCategoria(id, categoria) { const linha = linhas.get(id); if (!linha) return false; linhas.set(id, { ...linha, categoria, updatedAt: '2026-10-12T12:00:00Z' }); escritas.push({ id, categoria }); return true } }
  const app = express(); app.use(express.json()); app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token, catalogo: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/valio`
    const req = async (path, method = 'GET', body, bearer = token) => {
      const resposta = await fetch(base + path, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
      return { status: resposta.status, json: await resposta.json() }
    }
    const lista = await req('/catalogo')
    assert.equal(lista.status, 200)
    assert.deepEqual(lista.json.produtos.map((p) => p.ativo), [true, false])
    assert.equal(JSON.stringify(lista.json).includes(config.serviceRoleKey), false)
    assert.equal((await req('/catalogo', 'GET', undefined, 'errado')).status, 401)
    assert.equal((await req('/produtos/MLB1/status', 'PATCH', { ativo: false, preco: 1 })).status, 400)
    assert.equal((await req('/produtos/MLB1/status', 'PATCH', { ativo: false })).status, 200)
    assert.equal((await req('/produtos/MLB1/status', 'PATCH', { ativo: true })).status, 200)
    assert.equal((await req('/produtos/MLB1/categoria', 'PATCH', { categoria: 'Achados para Casa' })).status, 200)
    assert.equal((await req('/produtos/MLB9/status', 'PATCH', { ativo: false })).status, 404)
    assert.deepEqual(escritas, [{ id: 'MLB1', ativo: false }, { id: 'MLB1', ativo: true }, { id: 'MLB1', categoria: 'Achados para Casa' }])
    assert.equal(linhas.get('MLB1').preco, 100)
    assert.equal(linhas.get('MLB1').linkAfiliado, produto('MLB1').linkAfiliado)
    assert.equal(linhas.get('MLB1').dataPreco, '01/10/2026')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('falha no catálogo expõe somente diagnóstico seguro em Preview', async () => {
  const app = express()
  app.use('/api/valio', criarRotaValioProdutos({
    config: () => config, token: () => token,
    catalogo: () => ({ async listar() {
      throw Object.assign(new Error('segredo-simulado https://host-simulado.invalid'), { status: 400, code: '42703' })
    } }),
  }))
  const server = app.listen(0, '127.0.0.1')
  const ambienteAnterior = process.env.VERCEL_ENV
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const req = async () => {
      const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/catalogo`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(resposta.status, 502)
      return resposta.json()
    }
    process.env.VERCEL_ENV = 'preview'
    const preview = await req()
    assert.equal(preview.etapa, 'consultar tabela produtos')
    assert.equal(preview.statusHttpSupabase, 400)
    assert.equal(preview.codigoSupabase, '42703')
    assert.equal(preview.mensagemSanitizada, 'Coluna do catálogo não encontrada.')
    assert.equal(preview.chegouAoSupabase, true)
    assert.equal(preview.tabela, 'produtos')
    assert.equal(preview.supabaseUrlPresente, true)
    assert.equal(preview.supabaseUrlHttpsValida, true)
    assert.equal(preview.serviceRolePresente, true)
    assert.equal(JSON.stringify(preview).includes('segredo-simulado'), false)
    assert.equal(JSON.stringify(preview).includes(config.serviceRoleKey), false)
    process.env.VERCEL_ENV = 'production'
    const production = await req()
    assert.deepEqual(production, { ok: false, erro: preview.erro })
  } finally {
    if (ambienteAnterior === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = ambienteAnterior
    await new Promise((resolve) => server.close(resolve))
  }
})

test('atualização rápida aceita meli.la e /social/, rejeita URL comum e preserva todos os demais campos', async () => {
  const original = produto('MLB5348529958', { titulo: 'Kit 10 Esmaltes', linkAfiliado: 'https://www.mercadolivre.com.br/produto' })
  const linhas = new Map([[original.mercadoLivreId, { ...original }]])
  const escritas = []
  const gateway = {
    async buscar(id) {
      const salvo = linhas.get(id)
      return salvo ? [{ mercado_livre_id: id, titulo: salvo.titulo, link_afiliado: salvo.linkAfiliado }] : []
    },
    async atualizar(id, anterior, novo) {
      escritas.push({ id, anterior, novo })
      const salvo = linhas.get(id)
      if (!salvo || salvo.linkAfiliado !== anterior) return []
      linhas.set(id, { ...salvo, linkAfiliado: novo })
      return [{ mercado_livre_id: id, link_afiliado: novo }]
    },
  }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ validarDestino: async () => {}, config: () => config, token: () => token, linkAfiliado: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const req = async (body, bearer = token) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/produtos/link-afiliado`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, json: await response.json() }
    }
    const id = original.mercadoLivreId
    const curto = 'https://meli.la/1Yu9QRC'
    const social = 'https://www.mercadolivre.com.br/social/ee20260414070618?matt_word=valiosite&matt_tool=20840303&forceInApp=true&ref=a%2Fb'
    const primeiro = await req({ mercado_livre_id: id, link_afiliado: curto })
    assert.equal(primeiro.status, 200)
    assert.deepEqual(primeiro.json, { ok: true, produto: original.titulo, mercado_livre_id: id,
      link_anterior: original.linkAfiliado, link_afiliado: curto })
    assert.deepEqual(linhas.get(id), { ...original, linkAfiliado: curto })
    const segundo = await req({ mercado_livre_id: id, link_afiliado: social })
    assert.equal(segundo.status, 200)
    assert.equal(segundo.json.link_afiliado, social)
    assert.equal(segundo.json.link_anterior, curto)
    assert.deepEqual(linhas.get(id), { ...original, linkAfiliado: social })
    assert.equal((await req({ mercado_livre_id: id, link_afiliado: 'https://www.mercadolivre.com.br/produto/p/MLB123?extra_comm=true#sid=affiliates' })).status, 400)
    assert.equal((await req({ mercado_livre_id: 'MLB999999', link_afiliado: curto })).status, 404)
    assert.equal((await req({ mercado_livre_id: id, link_afiliado: curto }, 'token-errado')).status, 401)
    assert.equal((await req({ mercado_livre_id: id, link_afiliado: curto, preco: 1 })).status, 400)
    assert.equal((await req({ mercado_livre_id: 'MLB-123', link_afiliado: curto })).status, 400)
    assert.equal((await req({ mercado_livre_id: id, link_afiliado: 'http://meli.la/1Yu9QRC' })).status, 400)
    assert.equal((await req({ mercado_livre_id: id, link_afiliado: 'https://www.mercadolivre.com.br/social/abc?forceInApp=true' })).status, 400)
    assert.equal(escritas.length, 2)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('atualização rápida rejeita resultados múltiplos e alteração concorrente', async () => {
  const link = 'https://meli.la/1Yu9QRC'
  const app = express(); app.use(express.json())
  let mode = 'duplicado'
  const gateway = {
    async buscar(id) { return mode === 'duplicado'
      ? [{ mercado_livre_id: id, titulo: 'Um', link_afiliado: 'https://meli.la/1' },
        { mercado_livre_id: id, titulo: 'Dois', link_afiliado: 'https://meli.la/2' }]
      : [{ mercado_livre_id: id, titulo: 'Um', link_afiliado: 'https://meli.la/1' }] },
    async atualizar() { return mode === 'concorrente' ? [] : [
      { mercado_livre_id: 'MLB1', link_afiliado: link }, { mercado_livre_id: 'MLB1', link_afiliado: link },
    ] },
  }
  app.use('/api/valio', criarRotaValioProdutos({ validarDestino: async () => {}, config: () => config, token: () => token, linkAfiliado: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const req = async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/produtos/link-afiliado`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mercado_livre_id: 'MLB1', link_afiliado: link }),
      })
      return response.status
    }
    assert.equal(await req(), 409)
    mode = 'concorrente'; assert.equal(await req(), 409)
    mode = 'multiplosAtualizados'; assert.equal(await req(), 409)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
