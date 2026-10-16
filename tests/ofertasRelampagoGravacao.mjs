import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import express from 'express'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarPreviaOfertas, confirmarPreviaOfertas, validarPedidoOfertas, assinarPrevia, validarAssinatura } =
  await vite.ssrLoadModule('/server/ofertasRelampagoLote.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { mapearProdutoParaRow } = await vite.ssrLoadModule('/server/services/supabase.ts')
test.after(async () => vite.close())

const id = (n) => `MLB${1000 + n}`
const clone = (valor) => JSON.parse(JSON.stringify(valor))
const row = (n, extras = {}) => ({ mercado_livre_id: id(n), titulo: `Produto ${n}`, preco: 49.9,
  categoria: 'Achados para Casa', imagem: 'https://img.test/item.webp', link_afiliado: `https://meli.la/atual${n}`,
  ativo: true, oferta_relampago: false, oferta_inicio: null, oferta_fim: null, preco_anterior: null,
  percentual_desconto: null, texto_oferta: null, prioridade_oferta: 0, ...extras })
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
  const { escritas, gateway } = fake(1)
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
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
