import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
const { prepararPublicacaoNovos } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/prepararPublicacaoNovos.ts')
const { CHAVE_SNAPSHOT_LOTE, criarRegistroSnapshot, salvarRegistroSnapshot, lerRegistroSnapshot,
  atualizarStatusSnapshot } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/snapshotLoteAfiliados.ts')
test.after(async () => vite.close())

const LINK = (indice) => `https://meli.la/link${indice}`
const RECUSADO = 'Este produto não cumpre com os requisitos do Programa.'
const PAUSADO = 'Este URL corresponde a um produto pausado.'
const REVISAR = '⚠️ Resultado inesperado: confira manualmente.'
const CAMPO_VAZIO = '⚠️ O campo está vazio. Insira o URL que você quer divulgar.'
const produto = (itemId, ordem) => ({ itemId, ordem, titulo: `Produto ${itemId}`,
  urlNormalizada: `https://www.mercadolivre.com.br/${itemId}`,
  dadosPublicacao: { itemId, titulo: `Produto ${itemId}`, precoAtual: 39.9,
    imagemUrl: 'https://http2.mlstatic.com/imagem.webp', linkOriginal: `https://www.mercadolivre.com.br/${itemId}` } })
const lista = (ids) => ({ encontrados: ids.length, unicos: ids.length, ignorados: 0, duplicados: 0,
  produtos: ids.map((id, indice) => produto(id, indice + 1)),
  urlsParaGerador: ids.map((id) => `https://www.mercadolivre.com.br/${id}`).join('\n') })
const ids = (quantidade) => Array.from({ length: quantidade }, (_, indice) => `MLB${indice + 1}`)
const snapshot = (quantidade) => criarRegistroSnapshot(lista(ids(quantidade)))
const tipos = (resultado) => resultado.pareamentos.map((par) => par.retorno?.tipo ?? null)
const principal = [LINK(1), LINK(2), RECUSADO, LINK(4), PAUSADO, LINK(6), LINK(7), RECUSADO, LINK(9), LINK(10)].join('\n')
const idsValidos = ['MLB1', 'MLB2', 'MLB4', 'MLB6', 'MLB7', 'MLB9', 'MLB10']

test('lote principal de dez posições produz sete links, dois recusados e um pausado', () => {
  const retorno = processarRetornoGerador(snapshot(10).snapshot.produtos, principal)
  assert.deepEqual([retorno.totalProdutos, retorno.linksValidos, retorno.recusados, retorno.pausados,
    retorno.revisar, retorno.errosQuantidade], [10, 7, 2, 1, 0, 0])
  assert.deepEqual(tipos(retorno), ['LINK', 'LINK', 'RECUSADO', 'LINK', 'PAUSADO', 'LINK', 'LINK', 'RECUSADO', 'LINK', 'LINK'])
  assert.equal(retorno.consistente, true)
})

test('bloco e classificação para publicação contêm só os sete válidos do lote principal', () => {
  const retorno = processarRetornoGerador(snapshot(10).snapshot.produtos, principal)
  assert.deepEqual(retorno.blocoAtualizador.split('\n'), [1, 2, 4, 6, 7, 9, 10].map((indice) => `MLB${indice} | ${LINK(indice)}`))
  const previa = { solicitadas: 7, linhas: idsValidos.map((id, indice) => ({ linha: indice + 1,
    mercado_livre_id: id, link_novo: LINK(Number(id.slice(3))), titulo: null, link_anterior: null,
    motivo: 'Produto não encontrado; nenhum cadastro será criado.' })) }
  const categorias = new Map(ids(10).map((id) => [id, 'Achados para Casa']))
  const classificados = prepararPublicacaoNovos(retorno, previa, categorias)
  assert.deepEqual(classificados.novos.map((item) => item.produto.itemId), idsValidos)
  assert.ok(classificados.novos.every((item) => item.situacao === 'PRONTO PARA PUBLICAR'))
  assert.ok(classificados.novos.every((item) => item.dados.linkOriginal.startsWith('https://meli.la/')))
})

test('aviso de campo vazio não ocupa posição antes de LINK, RECUSADO e LINK', () => {
  const retorno = processarRetornoGerador(snapshot(3).snapshot.produtos,
    [CAMPO_VAZIO, LINK(1), RECUSADO, LINK(3)].join('\n'))
  assert.equal(retorno.totalResultados, 3)
  assert.deepEqual(tipos(retorno), ['LINK', 'RECUSADO', 'LINK'])
  assert.equal(retorno.blocoAtualizador, `MLB1 | ${LINK(1)}\nMLB3 | ${LINK(3)}`)
})

test('mensagem desconhecida preserva texto e bloqueia bloco e publicação', () => {
  const retorno = processarRetornoGerador(snapshot(3).snapshot.produtos, [LINK(1), REVISAR, LINK(3)].join('\n'))
  assert.deepEqual(tipos(retorno), ['LINK', 'REVISAR', 'LINK'])
  assert.equal(retorno.pareamentos[1].retorno.original, REVISAR)
  assert.equal(retorno.pareamentos[1].situacao, 'REVISAR')
  assert.equal(retorno.consistente, false)
  assert.equal(retorno.blocoAtualizador, '')
  assert.deepEqual(prepararPublicacaoNovos(retorno, { solicitadas: 0, linhas: [] }, new Map()), { existentes: [], novos: [] })
})

test('quatro resultados para cinco produtos bloqueiam bloco e publicação', () => {
  const retorno = processarRetornoGerador(snapshot(5).snapshot.produtos, [LINK(1), LINK(2), RECUSADO, LINK(4)].join('\n'))
  assert.equal(retorno.errosQuantidade, 1)
  assert.equal(retorno.pareamentos[4].retorno, null)
  assert.equal(retorno.pareamentos[4].situacao, 'REVISAR')
  assert.equal(retorno.blocoAtualizador, '')
  assert.equal(prepararPublicacaoNovos(retorno, { solicitadas: 0, linhas: [] }, new Map()).novos.length, 0)
})

test('seis resultados para cinco produtos expõem excedente sem deslocar os cinco pares', () => {
  const retorno = processarRetornoGerador(snapshot(5).snapshot.produtos,
    [LINK(1), RECUSADO, PAUSADO, LINK(4), LINK(5), LINK(6)].join('\n'))
  assert.equal(retorno.errosQuantidade, 1)
  assert.deepEqual(retorno.pareamentos.map((par) => [par.produto.itemId, par.retorno.tipo]),
    [['MLB1', 'LINK'], ['MLB2', 'RECUSADO'], ['MLB3', 'PAUSADO'], ['MLB4', 'LINK'], ['MLB5', 'LINK']])
  assert.equal(retorno.excedentes[0].link, LINK(6))
  assert.equal(retorno.blocoAtualizador, '')
})

test('outra lista atual não interfere no pareamento misto do snapshot', () => {
  const original = criarRegistroSnapshot(lista(['MLB111', 'MLB222', 'MLB333', 'MLB444', 'MLB555']))
  const atual = lista(['MLB999', 'MLB888', 'MLB777', 'MLB666', 'MLB000'])
  const retorno = processarRetornoGerador(original.snapshot.produtos, [LINK(1), RECUSADO, PAUSADO, LINK(4), REVISAR].join('\n'))
  assert.deepEqual(retorno.pareamentos.map((par) => par.produto.itemId), ['MLB111', 'MLB222', 'MLB333', 'MLB444', 'MLB555'])
  assert.deepEqual(atual.produtos.map((item) => item.itemId), ['MLB999', 'MLB888', 'MLB777', 'MLB666', 'MLB000'])
  assert.deepEqual(tipos(retorno), ['LINK', 'RECUSADO', 'PAUSADO', 'LINK', 'REVISAR'])
})

test('reinício simulado restaura ordem, status e processamento do lote misto', () => {
  const itens = new Map()
  const armazenamento = { getItem: (chave) => itens.get(chave) ?? null,
    setItem: (chave, valor) => itens.set(chave, valor) }
  const inicial = salvarRegistroSnapshot(armazenamento, snapshot(5))
  const processado = salvarRegistroSnapshot(armazenamento, atualizarStatusSnapshot(inicial,
    { status: 'RETORNO PROCESSADO', retornoTexto: [LINK(1), RECUSADO, PAUSADO, LINK(4), LINK(5)].join('\n') }))
  const restaurado = lerRegistroSnapshot(armazenamento)
  assert.equal(restaurado.invalido, false)
  assert.equal(restaurado.registro.status, 'RETORNO PROCESSADO')
  assert.equal(itens.has(CHAVE_SNAPSHOT_LOTE), true)
  assert.deepEqual(restaurado.registro.snapshot.produtos.map((item) => [item.posicaoGerador, item.itemId]),
    ids(5).map((id, indice) => [indice + 1, id]))
  assert.equal(processarRetornoGerador(restaurado.registro.snapshot.produtos, processado.retornoTexto).blocoAtualizador,
    `MLB1 | ${LINK(1)}\nMLB4 | ${LINK(4)}\nMLB5 | ${LINK(5)}`)
})

test('somente dois recusados e dois pausados não geram ação', () => {
  const retorno = processarRetornoGerador(snapshot(4).snapshot.produtos, [RECUSADO, PAUSADO, RECUSADO, PAUSADO].join('\n'))
  assert.deepEqual([retorno.linksValidos, retorno.recusados, retorno.pausados], [0, 2, 2])
  assert.equal(retorno.consistente, true)
  assert.equal(retorno.blocoAtualizador, '')
  assert.deepEqual(prepararPublicacaoNovos(retorno, { solicitadas: 0, linhas: [] }, new Map()), { existentes: [], novos: [] })
})

test('dez links válidos geram dez pares na ordem original', () => {
  const retorno = processarRetornoGerador(snapshot(10).snapshot.produtos, ids(10).map((_, indice) => LINK(indice + 1)).join('\n'))
  assert.deepEqual([retorno.linksValidos, retorno.recusados, retorno.pausados, retorno.revisar, retorno.errosQuantidade], [10, 0, 0, 0, 0])
  assert.deepEqual(retorno.blocoAtualizador.split('\n'), ids(10).map((id, indice) => `${id} | ${LINK(indice + 1)}`))
})

test('LINK, RECUSADO, PAUSADO, LINK e REVISAR consomem cada um sua posição', () => {
  const retorno = processarRetornoGerador(snapshot(5).snapshot.produtos, [LINK(1), RECUSADO, PAUSADO, LINK(4), REVISAR].join('\n'))
  assert.deepEqual(retorno.pareamentos.map((par) => [par.produto.itemId, par.retorno.tipo, par.situacao]), [
    ['MLB1', 'LINK', 'PRONTO'], ['MLB2', 'RECUSADO', 'NÃO PUBLICAR'], ['MLB3', 'PAUSADO', 'NÃO PUBLICAR'],
    ['MLB4', 'LINK', 'PRONTO'], ['MLB5', 'REVISAR', 'REVISAR'],
  ])
  assert.equal(retorno.blocoAtualizador, '')
})
