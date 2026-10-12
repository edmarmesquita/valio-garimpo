import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const fila = await vite.ssrLoadModule('/src/lib/revisaoPrecosLote.ts')
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
after(async () => vite.close())
const salvo = (id, preco = 100, dataPreco = '01/10/2026') => ({ mercadoLivreId: id, titulo: `Produto ${id}`, preco, dataPreco,
  categoria: 'Achados para Elas', linkAfiliado: `https://mercadolivre.com.br/${id}?aff=original`,
  imagem: `https://imagem.com/${id}`, rating: 4.8, ativo: true, updatedAt: '2026-10-01T10:00:00Z' })
const extraido = (id, preco, outros = {}) => ({ itemId: id, titulo: `Produto ${id}`, precoAtual: preco,
  imagemUrl: `https://imagem.com/${id}`, linkOriginal: `https://mercadolivre.com.br/${id}?aff=original`, avaliacao: 4.8, ...outros })

test('acumula lotes, substitui duplicata pelo mais recente e cruza 300 itens só por ITEM_ID', () => {
  const catalogo = Array.from({ length: 300 }, (_, i) => salvo(`MLB${i + 1}`))
  let lotes = fila.adicionarLote(fila.lotesVazios(), [extraido('MLB1', 95), extraido('MLB2', 100)])
  lotes = fila.adicionarLote(lotes, [extraido('MLB1', 90), extraido('MLB301', 20, { titulo: 'Produto MLB2' }), extraido(null, 10)])
  assert.deepEqual([lotes.lotes, lotes.brutos, lotes.produtos.size, lotes.duplicados], [2, 5, 3, 1])
  assert.equal(lotes.produtos.get('MLB1').precoAtual, 90)
  const itens = fila.montarFila(catalogo, lotes, false, new Date(2026, 9, 12))
  assert.equal(itens.length, 300)
  assert.equal(itens.filter((item) => item.extraido).length, 2)
  assert.equal(itens[0].diferencaCentavos, -1000)
  assert.equal(itens[1].diferencaCentavos, 0)
  assert.equal(itens[2].extraido, undefined)
  assert.deepEqual([...fila.selecionarFila(itens, 'alterados')], ['MLB1'])
  assert.deepEqual([...fila.selecionarFila(itens, 'encontrados')], ['MLB1', 'MLB2'])
  assert.equal(fila.selecionarFila(itens, 'limpar').size, 0)
  assert.equal(fila.filtrarFila(itens, 'nao-encontrados', 'antigos').length, 298)
  assert.equal(fila.lotesVazios().produtos.size, 0)
})

test('separa diferença de preço de alterações de título, imagem, link e rating; filtra idade', () => {
  const catalogo = [salvo('MLB1'), salvo('MLB2', 100, '03/10/2026'), salvo('MLB3', 100, '08/10/2026')]
  const lote = fila.adicionarLote(fila.lotesVazios(), [extraido('MLB1', 100, { titulo: 'Outro', imagemUrl: 'https://nova', linkOriginal: 'https://novo', avaliacao: 4.5 }), extraido('MLB2', 120)])
  const itens = fila.montarFila(catalogo, lote, false, new Date(2026, 9, 12))
  assert.equal(itens.length, 2)
  assert.equal(itens[0].diferencaCentavos, 0)
  assert.deepEqual(itens[0].outrosCampos, ['título', 'imagem', 'link', 'rating'])
  assert.equal(itens[1].diferencaCentavos, 2000)
  assert.deepEqual(itens[1].outrosCampos, [])
  assert.equal(fila.filtrarFila(itens, 'preco-igual', 'categoria').length, 1)
  assert.equal(fila.filtrarFila(itens, 'preco-alterado', 'maior-aumento').length, 1)
  assert.equal(fila.filtrarFila(itens, 'outros-dados', 'antigos').length, 1)
  assert.equal(fila.filtrarFila(itens, 'revisar-breve', 'antigos').length, 2)
  assert.equal(fila.montarFila(catalogo, lote, true, new Date(2026, 9, 12)).length, 3)
})

test('cliente divide 120 produtos em 50/50/20 e preserva erros parciais e segredo fora da resposta', async () => {
  const entradas = Array.from({ length: 120 }, (_, i) => ({ mercadoLivreId: `MLB${i + 1}`, preco: 10, atualizarPreco: true }))
  const tamanhos = []
  let chamadas = 0
  const enviar = async (url, options) => {
    assert.equal(url, '/api/valio/produtos/precos-lote')
    assert.equal(options.headers.Authorization, 'Bearer token-de-teste')
    const bloco = JSON.parse(options.body).produtos
    tamanhos.push(bloco.length); chamadas++
    if (chamadas === 2) throw new TypeError('Failed to fetch')
    return { ok: true, json: async () => ({ ok: true, resultados: bloco.map((item) => ({ mercadoLivreId: item.mercadoLivreId, status: 'atualizado', dataPreco: '12/10/2026', updatedAt: '2026-10-12T12:00:00Z' })) }) }
  }
  const resultados = await fila.enviarPrecosEmBlocos(entradas, 'token-de-teste', enviar)
  assert.deepEqual(tamanhos, [50, 50, 20])
  assert.equal(resultados.length, 120)
  assert.equal(resultados.filter((item) => item.status === 'atualizado').length, 70)
  assert.equal(resultados.filter((item) => item.status === 'erro').length, 50)
  assert.equal(JSON.stringify(resultados).includes('token-de-teste'), false)
  assert.deepEqual(fila.dividirEmBlocos(entradas).map((bloco) => bloco.length), [50, 50, 20])
})

test('rota valida lote e só atualiza produto existente; confirmação conserva preço e demais campos', async () => {
  const token = 'token-de-publicacao-de-teste-com-mais-de-32-caracteres'
  const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-falsa-com-mais-de-32-caracteres' }
  const linhas = new Map([['MLB1', salvo('MLB1')], ['MLB2', salvo('MLB2')]])
  const escritas = []
  const gateway = { async atualizarPreco(id, preco, dataPreco, updatedAt, confirmar) {
    if (id === 'MLB4') throw new Error('Falha simulada do banco')
    const item = linhas.get(id)
    if (!item || confirmar && item.preco !== preco) return false
    escritas.push({ id, preco, dataPreco, updatedAt, confirmar })
    linhas.set(id, { ...item, preco: confirmar ? item.preco : preco, dataPreco, updatedAt })
    return true
  } }
  const app = express(); app.use(express.json()); app.use('/api/valio', criarRotaValioProdutos({ config: () => config, token: () => token,
    agora: () => new Date('2026-10-13T02:30:00Z'), catalogo: () => gateway }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/valio/produtos/precos-lote`
    const req = async (produtos, bearer = token) => {
      const resposta = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ produtos }) })
      return { status: resposta.status, json: await resposta.json() }
    }
    const entrada = (id, preco, atualizarPreco) => ({ mercadoLivreId: id, preco, atualizarPreco })
    assert.equal((await req([entrada('MLB1', 90, true)], 'errado')).status, 401)
    assert.equal((await req([entrada('MLB1', 90, true), entrada('MLB1', 90, true)])).status, 400)
    assert.equal((await req([entrada('MLB1', 90, true), entrada('INVALIDO', 90, true)])).status, 400)
    assert.equal((await req(Array.from({ length: 51 }, (_, i) => entrada(`MLB${i + 1}`, 90, true)))).status, 400)
    assert.equal(escritas.length, 0)
    const resposta = await req([entrada('MLB1', 90, true), entrada('MLB2', 100, false), entrada('MLB3', 30, true), entrada('MLB2', 50, false)].slice(0, 3))
    assert.equal(resposta.status, 200)
    assert.deepEqual([resposta.json.atualizados, resposta.json.confirmados, resposta.json.erros], [1, 1, 1])
    assert.equal(resposta.json.resultados[0].dataPreco, '12/10/2026')
    assert.equal(linhas.size, 2)
    assert.equal(linhas.get('MLB1').preco, 90)
    assert.equal(linhas.get('MLB2').preco, 100)
    assert.equal(linhas.get('MLB1').linkAfiliado, salvo('MLB1').linkAfiliado)
    assert.equal(linhas.get('MLB1').titulo, salvo('MLB1').titulo)
    assert.equal(linhas.get('MLB1').ativo, true)
    assert.equal(JSON.stringify(resposta.json).includes(config.serviceRoleKey), false)
    assert.equal(JSON.stringify(resposta.json).includes(token), false)
    assert.equal((await req([entrada('MLB2', 101, false)])).json.erros, 1)
    const parcial = await req([entrada('MLB1', 80, true), entrada('MLB4', 40, true)])
    assert.deepEqual([parcial.json.atualizados, parcial.json.erros], [1, 1])
    assert.equal(linhas.get('MLB1').preco, 80)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
