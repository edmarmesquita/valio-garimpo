import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import express from 'express'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarPreviaOfertas, criarPreviaLimpezaExpiradas, confirmarPreviaOfertas, validarPedidoOfertas, assinarPrevia, validarAssinatura } =
  await vite.ssrLoadModule('/server/ofertasRelampagoLote.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { mapearProdutoParaRow, criarOfertasGateway } = await vite.ssrLoadModule('/server/services/supabase.ts')
test.after(async () => vite.close())

const id = (n) => `MLB${1000 + n}`
const clone = (valor) => JSON.parse(JSON.stringify(valor))

test('relógio ativa agendadas, mantém limite e modos da Home, e expira no limite', async () => {
  const { classificarOfertas } = await vite.ssrLoadModule('/src/features/ofertas-relampago/gerenciarOfertas.ts')
  const { agendaIso, agendaInput } = await vite.ssrLoadModule('/src/features/ofertas-relampago/agendaOferta.ts')
  const inicio = '2026-10-17T11:00:00Z', fim = '2026-10-17T15:00:00Z'
  const produtos = Array.from({ length: 15 }, (_, i) => row(i + 1, { oferta_relampago: true,
    oferta_inicio: inicio, oferta_fim: fim, home_oferta_mode: i === 14 ? 'fixada' : i === 0 ? 'fila' : 'auto' }))
  const antes = classificarOfertas(produtos, Date.parse(inicio) - 1)
  assert.equal(antes.filter((p) => p.ativa || p.naHome || p.naFila).length, 0)
  assert.equal(antes.filter((p) => p.situacao === 'AGENDADA').length, 15)
  const durante = classificarOfertas(produtos, Date.parse(inicio))
  assert.equal(durante.filter((p) => p.ativa).length, 15)
  assert.equal(durante.filter((p) => p.naHome).length, 12)
  assert.equal(durante.find((p) => p.mercado_livre_id === id(15)).naHome, true)
  assert.equal(durante.find((p) => p.mercado_livre_id === id(1)).naFila, true)
  assert.equal(classificarOfertas(produtos, Date.parse(fim)).filter((p) => p.ativa).length, 0)
  assert.equal(produtos.every((p) => p.ativo), true)
  assert.equal(agendaIso('2026-10-17T08:00'), inicio.replace('Z', '.000Z'))
  assert.equal(agendaInput(inicio), '2026-10-17T08:00')
})

test('agenda: prévia, edição, cancelamento e recheck preservam o catálogo', async () => {
  const agora = Date.parse('2026-10-16T12:00:00Z')
  const { rows, escritas, gateway } = fake(1)
  const original = clone(rows.get(id(1)))
  const pedido = (inicio, fim = null, modo = 'AGENDAR') => ({ modo, itens: [{ tipo: 'ATUALIZAR_OFERTA',
    dados: { mercadoLivreId: id(1), ofertaInicio: inicio, ofertaFim: fim } }] })
  const inicio = '2026-10-17T11:00:00Z', fim = '2026-10-17T15:00:00Z'
  let previa = await criarPreviaOfertas(pedido(inicio, fim), gateway, agora)
  assert.equal(escritas.length, 0)
  assert.match(previa.operacoes[0].resultadoEsperado, /Início:.*→.*Fim:/)
  await confirmarPreviaOfertas(previa, gateway, new Date(agora))
  assert.deepEqual(escritas[0].alteracao, { oferta_relampago: true, oferta_inicio: inicio, oferta_fim: fim })
  assert.deepEqual(rows.get(id(1)), { ...original, ...escritas[0].alteracao })
  const editado = '2026-10-17T12:00:00Z'
  previa = await criarPreviaOfertas(pedido(editado, fim), gateway, agora)
  await confirmarPreviaOfertas(previa, gateway, new Date(agora))
  assert.equal(rows.get(id(1)).oferta_inicio, editado)
  previa = await criarPreviaOfertas(pedido(null, fim, 'ATIVAR_AGORA'), gateway, agora)
  await confirmarPreviaOfertas(previa, gateway, new Date(agora))
  assert.equal(rows.get(id(1)).oferta_inicio, null)
  previa = await criarPreviaOfertas(pedido(inicio, fim), gateway, agora)
  rows.get(id(1)).prioridade_oferta = 100
  assert.equal((await confirmarPreviaOfertas(previa, gateway, new Date(agora))).conflitos, 1)
  previa = await criarPreviaOfertas(pedido(inicio, fim), gateway, agora)
  assert.equal((await confirmarPreviaOfertas(previa, gateway, new Date(fim))).erros, 1)
  await assert.rejects(() => criarPreviaOfertas(pedido(inicio, inicio), gateway, agora))
  await assert.rejects(() => criarPreviaOfertas(pedido(inicio, '2026-10-15T12:00:00Z'), gateway, agora))
  await assert.rejects(() => criarPreviaOfertas(pedido('2026-10-15T12:00:00Z'), gateway, agora))
  previa = await criarPreviaOfertas({ modo: 'DESATIVAR', itens: [desativar(1)] }, gateway, agora)
  await confirmarPreviaOfertas(previa, gateway, new Date(agora))
  assert.equal(rows.get(id(1)).ativo, true)
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  assert.equal(rows.get(id(1)).link_afiliado, original.link_afiliado)
})
const row = (n, extras = {}) => ({ mercado_livre_id: id(n), titulo: `Produto ${n}`, preco: 49.9,
  categoria: 'Achados para Casa', imagem: 'https://img.test/item.webp', link_afiliado: `https://meli.la/atual${n}`,
  ativo: true, oferta_relampago: false, oferta_inicio: null, oferta_fim: null, preco_anterior: null,
  percentual_desconto: null, texto_oferta: null, prioridade_oferta: 0, home_oferta_mode: 'auto', ...extras })
const ativar = (n, priority = 0) => ({ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(n), ofertaRelampago: true,
  ofertaInicio: null, ofertaFim: '2026-10-17T12:00:00Z', precoAnterior: 80,
  percentualDesconto: 38, textoOferta: 'Oferta verificada', prioridadeOferta: priority } })
const desativar = (n) => ({ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(n), ofertaRelampago: false } })
const prioridade = (n, valor) => ({ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(n), prioridadeOferta: valor } })
const novo = (n, link = `https://meli.la/novo${n}`) => ({ tipo: 'NOVO_PRODUTO', dados: {
  mercadoLivreId: id(n), titulo: `Produto novo ${n}`, preco: 39.9, imagem: 'https://img.test/novo.webp',
  categoria: 'Achados para Casa', linkAfiliado: link, ofertaRelampago: true,
  ofertaInicio: null, ofertaFim: null, precoAnterior: 60, percentualDesconto: 33,
  textoOferta: null, prioridadeOferta: 50,
} })
function fake(quantidade = 0, extras = {}) {
  const rows = new Map(Array.from({ length: quantidade }, (_, index) => [id(index + 1), row(index + 1, extras[index + 1])]))
  const escritas = []
  const gateway = {
    async buscar(chave) { return rows.has(chave) ? [clone(rows.get(chave))] : [] },
    async listarAtivas() { return [...rows.values()].filter((item) => item.oferta_relampago).map(clone) },
    async atualizar(chave, anterior, alteracao) {
      const atual = rows.get(chave)
      if (!atual || JSON.stringify(atual) !== JSON.stringify(anterior)) return []
      rows.set(chave, { ...atual, ...alteracao })
      escritas.push({ acao: 'UPDATE', chave, alteracao: clone(alteracao) })
      return [clone(rows.get(chave))]
    },
    async inserir(produto) {
      if (rows.has(produto.mercado_livre_id)) { const erro = new Error('duplicate'); erro.code = '23505'; throw erro }
      rows.set(produto.mercado_livre_id, { ...produto })
      escritas.push({ acao: 'INSERT', chave: produto.mercado_livre_id, produto: clone(produto) })
    },
  }
  return { rows, escritas, gateway }
}

test('ativa uma oferta com prévia sem escrita e preserva colunas normais do existente', async () => {
  const { rows, escritas, gateway } = fake(1)
  const anterior = clone(rows.get(id(1)))
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [ativar(1, 100)] }, gateway)
  assert.equal(previa.operacoes[0].acao, 'ATIVAR')
  assert.equal(escritas.length, 0)
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.deepEqual([resultado.ativadas, resultado.erros, resultado.conflitos], [1, 0, 0])
  assert.deepEqual(Object.keys(escritas[0].alteracao).sort(), [
    'oferta_relampago', 'oferta_inicio', 'oferta_fim', 'preco_anterior', 'percentual_desconto', 'texto_oferta', 'prioridade_oferta',
  ].sort())
  for (const campo of ['mercado_livre_id', 'titulo', 'imagem', 'categoria', 'link_afiliado', 'preco', 'ativo']) {
    assert.equal(rows.get(id(1))[campo], anterior[campo])
  }
  assert.equal(rows.get(id(1)).prioridade_oferta, 100)
})

test('ativa várias, desativa uma e várias, mantendo histórico e sem excluir produtos', async () => {
  const { rows, escritas, gateway } = fake(4)
  const ativadas = await confirmarPreviaOfertas(await criarPreviaOfertas({ modo: 'ATIVAR', itens: [ativar(1), ativar(2), ativar(3)] }, gateway), gateway)
  assert.equal(ativadas.ativadas, 3)
  const uma = await confirmarPreviaOfertas(await criarPreviaOfertas({ modo: 'DESATIVAR', itens: [desativar(1)] }, gateway), gateway)
  assert.equal(uma.desativadas, 1)
  const varias = await confirmarPreviaOfertas(await criarPreviaOfertas({ modo: 'DESATIVAR', itens: [desativar(2), desativar(3)] }, gateway), gateway)
  assert.equal(varias.desativadas, 2)
  assert.equal(rows.size, 4)
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  assert.equal(rows.get(id(1)).preco_anterior, 80)
  assert.ok(escritas.filter((item) => item.acao === 'UPDATE').length === 6)
  assert.deepEqual(escritas.at(-1).alteracao, { oferta_relampago: false })
})

test('prioridade individual e em lote alteram apenas prioridade_oferta', async () => {
  const { rows, escritas, gateway } = fake(3)
  const primeiro = await confirmarPreviaOfertas(await criarPreviaOfertas({ modo: 'PRIORIDADE', itens: [prioridade(1, 100)] }, gateway), gateway)
  assert.equal(primeiro.atualizadas, 1)
  const varios = await confirmarPreviaOfertas(await criarPreviaOfertas({ modo: 'PRIORIDADE', itens: [prioridade(2, 50), prioridade(3, 100)] }, gateway), gateway)
  assert.equal(varios.atualizadas, 2)
  assert.deepEqual(escritas.map((item) => item.alteracao), [
    { prioridade_oferta: 100 }, { prioridade_oferta: 50 }, { prioridade_oferta: 100 },
  ])
  assert.deepEqual([1, 2, 3].map((n) => rows.get(id(n)).prioridade_oferta), [100, 50, 100])
})

test('criação INSERT-only exige meli.la e conflito posterior não sobrescreve produto', async () => {
  const { rows, escritas, gateway } = fake()
  assert.throws(() => validarPedidoOfertas({ modo: 'ATIVAR', itens: [novo(1, 'https://www.mercadolivre.com.br/direta')] }), /meli.la/)
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [novo(1), novo(2)] }, gateway)
  rows.set(id(1), row(1, { titulo: 'Criado por outra pessoa' }))
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.deepEqual([resultado.criadas, resultado.conflitos, resultado.erros], [1, 1, 0])
  assert.equal(rows.get(id(1)).titulo, 'Criado por outra pessoa')
  assert.equal(escritas.length, 1)
  assert.equal(escritas[0].acao, 'INSERT')
  assert.equal(rows.get(id(2)).link_afiliado, 'https://meli.la/novo2')
  assert.equal(rows.get(id(2)).oferta_relampago, true)
})

test('MLB5357067365 usa o mapeamento normal, data brasileira e INSERT-only sem tocar no existente', async () => {
  const existenteId = 'MLB4189368533'
  const novoId = 'MLB5357067365'
  const { rows, escritas, gateway } = fake()
  const existente = { ...row(1), mercado_livre_id: existenteId, oferta_relampago: true }
  rows.set(existenteId, clone(existente))
  const item = novo(1, 'https://meli.la/14jMKEN')
  item.dados.mercadoLivreId = novoId
  item.dados.categoria = 'Achados para Maridos'
  item.dados.ofertaFim = '2026-10-17T12:00:00Z'
  assert.doesNotThrow(() => validarPedidoOfertas({ modo: 'ATIVAR', itens: [item] }))
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [item] }, gateway)
  const agora = new Date('2026-10-15T12:00:00.000Z')
  const resultado = await confirmarPreviaOfertas(previa, gateway, agora)
  assert.deepEqual([resultado.criadas, resultado.ativadas, resultado.erros, resultado.conflitos], [1, 0, 0, 0])
  assert.deepEqual(escritas.map((escrita) => [escrita.acao, escrita.chave]), [['INSERT', novoId]])
  assert.deepEqual(rows.get(existenteId), existente)
  const gravado = escritas[0].produto
  assert.deepEqual(Object.keys(gravado).sort(), [
    'mercado_livre_id', 'titulo', 'descricao', 'preco', 'data_preco', 'link_afiliado', 'categoria',
    'rating', 'imagem', 'ativo', 'updated_at', 'oferta_relampago', 'oferta_inicio', 'oferta_fim',
    'preco_anterior', 'percentual_desconto', 'texto_oferta', 'prioridade_oferta',
  ].sort())
  assert.deepEqual(Object.fromEntries(Object.entries(gravado).filter(([chave]) => !chave.startsWith('oferta_')
    && !['preco_anterior', 'percentual_desconto', 'texto_oferta', 'prioridade_oferta'].includes(chave))),
  mapearProdutoParaRow({ mercadoLivreId: novoId, titulo: item.dados.titulo, descricao: '',
    preco: item.dados.preco, dataPreco: '15/10/2026', linkAfiliado: 'https://meli.la/14jMKEN',
    categoria: 'Achados para Maridos', rating: null, imagem: item.dados.imagem }, agora))
  assert.equal(gravado.data_preco, '15/10/2026')
  assert.equal(gravado.rating, null)
  assert.equal(gravado.descricao, '')
  assert.equal(gravado.oferta_inicio, null)
  assert.equal(gravado.oferta_fim, '2026-10-17T12:00:00Z')
  assert.equal(gravado.texto_oferta, null)
  assert.equal(gravado.oferta_relampago, true)
})

test('constraint data_preco do SQL aceita o novo mapeamento e rejeita o formato antigo', async () => {
  const db = await PGlite.create()
  try {
    await db.exec('create role service_role; create role anon; create role authenticated;')
    await db.exec(await readFile(new URL('../migrations/002_valio_produtos_supabase.sql', import.meta.url), 'utf8'))
    const parametros = ['MLB5357067365', 'Produto de teste', '', 39.9, '15/10/2026',
      'https://meli.la/14jMKEN', 'Achados para Maridos', null, 'https://img.test/novo.webp']
    const sql = 'insert into public.produtos (mercado_livre_id,titulo,descricao,preco,data_preco,link_afiliado,categoria,rating,imagem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)'
    await db.query(sql, parametros)
    await assert.rejects(db.query(sql, ['MLB9999999999', ...parametros.slice(1, 4), '2026-10-15', ...parametros.slice(5)]),
      /produtos_data_preco_check/)
    assert.equal((await db.query('select count(*)::int as total from public.produtos')).rows[0].total, 1)
  } finally { await db.close() }
})

test('erro técnico do Supabase é mostrado por ITEM_ID com segredo removido', async (t) => {
  const { gateway } = fake()
  const item = novo(1, 'https://meli.la/14jMKEN')
  item.dados.mercadoLivreId = 'MLB5357067365'
  item.dados.categoria = 'Achados para Maridos'
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [item] }, gateway)
  const segredo = 'segredo-de-teste-nao-expor'
  gateway.inserir = async () => { throw { code: '23514', message: 'data_preco viola produtos_data_preco_check',
    details: `Formato inválido; ${segredo}`, hint: 'Use dd/mm/aaaa.' } }
  const log = t.mock.method(console, 'error', () => {})
  const resultado = await confirmarPreviaOfertas(previa, gateway, new Date('2026-10-15T12:00:00Z'), [segredo])
  assert.deepEqual([resultado.criadas, resultado.erros], [0, 1])
  assert.equal(resultado.itens[0].itemId, 'MLB5357067365')
  assert.match(resultado.itens[0].motivo, /code: 23514/)
  assert.match(resultado.itens[0].motivo, /message: data_preco viola/)
  assert.match(resultado.itens[0].motivo, /details: Formato inválido/)
  assert.match(resultado.itens[0].motivo, /hint: Use dd\/mm\/aaaa/)
  assert.ok(!resultado.itens[0].motivo.includes(segredo))
  assert.ok(!JSON.stringify(log.mock.calls).includes(segredo))
})

test('substituição mostra antigas, desativa fora da seleção e ativa selecionadas sem excluir', async () => {
  const { rows, escritas, gateway } = fake(4, {
    1: { oferta_relampago: true }, 2: { oferta_relampago: true }, 3: { oferta_relampago: true },
  })
  const previa = await criarPreviaOfertas({ modo: 'SUBSTITUIR', itens: [ativar(2), ativar(4)] }, gateway)
  assert.equal(escritas.length, 0)
  assert.equal(previa.desativarAtuais, 2)
  assert.equal(previa.ativarSelecionadas, 1)
  assert.deepEqual(previa.operacoes.map((item) => [item.itemId, item.acao]), [
    [id(2), 'ATUALIZAR'], [id(4), 'ATIVAR'], [id(1), 'DESATIVAR'], [id(3), 'DESATIVAR'],
  ])
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.deepEqual([resultado.ativadas, resultado.desativadas, resultado.atualizadas], [1, 2, 1])
  assert.deepEqual([1, 2, 3, 4].map((n) => rows.get(id(n)).oferta_relampago), [false, true, false, true])
  assert.equal(rows.size, 4)
  assert.ok(escritas.every((item) => item.acao === 'UPDATE'))
})

test('substituição bloqueia a gravação inteira se outra oferta entrar na fila após a prévia', async () => {
  const { rows, escritas, gateway } = fake(3, { 1: { oferta_relampago: true } })
  const previa = await criarPreviaOfertas({ modo: 'SUBSTITUIR', itens: [ativar(2)] }, gateway)
  rows.set(id(3), { ...rows.get(id(3)), oferta_relampago: true })
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.equal(resultado.conflitos, previa.operacoes.length)
  assert.equal(escritas.length, 0)
  assert.equal(rows.get(id(1)).oferta_relampago, true)
  assert.equal(rows.get(id(2)).oferta_relampago, false)
  assert.equal(rows.get(id(3)).oferta_relampago, true)
})

test('rechecagem detecta alteração concorrente e continua nos demais itens', async () => {
  const { rows, gateway } = fake(2)
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [ativar(1), ativar(2)] }, gateway)
  rows.set(id(1), { ...rows.get(id(1)), link_afiliado: 'https://meli.la/outro' })
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.deepEqual([resultado.ativadas, resultado.conflitos], [1, 1])
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  assert.equal(rows.get(id(2)).oferta_relampago, true)
})

test('lote misto novo e existente, 30 ofertas e contagens corretas', async () => {
  const { rows, gateway } = fake(29)
  const itens = [...Array.from({ length: 29 }, (_, index) => ativar(index + 1)), novo(30)]
  const previa = await criarPreviaOfertas({ modo: 'ENVIAR', itens }, gateway)
  assert.equal(previa.operacoes.length, 30)
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.deepEqual([resultado.criadas, resultado.ativadas, resultado.atualizadas,
    resultado.desativadas, resultado.semAlteracao, resultado.conflitos, resultado.erros], [1, 29, 0, 0, 0, 0, 0])
  assert.equal(rows.size, 30)
})

test('whitelist rejeita campos extras, ID inválido, prioridade e datas inválidas', () => {
  const base = ativar(1)
  for (const item of [
    { ...base, dados: { ...base.dados, linkAfiliado: 'https://meli.la/invasao' } },
    { ...base, dados: { ...base.dados, mercadoLivreId: 'INVALIDO' } },
    { ...base, dados: { ...base.dados, prioridadeOferta: 30 } },
    { ...base, dados: { ...base.dados, ofertaFim: 'amanhã' } },
  ]) assert.throws(() => validarPedidoOfertas({ modo: 'ATIVAR', itens: [item] }))
  assert.throws(() => validarPedidoOfertas({ modo: 'ATIVAR', itens: [base], metadata: true }))
})

test('assinatura vincula prévia e expira; alteração do payload impede confirmação', async () => {
  const { gateway } = fake(1)
  const previa = await criarPreviaOfertas({ modo: 'ATIVAR', itens: [ativar(1)] }, gateway, 1000)
  const assinatura = assinarPrevia(previa, 'segredo-de-teste')
  assert.equal(validarAssinatura(previa, assinatura, 'segredo-de-teste', 2000), true)
  assert.equal(validarAssinatura({ ...previa, modo: 'SUBSTITUIR' }, assinatura, 'segredo-de-teste', 2000), false)
  assert.equal(validarAssinatura(previa, assinatura, 'segredo-de-teste', 602000), false)
})

test('rotas exigem token, prévia assinada e confirmação explícita para gravar', async () => {
  const { rows, escritas, gateway } = fake(1)
  const token = 'token-local-de-teste-com-mais-de-32-caracteres'
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({
    config: () => ({ url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }),
    token: () => token, ofertas: () => gateway,
  }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/valio/ofertas-relampago`
    const enviar = async (rota, body, bearer = token) => {
      const response = await fetch(base + rota, { method: 'POST', headers: {
        Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    const pedido = { modo: 'ATIVAR', itens: [ativar(1)] }
    assert.equal((await enviar('/listar', {}, 'errado')).status, 401)
    assert.equal((await enviar('/listar', { ativo: false })).status, 400)
    assert.deepEqual((await enviar('/listar', {})).body.produtos, [])
    const consulta = await enviar('/listar', { itemId: id(1) })
    assert.equal(consulta.status, 200)
    assert.equal(consulta.body.produtos[0].ativo, true)
    assert.equal('link_afiliado' in consulta.body.produtos[0], false)
    assert.equal((await enviar('/prever', pedido, 'errado')).status, 401)
    const previa = await enviar('/prever', pedido)
    assert.equal(previa.status, 200)
    assert.equal(escritas.length, 0)
    assert.equal((await enviar('/confirmar', { previa: previa.body.previa, assinatura: '0'.repeat(64) })).status, 400)
    assert.equal(escritas.length, 0)
    const confirmado = await enviar('/confirmar', { previa: previa.body.previa, assinatura: previa.body.assinatura })
    assert.equal(confirmado.status, 200)
    assert.equal(confirmado.body.ativadas, 1)
    assert.equal(escritas.length, 1)
    const listadas = await enviar('/listar', {})
    assert.equal(listadas.body.produtos.length, 1)
    assert.equal(listadas.body.produtos[0].oferta_relampago, true)
    assert.equal((await enviar('/expiradas/prever', {}, 'errado')).status, 401)
    assert.equal((await enviar('/expiradas/prever', { ativo: false })).status, 400)
    rows.set(id(1), { ...rows.get(id(1)), oferta_fim: new Date(Date.now() - 60_000).toISOString() })
    const antesLimpar = clone(rows.get(id(1)))
    const limpeza = await enviar('/expiradas/prever', {})
    assert.equal(limpeza.status, 200)
    assert.equal(limpeza.body.previa.modo, 'LIMPAR_EXPIRADAS')
    assert.equal(escritas.length, 1)
    const limpo = await enviar('/confirmar', { previa: limpeza.body.previa, assinatura: limpeza.body.assinatura })
    assert.equal(limpo.body.desativadas, 1)
    assert.deepEqual(rows.get(id(1)), { ...antesLimpar, oferta_relampago: false })
    assert.equal((await enviar('/expiradas/prever', {})).status, 409)
    assert.equal(rows.size, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('HTTP HOME aceita payload mínimo do cliente sem erro de lote, assina e confirma somente home_oferta_mode', async () => {
  const { preverOfertas, confirmarOfertas } = await vite.ssrLoadModule('/src/lib/ofertasRelampagoApi.ts')
  const { rows, escritas, gateway } = fake()
  const itemId = 'MLB5552965854'
  rows.set(itemId, row(1, { mercado_livre_id: itemId, oferta_relampago: true }))
  const token = 'token-local-de-teste-com-mais-de-32-caracteres'
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({
    config: () => ({ url: 'https://teste.supabase.co', serviceRoleKey: 'segredo-falso-de-teste-com-mais-de-32-caracteres' }),
    token: () => token, ofertas: () => gateway,
  }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const enviar = async (url, options) => {
      const body = JSON.parse(options.body)
      if (url.endsWith('/prever')) {
        assert.equal(body.modo, 'HOME')
        assert.deepEqual(Object.keys(body).sort(), ['itens', 'modo'])
        assert.deepEqual(Object.keys(body.itens[0].dados).sort(), ['homeOfertaMode', 'mercadoLivreId'])
      }
      const resposta = await fetch(base + url, options)
      assert.equal(resposta.status, 200, JSON.stringify(await resposta.clone().json()))
      return resposta
    }
    for (const [origem, destino, texto] of [
      ['auto', 'fila', 'Automática → Enviar para fila'],
      ['auto', 'fixada', 'Automática → Fixar na Home'],
      ['fila', 'auto', 'Enviar para fila → Automática'],
      ['fixada', 'fila', 'Fixar na Home → Enviar para fila'],
    ]) {
      rows.set(itemId, { ...rows.get(itemId), home_oferta_mode: origem })
      const antes = clone(rows.get(itemId))
      const total = escritas.length
      const previa = await preverOfertas('HOME', [{ tipo: 'ATUALIZAR_OFERTA',
        dados: { mercadoLivreId: itemId, homeOfertaMode: destino } }], token, enviar)
      assert.equal(previa.previa.modo, 'HOME')
      assert.equal(previa.previa.operacoes[0].acao, 'ATUALIZAR')
      assert.ok(previa.previa.operacoes[0].resultadoEsperado.includes(texto))
      assert.equal(escritas.length, total)
      assert.deepEqual(rows.get(itemId), antes)
      const confirmado = await confirmarOfertas(previa, token, enviar)
      assert.equal(confirmado.atualizadas, 1)
      assert.equal(escritas.length, total + 1)
      assert.deepEqual(escritas.at(-1).alteracao, { home_oferta_mode: destino })
      assert.deepEqual(rows.get(itemId), { ...antes, home_oferta_mode: destino })
    }
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('reativação gerenciada altera apenas oferta_relampago e revalida prazo e concorrência', async () => {
  const agora = new Date('2026-10-16T12:00:00Z')
  const { gateway, rows, escritas } = fake(3, {
    1: { oferta_fim: '2026-10-17T12:00:00Z', prioridade_oferta: 50, preco_anterior: 80 },
    2: { oferta_fim: '2026-10-15T12:00:00Z' },
    3: { ativo: false },
  })
  const pedido = (n) => ({ modo: 'REATIVAR', itens: [{ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(n), ofertaRelampago: true } }] })
  const anterior = clone(rows.get(id(1)))
  const previa = await criarPreviaOfertas(pedido(1), gateway, agora.getTime())
  assert.equal(escritas.length, 0)
  assert.equal(previa.operacoes[0].prioridade, 50)
  assert.equal(previa.operacoes[0].ofertaFim, anterior.oferta_fim)
  const resultado = await confirmarPreviaOfertas(previa, gateway, agora)
  assert.equal(resultado.ativadas, 1)
  assert.deepEqual(escritas[0].alteracao, { oferta_relampago: true })
  assert.deepEqual(rows.get(id(1)), { ...anterior, oferta_relampago: true })
  await assert.rejects(() => criarPreviaOfertas(pedido(2), gateway, agora.getTime()), /não pode ser reativada/)
  await assert.rejects(() => criarPreviaOfertas(pedido(3), gateway, agora.getTime()), /não pode ser reativada/)
  const desativacao = await criarPreviaOfertas({ modo: 'DESATIVAR', itens: [desativar(1)] }, gateway)
  await confirmarPreviaOfertas(desativacao, gateway, agora)
  assert.equal(rows.get(id(1)).ativo, true)
  const expiravel = await criarPreviaOfertas(pedido(1), gateway, agora.getTime())
  const expirou = await confirmarPreviaOfertas(expiravel, gateway, new Date('2026-10-18T00:00:00Z'))
  assert.equal(expirou.erros, 1)
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  rows.set(id(1), { ...rows.get(id(1)), prioridade_oferta: 100 })
  const conflito = await confirmarPreviaOfertas(expiravel, gateway, agora)
  assert.equal(conflito.conflitos, 1)
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  assert.throws(() => validarPedidoOfertas({ modo: 'REATIVAR', itens: [{ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(1), ofertaRelampago: true, ativo: true } }] }))
})

test('listagem paginada de gerenciamento usa created_at desc e inclui marcadas futuras e expiradas', async () => {
  const originalFetch = globalThis.fetch
  const consultas = []
  const produtos = Array.from({ length: 501 }, (_, i) => row(i + 1, { oferta_relampago: true,
    oferta_inicio: i === 0 ? '2099-01-01T00:00:00Z' : null,
    oferta_fim: i === 1 ? '2000-01-01T00:00:00Z' : null }))
  try {
    globalThis.fetch = async (endereco, options) => {
      const url = new URL(String(endereco))
      consultas.push(url)
      assert.equal(options.method ?? 'GET', 'GET')
      assert.equal(url.searchParams.get('oferta_relampago'), 'eq.true')
      assert.equal(url.searchParams.get('order'), 'created_at.desc')
      assert.equal(url.searchParams.has('ativo'), false)
      const inicio = Number(url.searchParams.get('offset') ?? 0)
      return new Response(JSON.stringify(produtos.slice(inicio, inicio + 500)), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const gateway = criarOfertasGateway({ url: 'https://teste.supabase.co', serviceRoleKey: 'chave-falsa' })
    const ofertas = await gateway.listarGerenciamento()
    assert.equal(ofertas.length, 501)
    assert.equal(consultas.length, 2)
    assert.equal(ofertas[0].oferta_inicio, '2099-01-01T00:00:00Z')
    assert.equal(ofertas[1].oferta_fim, '2000-01-01T00:00:00Z')
  } finally { globalThis.fetch = originalFetch }
})

test('lote preparado exige prazo válido em nova prévia e na rechecagem antes de gravar cada item', async () => {
  const { gateway, rows, escritas } = fake(2)
  const agora = Date.parse('2026-10-16T12:00:00Z')
  const expiravel = ativar(1)
  expiravel.dados.ofertaFim = '2026-10-16T12:01:00Z'
  const pedido = { modo: 'ENVIAR', exigirPrazoValido: true, itens: [expiravel, ativar(2)] }
  const previa = await criarPreviaOfertas(pedido, gateway, agora)
  assert.equal(previa.exigirPrazoValido, true)
  assert.equal(escritas.length, 0)
  const assinatura = assinarPrevia(previa, 'segredo-teste')
  const semValidacao = { ...previa }; delete semValidacao.exigirPrazoValido
  assert.equal(validarAssinatura(semValidacao, assinatura, 'segredo-teste', agora + 30_000), false)
  await assert.rejects(() => criarPreviaOfertas(pedido, gateway, agora + 60_000), /expirada/)
  const resultado = await confirmarPreviaOfertas(previa, gateway, new Date(agora + 120_000))
  assert.equal(resultado.erros, 1)
  assert.equal(resultado.ativadas, 1)
  assert.equal(rows.get(id(1)).oferta_relampago, false)
  assert.equal(rows.get(id(2)).oferta_relampago, true)
  assert.equal(escritas.length, 1)
  assert.equal(escritas[0].chave, id(2))
  assert.throws(() => validarPedidoOfertas({ ...pedido, exigirPrazoValido: false }))
})

for (const [origem, destino, descricao] of [
  ['auto', 'fila', 'Automática → Enviar para fila'],
  ['auto', 'fixada', 'Automática → Fixar na Home'],
  ['fila', 'auto', 'Enviar para fila → Automática'],
  ['fixada', 'fila', 'Fixar na Home → Enviar para fila'],
]) test(`MLB5552965854: Home ${origem} → ${destino} independe da prioridade 0`, async () => {
  const { gateway, rows, escritas } = fake()
  const itemId = 'MLB5552965854'
  const antes = row(1, { mercado_livre_id: itemId, titulo: 'Coenzima Q10 200mg Pura Alta Concentração 60 Cápsulas',
    oferta_relampago: true, home_oferta_mode: origem, prioridade_oferta: 0 })
  rows.set(itemId, antes)
  const previa = await criarPreviaOfertas({ modo: 'HOME', itens: [{ tipo: 'ATUALIZAR_OFERTA',
    dados: { mercadoLivreId: itemId, homeOfertaMode: destino } }] }, gateway)
  assert.equal(previa.modo, 'HOME')
  assert.equal(previa.operacoes[0].acao, 'ATUALIZAR')
  assert.equal(previa.operacoes[0].prioridade, 0)
  assert.ok(previa.operacoes[0].resultadoEsperado.includes(descricao))
  assert.equal(escritas.length, 0)
  assert.deepEqual(rows.get(itemId), antes)
  const resultado = await confirmarPreviaOfertas(previa, gateway)
  assert.equal(resultado.erros, 0)
  assert.equal(escritas.length, 1)
  assert.deepEqual(escritas[0].alteracao, { home_oferta_mode: destino })
  assert.deepEqual(rows.get(itemId), { ...antes, home_oferta_mode: destino })
})

test('controle explícito de Home grava somente o modo e rechecagem detecta mudança concorrente', async () => {
  const { gateway, rows, escritas } = fake(15, Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, { oferta_relampago: true }])))
  const pedido = (n, modo) => ({ modo: 'HOME', itens: [{ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(n), homeOfertaMode: modo } }] })
  for (const [n, modo] of [[1, 'fila'], [15, 'fixada'], [1, 'auto']]) {
    const antes = clone(rows.get(id(n)))
    const previa = await criarPreviaOfertas(pedido(n, modo), gateway)
    const totalAntes = escritas.length
    assert.equal(previa.operacoes[0].homeOfertaMode, modo)
    assert.equal(escritas.length, totalAntes)
    await confirmarPreviaOfertas(previa, gateway)
    assert.deepEqual(escritas.at(-1).alteracao, { home_oferta_mode: modo })
    assert.deepEqual(rows.get(id(n)), { ...antes, home_oferta_mode: modo })
  }
  const concorrente = await criarPreviaOfertas(pedido(2, 'fila'), gateway)
  rows.set(id(2), { ...rows.get(id(2)), home_oferta_mode: 'fixada' })
  assert.equal((await confirmarPreviaOfertas(concorrente, gateway)).conflitos, 1)
  assert.equal(rows.get(id(2)).home_oferta_mode, 'fixada')
  for (let n = 1; n <= 15; n++) rows.set(id(n), { ...rows.get(id(n)), home_oferta_mode: 'fixada' })
  const limite = await criarPreviaOfertas(pedido(1, 'fixada'), gateway)
  assert.match(limite.avisos[0], /15 ofertas fixadas.*12 vagas/)
  assert.equal(rows.size, 15)
  assert.throws(() => validarPedidoOfertas({ modo: 'HOME', itens: [{ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(1), homeOfertaMode: 'fila', ativo: false } }] }))
  const semSchema = rows.get(id(1)); delete semSchema.home_oferta_mode
  await assert.rejects(() => criarPreviaOfertas(pedido(1, 'fixada'), gateway), /migração 004/)
})

test('limpeza descobre apenas expiradas e desmarca oferta sem alterar produto; extensão concorrente impede escrita', async () => {
  const agora = Date.parse('2026-10-16T12:00:00Z')
  const { gateway, rows, escritas } = fake(6, {
    1: { oferta_relampago: true, oferta_fim: '2026-10-16T11:00:00Z' },
    2: { oferta_relampago: true, oferta_fim: '2026-10-15T12:00:00Z', home_oferta_mode: 'fixada' },
    3: { oferta_relampago: true, oferta_fim: '2026-10-17T12:00:00Z' },
    4: { oferta_relampago: true, oferta_fim: null },
    5: { oferta_relampago: false, oferta_fim: '2000-01-01T00:00:00Z' },
    6: { oferta_relampago: true, oferta_fim: '2026-10-16T12:00:00Z' },
  })
  const antes = clone(rows.get(id(1)))
  const previa = await criarPreviaLimpezaExpiradas(gateway, agora)
  assert.equal(previa.modo, 'LIMPAR_EXPIRADAS')
  assert.deepEqual(previa.operacoes.map((p) => p.itemId), [id(1), id(2), id(6)])
  assert.equal(escritas.length, 0)
  rows.set(id(2), { ...rows.get(id(2)), oferta_fim: '2099-01-01T00:00:00Z' })
  const resultado = await confirmarPreviaOfertas(previa, gateway, new Date(agora))
  assert.equal(resultado.desativadas, 2)
  assert.equal(resultado.conflitos, 1)
  assert.deepEqual(escritas[0].alteracao, { oferta_relampago: false })
  assert.deepEqual(rows.get(id(1)), { ...antes, oferta_relampago: false })
  assert.equal(rows.get(id(2)).oferta_relampago, true)
  assert.equal(rows.size, 6)
  await assert.rejects(() => criarPreviaLimpezaExpiradas(gateway, agora), /Nenhuma oferta expirada/)
})

test('schema home_oferta_mode tem default auto, enum restrito e migração idempotente sem mexer nos produtos', async () => {
  const db = new PGlite()
  try {
    await db.exec("CREATE TABLE public.produtos (id integer primary key, ativo boolean, categoria text, titulo text, link_afiliado text, preco numeric, oferta_relampago boolean); INSERT INTO public.produtos VALUES (1,true,'Casa','Gemini','https://meli.la/preservar',50,true);")
    const sql = await readFile(new URL('../migrations/004_valio_home_oferta_mode.sql', import.meta.url), 'utf8')
    await db.exec(sql); await db.exec(sql)
    const { rows: produtos } = await db.query('SELECT * FROM public.produtos')
    assert.deepEqual(produtos[0], { id: 1, ativo: true, categoria: 'Casa', titulo: 'Gemini', link_afiliado: 'https://meli.la/preservar', preco: '50', oferta_relampago: true, home_oferta_mode: 'auto' })
    await assert.rejects(() => db.exec("UPDATE public.produtos SET home_oferta_mode='negativa' WHERE id=1"))
    await assert.rejects(() => db.exec('UPDATE public.produtos SET home_oferta_mode=NULL WHERE id=1'))
  } finally { await db.close() }
})

test('banco sem a migração mantém leitura legada, informa controle indisponível e não inventa suporte ao modo Home', async () => {
  const fetchAnterior = globalThis.fetch
  const consultas = []
  try {
    globalThis.fetch = async (endereco) => {
      const url = new URL(String(endereco)); consultas.push(url)
      const home = url.searchParams.get('select').includes('home_oferta_mode')
      const produto = row(1, { oferta_relampago: true }); delete produto.home_oferta_mode
      return new Response(JSON.stringify(home ? { code: '42703', message: 'column produtos.home_oferta_mode does not exist' } : [produto]),
        { status: home ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
    }
    const gateway = criarOfertasGateway({ url: 'https://teste.supabase.co', serviceRoleKey: 'falsa' })
    assert.equal((await gateway.listarAtivas()).length, 1)
    assert.equal(consultas.length, 2)
    await assert.rejects(() => criarPreviaOfertas({ modo: 'HOME', itens: [{ tipo: 'ATUALIZAR_OFERTA', dados: { mercadoLivreId: id(1), homeOfertaMode: 'fila' } }] }, gateway), /migração 004/)
  } finally { globalThis.fetch = fetchAnterior }
})
