import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { ErroDestinoAfiliado } = await vite.ssrLoadModule('/server/validarDestinoAfiliado.ts')
test.after(async () => vite.close())

const token = 'token-local-de-teste-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
const base = () => ({ id: 774, mercado_livre_id: 'MLB1001', ativo: false, titulo: 'Produto antigo',
  descricao: 'Descrição antiga', preco: 100, categoria: 'Achados para Casa', link_afiliado: 'https://meli.la/old', imagem: 'https://http2.mlstatic.com/old.webp' })
const pedido = (altera = {}) => ({ confirmar: true, id_interno: 774, item_id_anterior: 'MLB1001',
  mercado_livre_id: 'MLB2002', titulo: 'Produto novo', descricao: '', preco: 80, moeda: 'BRL',
  imagem: 'https://http2.mlstatic.com/new.webp', link_afiliado: 'https://meli.la/new', categoria: 'Achados para Elas', ...altera })

async function harness({ registro = base(), validarDestino = async () => {}, existeOutro = async () => false,
  substituir = null, agora = new Date('2026-10-29T12:00:00.000Z') } = {}) {
  let salvo = { ...registro }; const tentativas = []; let insercoes = 0
  const gateway = {
    async buscarPorId(id) { return salvo?.id === id ? { ...salvo } : null },
    async existeOutro(id, interno) { return existeOutro(id, interno) },
    async substituir(dados) {
      tentativas.push({ ...dados })
      if (substituir) return substituir(dados, salvo, (valor) => { salvo = valor })
      if (!salvo || salvo.id !== dados.id || salvo.mercado_livre_id !== dados.itemIdAnterior || salvo.ativo) return false
      salvo = { ...salvo, mercado_livre_id: dados.itemIdNovo, titulo: dados.titulo, descricao: dados.descricao,
        preco: dados.preco, link_afiliado: dados.linkAfiliado, imagem: dados.imagem, categoria: dados.categoria,
        ativo: true, updated_at: dados.updatedAt }
      return true
    },
    insert() { insercoes++ },
  }
  const app = express(); app.use(express.json())
  app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token,
    agora: () => agora, validarDestino: async (id, link, origem) => {
      await validarDestino(id, link, origem)
    }, substituicao: () => gateway }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve))
  const chamar = async (dados = pedido()) => {
    const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/valio/produtos/substituir-inativo`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    })
    return { status: resposta.status, corpo: await resposta.json() }
  }
  return { chamar, get salvo() { return salvo }, tentativas, get insercoes() { return insercoes }, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('substituição válida reativa o mesmo registro interno', async () => {
  const h = await harness()
  try {
    const r = await h.chamar()
    assert.equal(r.status, 200); assert.equal(r.corpo.id_interno, 774); assert.equal(h.salvo.id, 774)
    assert.equal(h.salvo.ativo, true); assert.equal(h.salvo.mercado_livre_id, 'MLB2002')
  } finally { await h.close() }
})

test('atualiza título e imagem do candidato, não mantém os valores antigos', async () => {
  const h = await harness()
  try { await h.chamar(); assert.equal(h.salvo.titulo, 'Produto novo'); assert.equal(h.salvo.imagem, 'https://http2.mlstatic.com/new.webp') }
  finally { await h.close() }
})

test('atualiza o preço para o valor BRL validado', async () => {
  const h = await harness()
  try { await h.chamar(); assert.equal(h.salvo.preco, 80) }
  finally { await h.close() }
})

test('data_preco segue a data local de São Paulo, inclusive perto da virada UTC', async () => {
  const h = await harness({ agora: new Date('2026-10-29T02:30:00.000Z') })
  try { await h.chamar(); assert.equal(h.tentativas[0].dataPreco, '28/10/2026') }
  finally { await h.close() }
})

test('valida o link afiliado contra o ITEM_ID novo antes de gravar', async () => {
  let recebido
  const h = await harness({ validarDestino: async (...args) => { recebido = args } })
  try { await h.chamar(); assert.deepEqual(recebido, ['MLB2002', 'https://meli.la/new', 'recuperacao-inativos:substituicao']) }
  finally { await h.close() }
})

test('muda o ITEM_ID no mesmo registro', async () => {
  const h = await harness()
  try { await h.chamar(); assert.equal(h.salvo.mercado_livre_id, 'MLB2002'); assert.equal(h.salvo.id, 774) }
  finally { await h.close() }
})

test('ITEM_ID novo já existente bloqueia a substituição', async () => {
  const h = await harness({ existeOutro: async () => true })
  try { const r = await h.chamar(); assert.equal(r.status, 409); assert.match(r.corpo.erro, /já existe/); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('destino afiliado incompatível bloqueia a escrita', async () => {
  const h = await harness({ validarDestino: async () => { throw new ErroDestinoAfiliado('ITEM_ID divergente') } })
  try { const r = await h.chamar(); assert.equal(r.status, 422); assert.equal(h.tentativas.length, 0); assert.equal(h.salvo.ativo, false) }
  finally { await h.close() }
})

test('link afiliado ausente não conclui substituição', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ link_afiliado: '' })); assert.equal(r.status, 400); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('link que não é meli.la é rejeitado mesmo se for HTTPS', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ link_afiliado: 'https://mercadolivre.com.br/anuncio' })); assert.equal(r.status, 400); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('imagem externa fora do CDN de imagens do Mercado Livre é rejeitada', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ imagem: 'https://img.example/new.webp' })); assert.equal(r.status, 400); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('produto antigo que já está ativo bloqueia a substituição', async () => {
  const h = await harness({ registro: { ...base(), ativo: true } })
  try { const r = await h.chamar(); assert.equal(r.status, 409); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('ITEM_ID antigo alterado desde a prévia bloqueia a substituição', async () => {
  const h = await harness({ registro: { ...base(), mercado_livre_id: 'MLB3003' } })
  try { const r = await h.chamar(); assert.equal(r.status, 409); assert.match(r.corpo.erro, /mudou desde a prévia/); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('preço inválido bloqueia a substituição', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ preco: 0 })); assert.equal(r.status, 400); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('ausência de confirmação explícita bloqueia a ação', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ confirmar: false })); assert.equal(r.status, 400); assert.equal(h.tentativas.length, 0) }
  finally { await h.close() }
})

test('não cria registro novo, usa somente a operação condicional substituir', async () => {
  const h = await harness()
  try { await h.chamar(); assert.equal(h.insercoes, 0); assert.equal(h.salvo.id, 774); assert.equal(h.tentativas.length, 1) }
  finally { await h.close() }
})

test('categoria é preservada quando omitida e pode ser escolhida explicitamente', async () => {
  const h = await harness()
  try { const r = await h.chamar(pedido({ categoria: undefined })); assert.equal(r.status, 200); assert.equal(h.salvo.categoria, 'Achados para Casa') }
  finally { await h.close() }
})

test('conflito na atualização condicional retorna 409 sem sobrescrever registro concorrente', async () => {
  const h = await harness({ substituir: async () => false })
  try { const r = await h.chamar(); assert.equal(r.status, 409); assert.equal(h.salvo.ativo, false); assert.equal(h.salvo.mercado_livre_id, 'MLB1001') }
  finally { await h.close() }
})
