import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { validarProdutoPublicacao } = await vite.ssrLoadModule('/server/valioProduto.ts')
after(async () => vite.close())

const token = 'token-de-publicacao-local-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'chave-administrativa-simulada-com-mais-de-32-caracteres' }
const payload = () => ({
  mercadoLivreId: 'MLB6706221784', titulo: 'Produto de teste', descricao: '',
  preco: 169.99, dataPreco: '10/10/2026',
  linkAfiliado: 'https://www.mercadolivre.com.br/produto?p=a%2Fb#sid=affiliates',
  categoria: 'Achados para Elas', rating: 4.9,
  imagem: 'https://http2.mlstatic.com/imagem.webp',
})

test('valida produto completo e preserva link; recusa ID ausente e categoria inválida', () => {
  assert.deepEqual(validarProdutoPublicacao(payload()), payload())
  assert.throws(() => validarProdutoPublicacao({ ...payload(), mercadoLivreId: '' }), /mercadoLivreId/)
  assert.throws(() => validarProdutoPublicacao({ ...payload(), categoria: 'Outro' }), /categoria/)
  assert.throws(() => validarProdutoPublicacao({ ...payload(), serviceRoleKey: 'nunca' }), /campos não permitidos/)
  assert.throws(() => validarProdutoPublicacao({ ...payload(), dataPreco: '10/10' }), /dd\/mm\/aaaa/)
})

async function servidor(deps, executar) {
  const app = express()
  app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos(deps))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos`
    const postar = async (produto = payload(), bearer = token) => {
      const resposta = await fetch(url, { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`,
      }, body: JSON.stringify(produto) })
      return { status: resposta.status, json: await resposta.json() }
    }
    await executar(postar)
  } finally { await new Promise((resolve) => server.close(resolve)) }
}

test('rota protegida cria produto novo e atualiza existente por ID sem duplicar', async () => {
  const linhas = new Map()
  const gateway = {
    async obterLinkAfiliado(id) { return linhas.get(id)?.link_afiliado ?? null },
    async upsert(row) { linhas.set(row.mercado_livre_id, row) },
  }
  await servidor({ config: () => config, token: () => token, gateway: () => gateway }, async (postar) => {
    assert.deepEqual(await postar(), { status: 200, json: { ok: true, acao: 'criado' } })
    assert.deepEqual(await postar({ ...payload(), preco: 179.99 }), { status: 200, json: { ok: true, acao: 'atualizado' } })
    assert.equal(linhas.size, 1)
    assert.equal(linhas.get('MLB6706221784').preco, 179.99)
    assert.equal(linhas.get('MLB6706221784').link_afiliado, payload().linkAfiliado)
    assert.equal(linhas.get('MLB6706221784').ativo, true)
    assert.equal((await postar(payload(), 'errado')).status, 401)
    assert.equal((await postar(payload(), config.serviceRoleKey)).status, 401)
  })
})

test('preserva meli.la e URL social integral; URL comum não substitui link monetizado', async () => {
  const linhas = new Map()
  const gateway = {
    async obterLinkAfiliado(id) { return linhas.get(id)?.link_afiliado ?? null },
    async upsert(row) { linhas.set(row.mercado_livre_id, row) },
  }
  const curto = 'https://meli.la/1Yu9QRC'
  const social = 'https://www.mercadolivre.com.br/social/ee20260414070618?matt_word=valiosite&matt_tool=20840303&forceInApp=true&ref=a%2Fb#origem=afiliado'
  const comum = 'https://produto.mercadolivre.com.br/MLB-6706221784-produto-_JM?extra_comm=false#sid=affiliates'
  await servidor({ config: () => config, token: () => token, gateway: () => gateway }, async (postar) => {
    assert.equal((await postar({ ...payload(), linkAfiliado: curto })).status, 200)
    assert.equal(linhas.get(payload().mercadoLivreId).link_afiliado, curto)
    assert.equal((await postar({ ...payload(), linkAfiliado: comum, preco: 180 })).status, 200)
    assert.equal(linhas.get(payload().mercadoLivreId).link_afiliado, curto)
    assert.equal(linhas.get(payload().mercadoLivreId).preco, 180)
    assert.equal((await postar({ ...payload(), linkAfiliado: social })).status, 200)
    assert.equal(linhas.get(payload().mercadoLivreId).link_afiliado, social)
    assert.equal((await postar({ ...payload(), linkAfiliado: comum })).status, 200)
    assert.equal(linhas.get(payload().mercadoLivreId).link_afiliado, social)
  })
})

test('Service Role ausente bloqueia rota antes de publicar', async () => {
  let chamadas = 0
  await servidor({ config: () => null, token: () => token, gateway: () => { chamadas++; throw new Error('Não usar') } }, async (postar) => {
    assert.deepEqual(await postar(), { status: 503, json: { ok: false, erro: 'Publicação no Valiô não configurada no servidor.' } })
  })
  assert.equal(chamadas, 0)
})

test('rota recusa configuração que reutiliza a Service Role como token de publicação', async () => {
  await servidor({ config: () => config, token: () => config.serviceRoleKey }, async (postar) => {
    assert.equal((await postar()).status, 503)
  })
})

test('rota recusa payload inválido e não escreve no gateway', async () => {
  let escritas = 0
  await servidor({ config: () => config, token: () => token, gateway: () => ({
    async obterLinkAfiliado() { return null }, async upsert() { escritas++ },
  }) }, async (postar) => {
    assert.equal((await postar({ ...payload(), mercadoLivreId: '' })).status, 400)
    assert.equal((await postar({ ...payload(), categoria: 'Inexistente' })).status, 400)
  })
  assert.equal(escritas, 0)
})

test('app local aceita preflight e responde JSON para requisição malformada', async () => {
  const { default: app } = await vite.ssrLoadModule('/server/server.ts')
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos`
    const preflight = await fetch(url, { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    } })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
    const malformada = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    assert.equal(malformada.status, 400)
    assert.match(malformada.headers.get('content-type'), /application\/json/)
    assert.deepEqual(await malformada.json(), { ok: false, erro: 'JSON inválido na requisição.' })
    const ausente = await fetch(`${url}/inexistente`)
    assert.equal(ausente.status, 404)
    assert.match(ausente.headers.get('content-type'), /application\/json/)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('verificação consulta IDs únicos em lote, inclui inativos e protege a rota', async () => {
  const lotes = []
  const encontrado = { mercadoLivreId: 'MLB1', titulo: 'Cadastrado', preco: 54.9,
    dataPreco: '11/10/2026', categoria: 'Achados para Maridos',
    linkAfiliado: 'https://mercadolivre.com.br/a', imagem: 'https://imagem.com/a', ativo: false }
  const deps = { config: () => config, token: () => token,
    consulta: () => ({ async consultarExistentes(ids) { lotes.push(ids); return [encontrado] } }) }
  const app = express()
  app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos(deps))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos/verificar`
    const postar = (ids, bearer = token) => fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`,
    }, body: JSON.stringify({ mercadoLivreIds: ids }) })
    const resposta = await postar(['MLB1', '', 'MLB1', ' MLB2 '])
    assert.equal(resposta.status, 200)
    assert.deepEqual(await resposta.json(), { ok: true, existentes: [encontrado] })
    assert.deepEqual(lotes, [['MLB1', 'MLB2']])
    assert.equal((await postar(['MLB1'], 'incorreto')).status, 401)
    assert.equal((await postar(['INVÁLIDO'])).status, 400)
    assert.equal(lotes.length, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
