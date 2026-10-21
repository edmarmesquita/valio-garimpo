import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar } from './fixtures/harAfiliados.mjs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { analisarCatalogoCsv } = await vite.ssrLoadModule('/src/lib/catalogoCsv.ts')
const { analisarHar } = await vite.ssrLoadModule('/src/lib/harAfiliadosParser.ts')
const { compararHarCatalogo } = await vite.ssrLoadModule('/src/lib/compararHarCatalogo.ts')
const header = 'mercado_livre_id,preco,ativo,oferta_relampago,oferta_inicio,oferta_fim,titulo'
const csv = (...rows) => [header, ...rows].join('\r\n')

test('CSV válido mantém apenas dados necessários, lê aspas, vírgulas e quebras de linha', () => {
  const r = analisarCatalogoCsv('\uFEFF' + csv('MLB123,90.50,true,false,,,"Produto, com ""aspas""\ne quebra"'))
  assert.equal(r.registrosLidos, 1); assert.equal(r.ativosValidos, 1)
  assert.equal(r.produtos[0].preco, 90.5)
  assert.equal(r.produtos[0].titulo, 'Produto, com "aspas"\ne quebra')
})
test('colunas fora de ordem, aliases camelCase e delimitador ponto e vírgula', () => {
  const r = analisarCatalogoCsv('nome;ativo;preco;mercadoLivreId;ofertaRelampago\nTeste;true;90,50;MLB123;false')
  assert.equal(r.produtos[0].mercadoLivreId, 'MLB123'); assert.equal(r.produtos[0].preco, 90.5)
})
test('ativo=false e status ambíguo são ignorados', () => {
  const r = analisarCatalogoCsv(csv('MLB123,90,false,false,,,Teste', 'MLB124,90,sim,false,,,Teste'))
  assert.equal(r.produtos.length, 0); assert.equal(r.inativosIgnorados, 1); assert.equal(r.statusInvalidos, 1)
})
test('ITEM_ID inválido é ignorado, sem fallback por nome', () => {
  const r = analisarCatalogoCsv(csv('MLBU123,90,true,false,,,MLB123'))
  assert.equal(r.idsInvalidos, 1); assert.equal(r.produtos.length, 0)
})
test('preço inválido é mantido como bloqueado, nunca convertido silenciosamente', () => {
  for (const v of ['', 'abc', '0', '-1', 'Infinity', '1.234', 'R$ 10']) {
    const r = analisarCatalogoCsv(csv(`MLB123,${v},true,false,,,Teste`))
    assert.equal(r.precosInvalidos, 1); assert.equal(r.ativosValidos, 0)
    const c = compararHarCatalogo(analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har'), r.produtos)
    assert.equal(c.encontrados[0].status, 'PRECO_INVALIDO'); assert.equal(c.encontrados[0].diferenca, null)
  }
})
test('cruzamento HAR x CSV somente pelo ITEM_ID, sem matching por título', () => {
  const r = analisarCatalogoCsv(csv('MLB123,100,true,false,,,Título diferente', 'MLB999,100,true,false,,,Produto sintético'))
  const c = compararHarCatalogo(analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har'), r.produtos)
  assert.equal(c.encontrados.length, 1); assert.equal(c.encontrados[0].produto.mercadoLivreId, 'MLB123')
  assert.equal(c.diferentes, 1); assert.equal(c.naoEncontrados[0].mercadoLivreId, 'MLB999')
})
test('oferta_relampago e datas são preservadas e mantêm proteção', () => {
  const r = analisarCatalogoCsv(csv('MLB123,100,true,true,2030-10-01T12:00:00-03:00,2030-10-02T12:00:00-03:00,Teste'))
  assert.equal(r.produtos[0].ofertaRelampago, true)
  assert.equal(r.produtos[0].ofertaInicio, '2030-10-01T12:00:00-03:00')
  assert.equal(r.produtos[0].ofertaFim, '2030-10-02T12:00:00-03:00')
  const p = compararHarCatalogo(analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har'), r.produtos, Date.parse('2026-10-21')).encontrados[0]
  assert.equal(p.status, 'OFERTA_PROTEGIDA'); assert.equal(p.oferta, 'AGENDADA')
})
test('CSV vazio informa erro; apenas cabeçalho produz zero registros', () => {
  assert.throws(() => analisarCatalogoCsv(' \r\n'), /CSV vazio/)
  assert.equal(analisarCatalogoCsv(header).registrosLidos, 0)
})
test('cabeçalho inválido ou ambíguo e estrutura truncada são rejeitados', () => {
  assert.throws(() => analisarCatalogoCsv('id,nome\nMLB123,Teste'), /Cabeçalho CSV inválido/)
  assert.throws(() => analisarCatalogoCsv('mercado_livre_id,itemId,preco,ativo'), /ambíguo/)
  assert.throws(() => analisarCatalogoCsv(csv('MLB123,90,true')), /quantidade de campos/)
  assert.throws(() => analisarCatalogoCsv(csv('MLB123,90,true,false,,,"Teste')), /incompleto/)
})
test('duplicidade de ITEM_ID e flag de oferta desconhecida são bloqueadas para revisão', () => {
  const r = analisarCatalogoCsv(csv('MLB123,90,true,false,,,A', 'MLB123,90,true,false,,,B'))
  assert.equal(r.idsDuplicados, 1); assert.equal(r.ativosValidos, 0)
  const har = analisarHar(arquivoHar(entradaHar([cardHar()])), 'a.har')
  assert.equal(compararHarCatalogo(har, r.produtos).encontrados[0].status, 'CATALOGO_REVISAR')
  const semFlag = analisarCatalogoCsv('mercado_livre_id,preco,ativo\nMLB123,90,true')
  assert.equal(semFlag.ofertasIncompletas, 1)
  assert.equal(compararHarCatalogo(har, semFlag.produtos).encontrados[0].status, 'OFERTA_PROTEGIDA')
})
