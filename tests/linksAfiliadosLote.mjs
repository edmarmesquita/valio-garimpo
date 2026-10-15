import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
after(async () => vite.close())

const token = 'token-local-de-teste-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
const id = (n) => `MLB${8000000000 + n}`
const link = (n) => `https://meli.la/${100000 + n}`
const produto = (n) => ({ mercado_livre_id: id(n), titulo: `Produto ${n}`, link_afiliado: `https://mercadolivre.com.br/produto-${n}`,
  preco: 26.72, imagem: `https://imagem.com/${n}.webp`, categoria: 'Achados para Maridos', ativo: true,
  data_preco: '14/10/2026', updated_at: '2026-10-14T12:00:00Z' })

async function servidor(executar) {
  const linhas = new Map(Array.from({ length: 50 }, (_, i) => [id(i + 1), produto(i + 1)]))
  const escritas = []
  const gateway = {
    async buscar(mercadoLivreId) {
      const row = linhas.get(mercadoLivreId)
      return row ? [{ mercado_livre_id: row.mercado_livre_id, titulo: row.titulo, link_afiliado: row.link_afiliado }] : []
    },
    async atualizar(mercadoLivreId, anterior, novo) {
      const row = linhas.get(mercadoLivreId)
      if (!row || row.link_afiliado !== anterior) return []
      escritas.push({ mercadoLivreId, anterior, novo })
      linhas.set(mercadoLivreId, { ...row, link_afiliado: novo })
      return [{ mercado_livre_id: mercadoLivreId, link_afiliado: novo }]
    },
  }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token, linkAfiliado: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/valio/produtos/links-afiliados`
    const requisitar = async (rota, method, body, bearer = token) => {
      const response = await fetch(base + rota, { method,
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: response.status, data: await response.json() }
    }
    await executar({ linhas, escritas, requisitar })
  } finally { await new Promise((resolve) => server.close(resolve)) }
}

const confirmacoes = (previa) => previa.linhas.filter((linha) => !linha.motivo)
  .map((linha) => ({ linha: linha.linha, mercado_livre_id: linha.mercado_livre_id, link_anterior: linha.link_anterior }))

test('prévia de 20 válidos não grava; confirmação altera só link_afiliado', async () => {
  await servidor(async ({ linhas, escritas, requisitar }) => {
    const texto = Array.from({ length: 20 }, (_, i) => `${id(i + 1)} | ${link(i + 1)}`).join('\n')
    const antes = new Map([...linhas].map(([key, value]) => [key, { ...value }]))
    const previa = await requisitar('/previa', 'POST', { texto })
    assert.equal(previa.status, 200)
    assert.equal(previa.data.solicitadas, 20)
    assert.equal(previa.data.linhas.filter((linha) => !linha.motivo).length, 20)
    assert.deepEqual(linhas, antes)
    assert.equal(escritas.length, 0)
    const resultado = await requisitar('', 'PATCH', { texto, confirmacoes: confirmacoes(previa.data) })
    assert.equal(resultado.status, 200)
    assert.deepEqual([resultado.data.solicitadas, resultado.data.atualizadas, resultado.data.erros], [20, 20, 0])
    assert.deepEqual(resultado.data.idsAtualizados, Array.from({ length: 20 }, (_, i) => id(i + 1)))
    assert.equal(escritas.length, 20)
    for (let i = 1; i <= 20; i++) assert.deepEqual(linhas.get(id(i)), { ...antes.get(id(i)), link_afiliado: link(i) })
  })
})

test('lote identifica inexistente, URL comum, duplicatas e linha inválida sem criá-los', async () => {
  await servidor(async ({ linhas, escritas, requisitar }) => {
    const social = 'https://www.mercadolivre.com.br/social/ee20260414070618?matt_word=valiosite&matt_tool=20840303&ref=a%2Fb'
    const texto = [
      `${id(1)} | ${link(1)}`,
      `${id(2)} | ${social}`,
      `MLB9999999999 | ${link(3)}`,
      `${id(3)} | https://www.mercadolivre.com.br/produto/p/MLB123?extra_comm=true#sid=affiliates`,
      `${id(4)} | ${link(4)}`,
      `${id(4)} | ${link(5)}`,
      `MLB-INVALIDO | ${link(6)}`,
    ].join('\n')
    const antes = new Map([...linhas].map(([key, value]) => [key, { ...value }]))
    const previa = await requisitar('/previa', 'POST', { texto })
    assert.equal(previa.status, 200)
    assert.equal(previa.data.solicitadas, 7)
    assert.deepEqual(previa.data.linhas.map((linha) => linha.motivo === null), [true, true, false, false, false, false, false])
    assert.match(previa.data.linhas[2].motivo, /não encontrado/i)
    assert.match(previa.data.linhas[3].motivo, /Link inválido/i)
    assert.match(previa.data.linhas[4].motivo, /duplicado/i)
    assert.match(previa.data.linhas[5].motivo, /duplicado/i)
    assert.match(previa.data.linhas[6].motivo, /ITEM_ID inválido/i)
    assert.equal(escritas.length, 0)
    const resultado = await requisitar('', 'PATCH', { texto, confirmacoes: confirmacoes(previa.data) })
    assert.equal(resultado.status, 200)
    assert.deepEqual([resultado.data.solicitadas, resultado.data.atualizadas, resultado.data.erros], [7, 2, 5])
    assert.deepEqual(resultado.data.idsAtualizados, [id(1), id(2)])
    assert.equal(resultado.data.falhas.length, 5)
    assert.equal(linhas.has('MLB9999999999'), false)
    assert.deepEqual(linhas.get(id(1)), { ...antes.get(id(1)), link_afiliado: link(1) })
    assert.deepEqual(linhas.get(id(2)), { ...antes.get(id(2)), link_afiliado: social })
    assert.deepEqual(linhas.get(id(3)), antes.get(id(3)))
    assert.deepEqual(linhas.get(id(4)), antes.get(id(4)))
    assert.equal(escritas.length, 2)
  })
})

for (const quantidade of [30, 50]) test(`prévia e confirmação aceitam ${quantidade} linhas com rechecagem`, async () => {
  await servidor(async ({ linhas, escritas, requisitar }) => {
    const texto = Array.from({ length: quantidade }, (_, i) => `${id(i + 1)} | ${link(i + 1)}`).join('\n')
    const antes = new Map([...linhas].map(([key, value]) => [key, { ...value }]))
    const previa = await requisitar('/previa', 'POST', { texto })
    assert.equal(previa.status, 200)
    assert.equal(previa.data.solicitadas, quantidade)
    assert.equal(previa.data.linhas.filter((linha) => !linha.motivo).length, quantidade)
    assert.equal(escritas.length, 0)
    assert.deepEqual(linhas, antes)
    const resultado = await requisitar('', 'PATCH', { texto, confirmacoes: confirmacoes(previa.data) })
    assert.equal(resultado.status, 200)
    assert.deepEqual([resultado.data.solicitadas, resultado.data.atualizadas, resultado.data.erros], [quantidade, quantidade, 0])
    assert.equal(escritas.length, quantidade)
    for (let i = 1; i <= quantidade; i++) assert.deepEqual(linhas.get(id(i)), { ...antes.get(id(i)), link_afiliado: link(i) })
  })
})

test('51 linhas são bloqueadas na prévia e na confirmação sem nenhuma escrita', async () => {
  await servidor(async ({ linhas, escritas, requisitar }) => {
    const texto = Array.from({ length: 51 }, (_, i) => `${id(i + 1)} | ${link(i + 1)}`).join('\n')
    const antes = new Map([...linhas].map(([key, value]) => [key, { ...value }]))
    const previa = await requisitar('/previa', 'POST', { texto })
    assert.equal(previa.status, 400)
    assert.equal(previa.data.erro, 'O lote aceita no máximo 50 linhas. Nenhum link foi alterado.')
    const confirmacao = await requisitar('', 'PATCH', { texto, confirmacoes: [] })
    assert.equal(confirmacao.status, 400)
    assert.equal(confirmacao.data.erro, 'O lote aceita no máximo 50 linhas. Nenhum link foi alterado.')
    assert.equal(escritas.length, 0)
    assert.deepEqual(linhas, antes)
  })
})

test('mais de 50 confirmações e token inválido impedem atualização', async () => {
  await servidor(async ({ escritas, requisitar }) => {
    const texto = Array.from({ length: 50 }, (_, i) => `${id(i + 1)} | ${link(i + 1)}`).join('\n')
    const confirmacoesExcedentes = Array.from({ length: 51 }, (_, i) => ({ linha: i + 1,
      mercado_livre_id: id(i + 1), link_anterior: `https://mercadolivre.com.br/produto-${i + 1}` }))
    const excedente = await requisitar('', 'PATCH', { texto, confirmacoes: confirmacoesExcedentes })
    assert.equal(excedente.status, 400)
    assert.equal(excedente.data.erro, 'Confirmações inválidas.')
    assert.equal((await requisitar('/previa', 'POST', { texto: `${id(1)} | ${link(1)}` }, 'token-errado')).status, 401)
    assert.equal(escritas.length, 0)
  })
})

test('confirmação rejeita linha sem prévia e link alterado desde a prévia', async () => {
  await servidor(async ({ linhas, escritas, requisitar }) => {
    const texto = `${id(1)} | ${link(1)}`
    const previa = (await requisitar('/previa', 'POST', { texto })).data
    assert.equal((await requisitar('', 'PATCH', { texto, confirmacoes: [] })).data.erros, 1)
    linhas.set(id(1), { ...linhas.get(id(1)), link_afiliado: 'https://meli.la/OUTRO' })
    const resultado = await requisitar('', 'PATCH', { texto, confirmacoes: confirmacoes(previa) })
    assert.equal(resultado.data.atualizadas, 0)
    assert.match(resultado.data.falhas[0].motivo, /mudou desde a prévia/i)
    assert.equal(escritas.length, 0)
  })
})
