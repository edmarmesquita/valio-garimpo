import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { enviarSelecionadosValio, selecionadosPublicaveis } = await vite.ssrLoadModule('/src/lib/publicarProdutosValio.ts')
after(async () => vite.close())

const produto = (id, alteracoes = {}) => ({
  itemId: id, titulo: `Produto ${id}`, precoAtual: 20,
  linkOriginal: `https://www.mercadolivre.com.br/${id}?extra_comm=true#sid=affiliates`,
  imagemUrl: 'https://http2.mlstatic.com/imagem.webp', avaliacao: 4.8,
  ...alteracoes,
})

test('frontend envia somente selecionados válidos com link original e categoria', async () => {
  const produtos = [produto('MLB1'), produto('MLB2', { imagemUrl: null }), produto('MLB3')]
  const selecionados = new Set([0, 2])
  const categorias = new Map([[0, 'Achados para Casa'], [2, 'Achados para Elas']])
  const chamadas = []
  const enviar = async (url, options) => {
    chamadas.push({ url, options, corpo: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ ok: true, acao: chamadas.length === 1 ? 'criado' : 'atualizado' }) }
  }
  assert.equal(selecionadosPublicaveis(produtos, selecionados, categorias), true)
  const resumo = await enviarSelecionadosValio(produtos, selecionados, categorias, 'token-local', enviar)
  assert.deepEqual(resumo, { enviados: 2, criados: 1, atualizados: 1, erros: [] })
  assert.deepEqual(chamadas.map((chamada) => chamada.corpo.mercadoLivreId), ['MLB1', 'MLB3'])
  assert.deepEqual(chamadas.map((chamada) => chamada.corpo.categoria), ['Achados para Casa', 'Achados para Elas'])
  assert.equal(chamadas[0].corpo.linkAfiliado, produtos[0].linkOriginal)
  assert.match(chamadas[0].corpo.dataPreco, /^\d{2}\/\d{2}\/\d{4}$/)
  assert.equal(chamadas[0].url, '/api/valio/produtos')
  assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-local')
  assert.equal('serviceRoleKey' in chamadas[0].corpo, false)
  assert.equal(selecionadosPublicaveis(produtos, new Set([1]), new Map([[1, 'Achados para Casa']])), false)
})

test('resumo mantém erros parciais identificados por produto', async () => {
  const produtos = [produto('MLB1'), produto('MLB2'), produto('MLB3')]
  const categorias = new Map([[0, 'Achados para Casa'], [1, 'Achados para Elas'], [2, 'Achados para Presentear']])
  let numero = 0
  const enviar = async () => {
    numero++
    if (numero === 2) return { ok: false, json: async () => ({ ok: false, erro: 'Falha simulada' }) }
    return { ok: true, json: async () => ({ ok: true, acao: numero === 1 ? 'criado' : 'atualizado' }) }
  }
  const resumo = await enviarSelecionadosValio(produtos, new Set([0, 1, 2]), categorias, 'token-local', enviar)
  assert.equal(resumo.enviados, 2)
  assert.equal(resumo.criados, 1)
  assert.equal(resumo.atualizados, 1)
  assert.deepEqual(resumo.erros, [{ id: 'MLB2', titulo: 'Produto MLB2', motivo: 'Falha simulada' }])
})

test('informa falha de conexão sem exibir Failed to fetch', async () => {
  const resumo = await enviarSelecionadosValio([produto('MLB1')], new Set([0]),
    new Map([[0, 'Achados para Elas']]), 'token-local', async () => { throw new TypeError('Failed to fetch') })
  assert.equal(resumo.enviados, 0)
  assert.match(resumo.erros[0].motivo, /API local.*porta 3001/)
  assert.doesNotMatch(resumo.erros[0].motivo, /Failed to fetch/)
})

test('distingue resposta sem JSON de erro HTTP em JSON', async () => {
  const produtos = [produto('MLB1'), produto('MLB2')]
  let numero = 0
  const enviar = async () => {
    numero++
    return numero === 1
      ? { ok: false, status: 502, json: async () => { throw new SyntaxError('HTML recebido') } }
      : { ok: false, status: 503, json: async () => ({ ok: false, erro: 'Publicação não configurada.' }) }
  }
  const resumo = await enviarSelecionadosValio(produtos, new Set([0, 1]),
    new Map([[0, 'Achados para Elas'], [1, 'Achados para Casa']]), 'token-local', enviar)
  assert.match(resumo.erros[0].motivo, /HTTP 502.*JSON válido/)
  assert.equal(resumo.erros[1].motivo, 'Publicação não configurada.')
})
