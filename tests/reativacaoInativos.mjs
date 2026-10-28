import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { selecionarExatos, pedidosDosExatos } = await vite.ssrLoadModule('/src/lib/reativarInativos.ts')
test.after(async () => vite.close())
const token = 'token-local-de-teste-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
const pedido = (id, preco = 125, moeda = 'BRL', capturado = id) =>
  ({ mercado_livre_id: id, item_id_capturado: capturado, preco, moeda })

test('reativa somente o registro inativo pelo mesmo ITEM_ID e preserva todos os outros campos', async () => {
  const original = { id: 10, mercado_livre_id: 'MLB1', ativo: false, preco: 100,
    categoria: 'Achados para Casa', link_afiliado: 'https://meli.la/abc', titulo: 'Produto antigo', imagem: 'imagem.webp' }
  const linhas = new Map([[original.mercado_livre_id, { ...original }], ['MLB2', { ...original, id: 11, mercado_livre_id: 'MLB2', ativo: true }]])
  const escritas = []
  const gateway = {
    async buscar(id) { return linhas.get(id) ?? null },
    async reativar(id, interno, preco, updatedAt) {
      const linha = linhas.get(id)
      if (!linha || linha.id !== interno || linha.ativo) return false
      escritas.push({ id, interno, preco, updatedAt })
      linhas.set(id, { ...linha, ativo: true, preco, updated_at: updatedAt })
      return true
    },
  }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token,
    agora: () => new Date('2026-10-27T12:00:00Z'), reativacao: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos/reativar-inativos`
    const enviar = async (produtos, bearer = token) => {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ produtos }) })
      return { status: res.status, body: await res.json() }
    }
    assert.equal((await enviar([pedido('MLB1')], 'invalido')).status, 401)
    const resposta = await enviar([pedido('MLB1'), pedido('MLB2'), pedido('MLB3'), pedido('MLB4', -1),
      pedido('MLB5', 22, 'USD'), pedido('MLB1', 30, 'BRL', 'MLB9')])
    assert.equal(resposta.status, 200)
    assert.equal(resposta.body.reativados, 1)
    assert.equal(resposta.body.erros, 5)
    assert.deepEqual(resposta.body.resultados.map((item) => item.status),
      ['REATIVADO', 'ERRO', 'ERRO', 'ERRO', 'ERRO', 'ERRO'])
    assert.match(resposta.body.resultados[1].motivo, /já está ativo/)
    assert.match(resposta.body.resultados[2].motivo, /não encontrado/)
    assert.match(resposta.body.resultados[3].motivo, /Preço inválido/)
    assert.match(resposta.body.resultados[4].motivo, /Moeda diferente/)
    assert.match(resposta.body.resultados[5].motivo, /ITEM_ID da captura/)
    assert.deepEqual(linhas.get('MLB1'), { ...original, ativo: true, preco: 125, updated_at: '2026-10-27T12:00:00.000Z' })
    assert.equal(linhas.size, 2)
    assert.equal(escritas.length, 1)
    assert.deepEqual(escritas[0], { id: 'MLB1', interno: 10, preco: 125, updatedAt: '2026-10-27T12:00:00.000Z' })
    assert.equal((await enviar([pedido('MLB1')])).body.resultados[0].motivo, 'Produto já está ativo.')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('falha de concorrência não sobrescreve o registro e não impede outros produtos', async () => {
  const linhas = new Map([['MLB1', { id: 1, mercado_livre_id: 'MLB1', ativo: false }],
    ['MLB2', { id: 2, mercado_livre_id: 'MLB2', ativo: false }]])
  const gateway = { async buscar(id) { return linhas.get(id) ?? null },
    async reativar(id) { if (id === 'MLB1') { linhas.get(id).ativo = true; return false } return true } }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token, reativacao: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/produtos/reativar-inativos`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtos: [pedido('MLB1'), pedido('MLB2')] }) })
    const json = await res.json()
    assert.equal(json.reativados, 1)
    assert.equal(json.erros, 1)
    assert.equal(json.resultados[0].motivo, 'Produto já está ativo.')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('seleção aceita apenas EXATO e monta pedido sem dados de candidato', () => {
  const catalogo = (id) => ({ mercadoLivreId: id, preco: 100 })
  const diagnostico = [
    { inativo: catalogo('MLB1'), tipo: 'EXATO', exato: { itemId: 'MLB1', preco: 125 } },
    { inativo: catalogo('MLB2'), tipo: 'CANDIDATO', exato: null },
    { inativo: catalogo('MLB3'), tipo: 'EXATO', exato: { itemId: 'MLB9', preco: 40 } },
  ]
  assert.deepEqual(selecionarExatos(diagnostico, new Set()), [])
  const um = selecionarExatos(diagnostico, new Set(['MLB1']))
  assert.equal(um.length, 1)
  assert.deepEqual(pedidosDosExatos(um), [pedido('MLB1')])
  assert.deepEqual(selecionarExatos(diagnostico, new Set(['MLB1', 'MLB2', 'MLB3'])), um)
})
