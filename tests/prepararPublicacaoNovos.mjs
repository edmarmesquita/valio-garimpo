import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
const { prepararPublicacaoNovos } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/prepararPublicacaoNovos.ts')
test.after(async () => vite.close())

const produto = (id, extras = {}) => ({ itemId: id, ordem: Number(id.slice(3)), titulo: `Produto ${id}`,
  urlNormalizada: `https://www.mercadolivre.com.br/${id}`,
  dadosPublicacao: { itemId: id, titulo: `Produto ${id}`, precoAtual: 29.9,
    imagemUrl: 'https://http2.mlstatic.com/imagem.webp', avaliacao: 4.5,
    linkOriginal: `https://www.mercadolivre.com.br/${id}` }, ...extras })
const linha = (indice, id, link, encontrado = false) => ({ linha: indice + 1, mercado_livre_id: id,
  link_novo: link, titulo: encontrado ? `Produto ${id}` : null,
  link_anterior: encontrado ? 'https://meli.la/antigo' : null,
  motivo: encontrado ? null : 'Produto não encontrado; nenhum cadastro será criado.' })
const preparar = (produtos, texto, encontrados = [], categorias = new Map(produtos.map((p) => [p.itemId, 'Achados para Casa']))) => {
  const retorno = processarRetornoGerador(produtos, texto)
  const links = retorno.pareamentos.filter((p) => p.retorno?.tipo === 'LINK')
  const previa = { solicitadas: links.length, linhas: links.map(({ produto: p, retorno: r }, i) => linha(i, p.itemId, r.link, encontrados.includes(p.itemId))) }
  return prepararPublicacaoNovos(retorno, previa, categorias)
}

test('produto novo completo com meli.la e categoria fica pronto', () => {
  const { novos } = preparar([produto('MLB1')], 'https://meli.la/abc')
  assert.equal(novos[0].situacao, 'PRONTO PARA PUBLICAR')
  assert.equal(novos[0].dados.linkOriginal, 'https://meli.la/abc')
})
test('URL direta nunca substitui o link oficial e fica bloqueada', () => {
  const p = produto('MLB1')
  const retorno = processarRetornoGerador([p], 'https://meli.la/abc')
  const direto = p.urlNormalizada
  retorno.pareamentos[0].retorno.link = direto
  retorno.blocoAtualizador = `MLB1 | ${direto}`
  const resultado = prepararPublicacaoNovos(retorno, { solicitadas: 1, linhas: [linha(0, 'MLB1', direto)] }, new Map([['MLB1', 'Achados para Casa']]))
  assert.equal(resultado.novos[0].situacao, 'LINK NÃO OFICIAL')
  assert.equal(resultado.novos[0].dados.linkOriginal, direto)
})
test('sem categoria fica bloqueado', () => {
  assert.equal(preparar([produto('MLB1')], 'https://meli.la/abc', [], new Map()).novos[0].situacao, 'SEM CATEGORIA')
})
test('dados incompletos mostram campos faltantes e bloqueiam publicação', () => {
  const incompleto = produto('MLB1', { titulo: null, dadosPublicacao: { titulo: null, precoAtual: null, imagemUrl: null } })
  const item = preparar([incompleto], 'https://meli.la/abc').novos[0]
  assert.equal(item.situacao, 'DADOS INCOMPLETOS')
  assert.deepEqual(item.faltantes.sort(), ['imagem', 'preço', 'título'])
})
test('produto existente fica fora dos novos', () => {
  const resultado = preparar([produto('MLB1')], 'https://meli.la/abc', ['MLB1'])
  assert.deepEqual(resultado.existentes, ['MLB1'])
  assert.equal(resultado.novos.length, 0)
})
test('recusado e pausado não entram na publicação', () => {
  const resultado = preparar([produto('MLB1'), produto('MLB2'), produto('MLB3')],
    'https://meli.la/a\nEste produto não cumpre com os requisitos do Programa.\nEste URL corresponde a um produto pausado.')
  assert.deepEqual(resultado.novos.map((p) => p.produto.itemId), ['MLB1'])
})
test('REVISAR impede toda classificação para publicar', () => {
  assert.equal(preparar([produto('MLB1'), produto('MLB2')], 'https://meli.la/a\nMensagem desconhecida').novos.length, 0)
})
test('lote misto separa existente e novo', () => {
  const resultado = preparar([produto('MLB1'), produto('MLB2')], 'https://meli.la/a\nhttps://meli.la/b', ['MLB1'])
  assert.deepEqual(resultado.existentes, ['MLB1'])
  assert.deepEqual(resultado.novos.map((p) => p.produto.itemId), ['MLB2'])
})
test('resposta da prévia trocada não classifica produto novo', () => {
  const p = produto('MLB1')
  const retorno = processarRetornoGerador([p], 'https://meli.la/abc')
  const resultado = prepararPublicacaoNovos(retorno, { solicitadas: 1, linhas: [linha(0, 'MLB999', 'https://meli.la/abc')] }, new Map())
  assert.equal(resultado.novos.length, 0)
})
