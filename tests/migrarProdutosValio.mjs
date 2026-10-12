import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { arquivoCatalogo, executarMigracao, lerCatalogoTexto, planejarMigracao } from '../scripts/migrarProdutosValio.mjs'

const produto = (id, marketplaceId, outros = {}) => ({
  id, marketplaceId, name: `Produto ${id}`, shortDescription: '',
  price: 64.9, priceReferenceDate: '10/10/2026',
  affiliateUrl: `https://mercadolivre.com.br/${id}?extra_comm=true#sid=affiliates`,
  category: 'Achados para Elas', rating: 4.6, image: `https://imagem.com/${id}.webp`, ...outros,
})
const serializar = (produtos) => `export const products = ${JSON.stringify(produtos, null, 2)}\n`

test('backup legado tem 56 produtos e seis ITEM_IDs; catálogo ativo continua vazio e ambos são preservados', async () => {
  assert.equal(path.basename(arquivoCatalogo), 'products-legacy-backup.ts')
  const arquivoAtivo = path.join(path.dirname(arquivoCatalogo), 'products.ts')
  const ativoAntes = await fs.readFile(arquivoAtivo, 'utf8')
  assert.deepEqual(lerCatalogoTexto(ativoAntes), [])
  const antes = await fs.readFile(arquivoCatalogo, 'utf8')
  const produtos = lerCatalogoTexto(antes)
  assert.equal(produtos.length, 56)
  assert.equal(produtos.filter((p) => p.marketplaceId).length, 6)
  assert.equal(produtos.find((p) => p.id === 22).marketplaceId, undefined)
  assert.equal(produtos.find((p) => p.id === 56).marketplaceId, 'MLB6718143858')
  assert.equal(await fs.readFile(arquivoCatalogo, 'utf8'), antes)
  assert.equal(await fs.readFile(arquivoAtivo, 'utf8'), ativoAntes)
})

test('planejamento separa migráveis, existentes, sem ID, inválidos e duplicados sem usar preço para existência', () => {
  const produtos = [produto(1, 'MLB1'), produto(2, null), produto(3, 'MLB3', { price: 999 }),
    produto(4, 'MLB4', { image: undefined }), produto(5, 'MLB1')]
  const { relatorio, linhas } = planejarMigracao(produtos, ['MLB3'])
  assert.deepEqual([relatorio.total, relatorio.migraveis, relatorio.jaExistentes, relatorio.semItemId, relatorio.invalidos], [5, 1, 1, 1, 2])
  assert.deepEqual(relatorio.produtos.map((p) => p.status), ['migravel', 'semItemId', 'jaExistente', 'invalido', 'invalido'])
  assert.deepEqual(linhas.map((p) => p.mercado_livre_id), ['MLB1'])
  assert.equal(linhas[0].preco, 64.9)
  assert.equal(linhas[0].link_afiliado, produtos[0].affiliateUrl)
  assert.equal(linhas[0].ativo, true)
  assert.equal(relatorio.produtos[0].dadosMigracao.link_afiliado, produtos[0].affiliateUrl)
})

test('dry-run gera relatório sem escrita, migração explícita é idempotente e não muda a origem', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'valio-migracao-'))
  const origem = path.join(pasta, 'products.ts')
  const destino = path.join(pasta, 'relatorio.json')
  const destinoMarkdown = path.join(pasta, 'relatorio.md')
  const fonte = serializar([produto(1, 'MLB1'), produto(2, 'MLB2'), produto(3, null)])
  await fs.writeFile(origem, fonte)
  const banco = new Map([['MLB2', { preco: 12 }]])
  let escritas = 0
  const gateway = {
    async buscarExistentes(ids) { return ids.filter((id) => banco.has(id)) },
    async inserirSemAtualizar(linhas) {
      escritas++
      for (const linha of linhas) if (!banco.has(linha.mercado_livre_id)) banco.set(linha.mercado_livre_id, linha)
    },
  }
  try {
    const dry = await executarMigracao({ origem, destino, gateway })
    assert.deepEqual([dry.migraveis, dry.jaExistentes, dry.semItemId], [1, 1, 1])
    assert.equal(escritas, 0)
    assert.equal(banco.size, 1)
    const textoRelatorio = await fs.readFile(destino, 'utf8')
    assert.deepEqual(JSON.parse(textoRelatorio).produtos.map((p) => p.status), ['migravel', 'jaExistente', 'semItemId'])
    assert.equal(textoRelatorio.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
    assert.equal(textoRelatorio.includes('VALIO_PUBLISH_TOKEN'), false)
    const markdown = await fs.readFile(destinoMarkdown, 'utf8')
    assert.match(markdown, /## Produtos antigos sem ITEM_ID/)
    assert.match(markdown, /Produto 3/)
    assert.equal(markdown.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
    await executarMigracao({ origem, destino, gateway, executar: true })
    assert.equal(escritas, 1)
    assert.equal(banco.size, 2)
    assert.equal(banco.get('MLB2').preco, 12)
    await executarMigracao({ origem, destino, gateway, executar: true })
    assert.equal(escritas, 1)
    assert.equal(banco.size, 2)
    assert.equal(await fs.readFile(origem, 'utf8'), fonte)
  } finally {
    await fs.unlink(origem)
    await fs.unlink(destino)
    await fs.unlink(destinoMarkdown)
    await fs.rmdir(pasta)
  }
})
