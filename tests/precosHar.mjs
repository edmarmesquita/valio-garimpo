import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const s = await vite.ssrLoadModule('/server/precosHar.ts')
const { criarPrecosHarGateway } = await vite.ssrLoadModule('/server/services/precosHar.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const agora = Date.parse('2026-10-21T15:00:00Z')
const pedido = (outros = {}) => ({ itemId: 'MLB123', precoBase: 100, novoPreco: 110, classificacao: 'NORMAL',
  evidencia: { moeda: 'BRL', labels: [''], precoAnterior: null, conflito: false }, ...outros })
const row = (outros = {}) => ({ mercado_livre_id: 'MLB123', titulo: 'Produto sintético', preco: 100, ativo: true,
  oferta_relampago: false, oferta_inicio: null, oferta_fim: null, ...outros })
const validar = (p = pedido(), r = [row()]) => s.bloqueioPrecoHar(p, r, agora).status
test('NORMAL dentro de 30% revalida', () => assert.equal(validar(), 'PRONTO'))
test('DESCONTO dentro de 30% revalida', () => assert.equal(validar(pedido({ classificacao: 'DESCONTO', evidencia: { moeda: 'BRL', labels: ['10% OFF'], precoAnterior: 150, conflito: false } })), 'PRONTO'))
for (const [tipo, label] of [['PIX', '8% OFF no Pix'], ['CUPOM', 'com Cupom'], ['OUTRO_REVISAR', 'Saldo no Mercado Pago']]) {
  test(`${tipo} bloqueado inclusive quando cliente mente NORMAL`, () => {
    const evidencia = { moeda: 'BRL', labels: [label], precoAnterior: null, conflito: false }
    assert.equal(validar(pedido({ classificacao: tipo, evidencia })), 'BLOQUEADO_CLASSIFICACAO')
    assert.equal(validar(pedido({ evidencia })), 'BLOQUEADO_CLASSIFICACAO')
  })
}
test('Pix + Cupom, conflito HAR, moedas e classes divergentes bloqueados', () => {
  for (const evidencia of [{ moeda: 'BRL', labels: ['Pix com Cupom'], precoAnterior: null, conflito: false },
    { moeda: 'BRL', labels: [''], precoAnterior: null, conflito: true }, { moeda: 'USD', labels: [''], precoAnterior: null, conflito: false },
    { moeda: 'BRL', labels: ['', '10% OFF'], precoAnterior: null, conflito: false }]) {
    assert.equal(validar(pedido({ evidencia })), 'BLOQUEADO_CLASSIFICACAO')
  }
})
test('oferta ativa, agendada e dados incertos são bloqueados; expirada pode revalidar', () => {
  for (const p of [row({ oferta_relampago: true }), row({ oferta_relampago: true, oferta_inicio: '2030-01-01', oferta_fim: '2030-01-02' }),
    row({ oferta_relampago: true, oferta_fim: 'inválida' }), row({ oferta_relampago: true, oferta_fim: '2026-02-30T00:00:00Z' }), row({ oferta_relampago: null })]) assert.equal(validar(pedido(), [p]), 'BLOQUEADO_OFERTA')
  assert.equal(validar(pedido(), [row({ oferta_relampago: true, oferta_fim: '2026-10-20' })]), 'PRONTO')
  assert.equal(validar(pedido(), [row({ oferta_relampago: true, oferta_fim: '2026-10-21' })]), 'BLOQUEADO_OFERTA')
})
test('inativo bloqueado', () => assert.equal(validar(pedido(), [row({ ativo: false })]), 'BLOQUEADO_INATIVO'))
test('inexistente bloqueado', () => assert.equal(validar(pedido(), []), 'BLOQUEADO_NAO_ENCONTRADO'))
test('preço-base diferente e precisão escondida bloqueados', () => {
  assert.equal(validar(pedido(), [row({ preco: 101 })]), 'BLOQUEADO_PRECO_ALTERADO')
  assert.equal(validar(pedido(), [row({ preco: 100.001 })]), 'BLOQUEADO_PRECO_ALTERADO')
})
for (const [novo, status] of [[130.01, 'BLOQUEADO_VARIACAO_EXTREMA'], [69.99, 'BLOQUEADO_VARIACAO_EXTREMA'], [130, 'PRONTO'], [70, 'PRONTO']]) {
  test(`limite extremo ${novo} é ${status}`, () => assert.equal(validar(pedido({ novoPreco: novo })), status))
}
test('payload recusa CSV, preço inválido, campos extras, duplicatas e HAR bruto', () => {
  for (const b of [{ fonte: 'csv', itens: [pedido()] }, { fonte: 'api', itens: [pedido({ novoPreco: 0 })] },
    { fonte: 'api', itens: [pedido({ link_afiliado: 'não permitido' })] }, { fonte: 'api', itens: [pedido(), pedido()] },
    { fonte: 'api', itens: [pedido()], har: {} }]) assert.throws(() => s.validarPedidoHar(b))
})
test('resultado individual, falha isolada e corrida entre SELECT/UPDATE não gravam incorretamente', async () => {
  const escritos = []
  const g = { async buscar(id) { if (id === 'MLB2') throw new Error('segredo'); return [row({ mercado_livre_id: id })] },
    async atualizar(p, novo) { escritos.push([p.mercado_livre_id, novo]); return 1 } }
  const resultados = await s.processarPrecosHar([pedido(), pedido({ itemId: 'MLB2' }), pedido({ itemId: 'MLB3' })], g, () => agora, true)
  assert.deepEqual(resultados.map((p) => p.status), ['ATUALIZADO', 'ERRO', 'ATUALIZADO'])
  assert.deepEqual(escritos, [['MLB123', 110], ['MLB3', 110]])
  assert.doesNotMatch(JSON.stringify(resultados), /segredo/)
  let consultas = 0
  const corrida = await s.processarPrecosHar([pedido()], { async buscar() { consultas++; return [row({ preco: consultas === 1 ? 100 : 105 })] }, async atualizar() { return 0 } }, () => agora, true)
  assert.equal(corrida[0].status, 'BLOQUEADO_PRECO_ALTERADO')
})
test('gateway real com transporte mock: UPDATE contém SOMENTE preco e CAS de preço/ativo/ofertas', async () => {
  const chamadas = []
  const g = criarPrecosHarGateway({ url: 'https://mock.example', serviceRoleKey: 'chave-sintetica' }, async (url, opts) => {
    chamadas.push({ url: String(url), opts })
    return new Response(JSON.stringify(opts.method === 'PATCH' ? [{ mercado_livre_id: 'MLB123' }] : [row()]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  assert.equal((await g.buscar('MLB123')).length, 1)
  assert.equal(await g.atualizar(row(), 110), 1)
  const patch = chamadas.find((p) => p.opts.method === 'PATCH')
  assert.deepEqual(JSON.parse(patch.opts.body), { preco: 110 })
  const query = new URL(patch.url).searchParams
  for (const [k, v] of Object.entries({ mercado_livre_id: 'eq.MLB123', ativo: 'eq.true', preco: 'eq.100', oferta_relampago: 'eq.false', oferta_inicio: 'is.null', oferta_fim: 'is.null' })) assert.equal(query.get(k), v)
  // A whitelist do patch também comprova preservação de link, ativo, título e campos de oferta.
  for (const proibido of ['link_afiliado', 'ativo', 'oferta_relampago', 'oferta_inicio', 'oferta_fim', 'titulo', 'imagem', 'categoria', 'updated_at']) assert.equal(Object.hasOwn(JSON.parse(patch.opts.body), proibido), false)
})
test('endpoints autenticados: revalidar nunca grava, assinatura vincula valores, confirmar reconsulta, replay falha no CAS', async () => {
  const token = 'token-sintetico-operacional-1234567890'
  let atual = row(); let escritas = 0
  const g = { async buscar() { return [structuredClone(atual)] }, async atualizar(anterior, novo) {
    if (anterior.preco !== atual.preco || !atual.ativo || atual.oferta_relampago) return 0
    atual.preco = novo; escritas++; return 1
  } }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ config: () => ({ url: 'https://mock.example', serviceRoleKey: 'segredo-sintetico' }), token: () => token,
    precosHar: () => g, agora: () => new Date(agora) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const request = async (acao, body, bearer = token) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/produtos/precos-har/${acao}`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
  }
  try {
    assert.equal((await request('revalidar', { fonte: 'api', itens: [pedido()] }, 'invalido')).status, 401)
    assert.equal((await request('revalidar', { fonte: 'csv', itens: [pedido()] })).status, 400)
    const r = await request('revalidar', { fonte: 'api', itens: [pedido()] })
    assert.equal(r.body.previa.resultados[0].status, 'PRONTO'); assert.equal(escritas, 0)
    const assinado = { previa: r.body.previa, assinatura: r.body.assinatura }
    const adulterado = structuredClone(assinado); adulterado.previa.itens[0].novoPreco = 120
    assert.equal((await request('confirmar', adulterado)).status, 409)
    atual.oferta_relampago = true
    assert.equal((await request('confirmar', assinado)).body.resultados[0].status, 'BLOQUEADO_OFERTA'); assert.equal(escritas, 0)
    atual.oferta_relampago = false
    assert.equal((await request('confirmar', assinado)).body.resultados[0].status, 'ATUALIZADO'); assert.equal(escritas, 1)
    assert.equal((await request('confirmar', assinado)).body.resultados[0].status, 'BLOQUEADO_PRECO_ALTERADO'); assert.equal(escritas, 1)
    assert.equal(s.assinaturaHarValida(assinado.previa, assinado.assinatura, 'segredo-sintetico', agora + 300001), false)
  } finally { await new Promise((r) => server.close(r)) }
})
