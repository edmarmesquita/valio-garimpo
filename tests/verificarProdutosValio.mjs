import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { idsParaVerificar, verificarProdutosValio, compararProdutoComValio, separarSelecionados } =
  await vite.ssrLoadModule('/src/lib/verificarProdutosValio.ts')
after(async () => vite.close())

const produto = (id, alteracoes = {}) => ({ itemId: id, titulo: `Produto ${id}`,
  precoAtual: 49.9, linkOriginal: `https://mercadolivre.com.br/${id}`,
  imagemUrl: 'https://imagem.com/a', ...alteracoes })
const existente = { mercadoLivreId: 'MLB2', titulo: 'Produto MLB2', preco: 54.9,
  dataPreco: '11/10/2026', categoria: 'Achados para Casa',
  linkAfiliado: 'https://mercadolivre.com.br/MLB2', imagem: 'https://imagem.com/a', ativo: false }

test('verificação envia somente IDs válidos e únicos ao backend em uma chamada', async () => {
  const produtos = [produto('MLB1'), produto('MLB2'), produto('MLB2'), produto(''), produto('XYZ')]
  assert.deepEqual(idsParaVerificar(produtos), ['MLB1', 'MLB2'])
  const chamadas = []
  const enviar = async (url, options) => {
    chamadas.push({ url, options })
    return { ok: true, json: async () => ({ ok: true, existentes: [existente] }) }
  }
  const encontrados = await verificarProdutosValio(produtos, 'token-de-teste', enviar)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, '/api/valio/produtos/verificar')
  assert.deepEqual(JSON.parse(chamadas[0].options.body), { mercadoLivreIds: ['MLB1', 'MLB2'] })
  assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste')
  assert.equal(chamadas[0].options.body.includes('serviceRoleKey'), false)
  assert.equal(encontrados.get('MLB2').ativo, false)
})

test('comparação detecta preço alterado e produto sem mudanças relevantes', () => {
  const alterado = compararProdutoComValio(produto('MLB2'), 'Achados para Casa', existente)
  assert.deepEqual(alterado, { existe: true, precoAlterado: true, dadosAlterados: true })
  const igual = compararProdutoComValio(produto('MLB2', { precoAtual: 54.9 }), 'Achados para Casa', existente)
  assert.deepEqual(igual, { existe: true, precoAlterado: false, dadosAlterados: false })
  assert.equal(compararProdutoComValio(produto('MLB1'), 'Achados para Casa', undefined).existe, false)
})

test('preço diferente não altera existência determinada pelo ITEM_ID', () => {
  const salvo = { ...existente, mercadoLivreId: 'MLB6040257536', preco: 161.62 }
  const extraido = produto('MLB6040257536', { precoAtual: 197.1 })
  const mapa = new Map([[salvo.mercadoLivreId, salvo]])
  assert.deepEqual([...separarSelecionados([extraido], new Set([0]), mapa).cadastrados], [0])
  assert.deepEqual(compararProdutoComValio(extraido, 'Achados para Casa', salvo),
    { existe: true, precoAlterado: true, dadosAlterados: true })
})

test('separa novos e cadastrados, sem classificar ID ausente como novo', () => {
  const partes = separarSelecionados([produto('MLB1'), produto('MLB2'), produto('')],
    new Set([0, 1, 2]), new Map([['MLB2', existente]]))
  assert.deepEqual([...partes.novos], [0])
  assert.deepEqual([...partes.cadastrados], [1])
})

test('erro na consulta rejeita verificação sem transformar desconhecidos em novos', async () => {
  await assert.rejects(() => verificarProdutosValio([produto('MLB1')], 'token', async () => {
    throw new TypeError('Failed to fetch')
  }), /Não foi possível conectar/)
})
