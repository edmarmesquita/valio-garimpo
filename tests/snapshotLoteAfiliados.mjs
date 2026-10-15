import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { CHAVE_SNAPSHOT_LOTE, criarRegistroSnapshot, identificacaoLote, lerRegistroSnapshot,
  salvarRegistroSnapshot, removerRegistroSnapshot, atualizarStatusSnapshot, validarRegistroSnapshot } =
  await vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts')
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
test.after(async () => vite.close())

const produto = (id, ordem, url = `https://www.mercadolivre.com.br/${id}`) => ({ itemId: id, ordem, titulo: `Produto ${id}`,
  urlNormalizada: url, productId: null, userProductId: null, pid: null, pidExtended: null,
  urlOriginal: url, urlParams: null, urlFragments: null })
const lista = (...produtos) => ({ encontrados: produtos.length, unicos: produtos.length, ignorados: 0, duplicados: 0,
  produtos, urlsParaGerador: produtos.flatMap((p) => p.urlNormalizada ? [p.urlNormalizada] : []).join('\n') })
const cinco = lista(...[1, 2, 3, 4, 5].map((n) => produto(`MLB${n}`, n)))
const copiar = (valor) => JSON.parse(JSON.stringify(valor))
const armazenamento = () => {
  const itens = new Map()
  return { getItem: (chave) => itens.get(chave) ?? null, setItem: (chave, valor) => { itens.set(chave, valor) },
    removeItem: (chave) => { itens.delete(chave) }, itens }
}

test('cria snapshot de cinco produtos com ordem e URL exatas', () => {
  const registro = criarRegistroSnapshot(cinco, 'https://www.mercadolivre.com.br/lista', new Date('2026-10-15T12:00:00Z'))
  assert.equal(registro.snapshot.quantidade, 5)
  assert.deepEqual(registro.snapshot.produtos.map((p) => [p.posicaoGerador, p.itemId]),
    [[1, 'MLB1'], [2, 'MLB2'], [3, 'MLB3'], [4, 'MLB4'], [5, 'MLB5']])
  assert.equal(registro.snapshot.urlsParaGerador, cinco.urlsParaGerador)
  assert.equal(registro.snapshot.origemLista, 'https://www.mercadolivre.com.br/lista')
})
test('somente produtos cujas URLs foram enviadas ocupam posição no Gerador', () => {
  const registro = criarRegistroSnapshot(lista(produto('MLB1', 1), produto('MLB2', 2, null), produto('MLB3', 3)))
  assert.deepEqual(registro.snapshot.produtos.map((p) => [p.posicaoGerador, p.ordem, p.itemId]), [[1, 1, 'MLB1'], [2, 3, 'MLB3']])
})
test('identificação é determinística por posição, ITEM_ID e URL', () => {
  const original = criarRegistroSnapshot(cinco)
  assert.equal(original.snapshot.identificacao, identificacaoLote(original.snapshot.produtos))
  assert.notEqual(original.snapshot.identificacao, criarRegistroSnapshot(lista(...[...cinco.produtos].reverse().map((p, indice) => ({ ...p, ordem: indice + 1 })))).snapshot.identificacao)
})
test('persiste e restaura após reinício simulado sem HTML original', () => {
  const local = armazenamento()
  const registro = salvarRegistroSnapshot(local, criarRegistroSnapshot(cinco))
  const restaurado = lerRegistroSnapshot(local)
  assert.equal(restaurado.invalido, false)
  assert.deepEqual(restaurado.registro, registro)
  assert.equal(local.itens.size, 1)
})
test('snapshot é congelado e lista atual diferente não o altera', () => {
  const registro = criarRegistroSnapshot(cinco)
  assert.equal(Object.isFrozen(registro.snapshot.produtos[0]), true)
  const outra = lista(produto('MLB999', 1))
  assert.equal(outra.produtos[0].itemId, 'MLB999')
  assert.equal(registro.snapshot.produtos[0].itemId, 'MLB1')
})
test('retorno usa snapshot e não lista substituta', () => {
  const registro = criarRegistroSnapshot(cinco)
  const retorno = processarRetornoGerador(registro.snapshot.produtos, 'https://meli.la/a\nhttps://meli.la/b\nhttps://meli.la/c\nhttps://meli.la/d\nhttps://meli.la/e')
  assert.deepEqual(retorno.pareamentos.map((p) => p.produto.itemId), cinco.produtos.map((p) => p.itemId))
})
test('JSON corrompido é recusado e pode ser descartado', () => {
  const local = armazenamento(); local.setItem(CHAVE_SNAPSHOT_LOTE, '{invalido')
  assert.deepEqual(lerRegistroSnapshot(local), { registro: null, invalido: true })
  removerRegistroSnapshot(local)
  assert.deepEqual(lerRegistroSnapshot(local), { registro: null, invalido: false })
})
test('schema, quantidade e identificação inconsistentes são recusados', () => {
  const base = criarRegistroSnapshot(cinco)
  for (const alterar of [
    (r) => { r.schemaVersion = 2 },
    (r) => { r.snapshot.quantidade = 4 },
    (r) => { r.snapshot.identificacao = 'ERRADO' },
  ]) { const invalido = copiar(base); alterar(invalido); assert.equal(validarRegistroSnapshot(invalido), false) }
})
test('ITEM_ID duplicado, ordem alterada e URL inválida são recusados', () => {
  const base = criarRegistroSnapshot(cinco)
  for (const alterar of [
    (r) => { r.snapshot.produtos[1].itemId = 'MLB1' },
    (r) => { r.snapshot.produtos[1].posicaoGerador = 1 },
    (r) => { r.snapshot.produtos[1].urlNormalizada = 'http://outro.example/produto' },
  ]) { const invalido = copiar(base); alterar(invalido); assert.equal(validarRegistroSnapshot(invalido), false) }
})
test('cópia usa URLs congeladas mesmo após mudança na lista atual', () => {
  const atual = lista(produto('MLB1', 1), produto('MLB2', 2))
  const registro = criarRegistroSnapshot(atual)
  atual.produtos[0].urlNormalizada = 'https://www.mercadolivre.com.br/alterado'
  assert.equal(registro.snapshot.urlsParaGerador.split('\n')[0], 'https://www.mercadolivre.com.br/MLB1')
})
test('retorno misto preserva avisos nas posições e ignora campo vazio', () => {
  const registro = criarRegistroSnapshot(lista(produto('MLB1', 1), produto('MLB2', 2), produto('MLB3', 3)))
  const retorno = processarRetornoGerador(registro.snapshot.produtos,
    '⚠️ O campo está vazio. Insira o URL que você quer divulgar.\nhttps://meli.la/a\nEste produto não cumpre com os requisitos do Programa.\nEste URL corresponde a um produto pausado.')
  assert.deepEqual(retorno.pareamentos.map((p) => p.retorno.tipo), ['LINK', 'RECUSADO', 'PAUSADO'])
  assert.equal(retorno.consistente, true)
})
test('quantidade inconsistente bloqueia bloco e não finaliza', () => {
  const registro = criarRegistroSnapshot(cinco)
  const processado = atualizarStatusSnapshot(registro, { status: 'RETORNO PROCESSADO', retornoTexto: 'https://meli.la/a' })
  assert.equal(processado.status, 'RETORNO PROCESSADO')
  assert.equal(processarRetornoGerador(processado.snapshot.produtos, processado.retornoTexto).blocoAtualizador, '')
})
test('snapshot permanece após retorno e só finaliza com todos os links concluídos', () => {
  const local = armazenamento()
  const inicial = salvarRegistroSnapshot(local, criarRegistroSnapshot(lista(produto('MLB1', 1), produto('MLB2', 2))))
  const processado = salvarRegistroSnapshot(local, atualizarStatusSnapshot(inicial,
    { status: 'RETORNO PROCESSADO', retornoTexto: 'https://meli.la/a\nhttps://meli.la/b' }))
  assert.equal(processado.status, 'RETORNO PROCESSADO')
  assert.ok(local.getItem(CHAVE_SNAPSHOT_LOTE))
  const parcial = atualizarStatusSnapshot(processado, { linksConcluidos: ['MLB1'] })
  assert.equal(parcial.status, 'RETORNO PROCESSADO')
  const finalizado = salvarRegistroSnapshot(local, atualizarStatusSnapshot(parcial, { novosConcluidos: ['MLB2'] }))
  assert.equal(finalizado.status, 'FINALIZADO')
  removerRegistroSnapshot(local)
  assert.equal(local.getItem(CHAVE_SNAPSHOT_LOTE), null)
})
test('token não é persistido no snapshot', () => {
  const local = armazenamento(); salvarRegistroSnapshot(local, criarRegistroSnapshot(cinco))
  assert.equal(local.getItem(CHAVE_SNAPSHOT_LOTE).includes('token'), false)
})
test('fixture real permanece pareada após restauração e outra lista', () => {
  const ids = ['MLB5735296442', 'MLB4208012055', 'MLB6797156948']
  const links = ['https://meli.la/1awFBvU', 'https://meli.la/2rU1UqJ', 'https://meli.la/2VXGnoM']
  const local = armazenamento(); salvarRegistroSnapshot(local, criarRegistroSnapshot(lista(...ids.map((id, indice) => produto(id, indice + 1)))))
  const outraLista = lista(produto('MLB999', 1), produto('MLB888', 2), produto('MLB777', 3))
  assert.equal(outraLista.produtos[0].itemId, 'MLB999')
  const restaurado = lerRegistroSnapshot(local).registro
  const retorno = processarRetornoGerador(restaurado.snapshot.produtos, links.join('\n'))
  assert.equal(retorno.blocoAtualizador, ids.map((id, indice) => `${id} | ${links[indice]}`).join('\n'))
})
