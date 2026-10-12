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
