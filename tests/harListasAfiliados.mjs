import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'
import { arquivoHar, entradaHar, cardHar, catalogoHar } from './fixtures/harAfiliados.mjs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const { analisarHar, analisarDocumentoLista, combinarHars } = await vite.ssrLoadModule('/src/lib/harAfiliadosParser.ts')
const { compararHarCatalogo } = await vite.ssrLoadModule('/src/lib/compararHarCatalogo.ts')
const { candidatoSeguroHar, gerarPreviaHar, motivosBloqueioHar } = await vite.ssrLoadModule('/src/lib/previaHar.ts')
const { pedidoRevalidacaoHar } = await vite.ssrLoadModule('/src/lib/atualizarPrecosHar.ts')

const lista = (cards, { id = 'lista-casa', nome = 'Casa', total = cards.length } = {}) => ({
  appProps: { pageProps: { initialState: { list: { id, name: nome, title: nome,
    total_items: total, products_amount: cards.length, type: 'affiliate', products: cards.map((card) => ({ card })) } } } },
})
const html = (obj) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: obj })}</script></body></html>`
const nordicHtml = (cards, total = cards.length) => {
  const obj = lista(cards, { nome: 'Casa {Utilidades}', total })
  const state = obj.appProps.pageProps.initialState.list
  delete state.products
  state.elements = { polycard_context: { type: 'polycard' }, polycards: cards }
  return `<html><script id="__NORDIC_RENDERING_CTX__" nonce="synthetic">\n_n.ctx.r = ${JSON.stringify({ title: 'Lista de afiliados', ...obj })};\n_n.ctx.r.scopes = {}; window.__naoExecutar = true;\n</script></html>`
}
const entradaLista = (obj, op = {}) => ({
  request: { method: 'GET', url: op.url ?? 'https://myaccount.mercadolivre.com.br/bookmarks/wishlist/hub/detail/lista-casa?page=2' },
  response: { status: op.status ?? 200, content: { mimeType: 'text/html', text: op.base64
    ? Buffer.from(html(obj)).toString('base64') : html(obj), ...(op.base64 ? { encoding: 'base64' } : {}) } },
})

test('Hub antigo continua extraindo cards e não detecta lista falsa', () => {
  const r = analisarHar(arquivoHar(entradaHar([cardHar('MLB123', 90)])), 'hub.har')
  assert.equal(r.chamadasSearch, 1); assert.equal(r.documentosLista, 0)
  assert.equal(r.produtos[0].itemId, 'MLB123'); assert.deepEqual(r.listas, [])
})

test('documento HTML da lista extrai ITEM_ID, título, preço, moeda, desconto e origem', () => {
  const c = cardHar('MLB321', 72, { anterior: 100, label: '28% OFF', titulo: 'Produto sintético' })
  const r = analisarHar(arquivoHar(entradaLista(lista([c]))), 'casa.har')
  assert.equal(r.chamadasSearch, 0); assert.equal(r.documentosLista, 1)
  assert.equal(r.ocorrencias, 1); assert.equal(r.produtos.length, 1)
  const p = r.produtos[0].capturas[0]
  assert.equal(p.itemId, 'MLB321'); assert.equal(p.productId, 'MLB456'); assert.equal(p.userProductId, 'MLBU789')
  assert.equal(p.titulo, 'Produto sintético'); assert.equal(p.precoAtual, 72); assert.equal(p.precoAnterior, 100)
  assert.equal(p.moeda, 'BRL'); assert.equal(p.discountLabel, '28% OFF'); assert.match(p.url, /mercadolivre.com.br/)
  assert.equal(p.listaId, 'lista-casa'); assert.equal(p.listaNome, 'Casa')
  assert.deepEqual(r.produtos[0].listasOrigem, [{ id: 'lista-casa', nome: 'Casa' }])
  assert.equal(r.listas[0].status, 'COMPLETA'); assert.equal(r.listas[0].totalEsperado, 1)
  assert.equal(compararHarCatalogo(r, [catalogoHar('MLB321')]).encontrados.length, 1)
})

test('HTML Nordic realista: atribuição JS com JSON, list.elements.polycards e script posterior', () => {
  const conteudo = nordicHtml([cardHar('MLB123', 90, { titulo: 'Pote {"hermético"}' }), cardHar('MLB124', 80)], 3)
  const r = analisarDocumentoLista(conteudo, 'casa.html')
  assert.equal(r.listas[0].nome, 'Casa {Utilidades}')
  assert.equal(r.listas[0].totalEsperado, 3); assert.equal(r.listas[0].extraidos, 2)
  assert.equal(r.listas[0].status, 'INCOMPLETA')
  assert.deepEqual(r.produtos.map((p) => p.itemId), ['MLB123', 'MLB124'])
  assert.equal(r.produtos[0].capturas[0].titulo, 'Pote {"hermético"}')
  assert.equal(globalThis.__naoExecutar, undefined)
})

test('documento JSON independente e HTML base64 em HAR são aceitos; origem externa e HTTP não 200 são ignorados', () => {
  const obj = lista([cardHar('MLB123')])
  assert.equal(analisarDocumentoLista(JSON.stringify(obj), 'lista.json').produtos.length, 1)
  const r = analisarHar(arquivoHar(entradaLista(obj, { base64: true }),
    entradaLista(obj, { url: 'https://externo.example/lista' }), entradaLista(obj, { status: 403 })), 'lista.har')
  assert.equal(r.documentosLista, 1); assert.equal(r.produtos.length, 1)
  assert.throws(() => analisarDocumentoLista('{}', 'vazio.json'), /sem lista/)
  const alternativo = { props: { irrelevante: true }, appProps: obj.appProps }
  assert.equal(analisarDocumentoLista(JSON.stringify(alternativo), 'alternativo.json').produtos.length, 1)
})

test('PIX nas promotions e CUPOM/condição combinada continuam bloqueados', () => {
  const pix = cardHar('MLB123', 90, { metadata: { tracks: { price: { promotions: [{ type: 'pix_campaign' }] } } } })
  const cupom = cardHar('MLB124', 90, { label: '10% OFF com Cupom' })
  const misto = cardHar('MLB125', 90, { label: 'Cupom', metadata: { tracks: { price: { promotions: [{ type: 'PIX' }] } } } })
  const cupomCampanha = cardHar('MLB126', 90, { metadata: { tracks: { price: { promotions: [{ type: 'cupom_campaign' }] } } } })
  const r = analisarDocumentoLista(html(lista([pix, cupom, misto, cupomCampanha])), 'lista.html')
  const tipos = r.produtos.map((p) => p.classificacao)
  assert.deepEqual(tipos, ['PIX', 'CUPOM', 'OUTRO_REVISAR', 'CUPOM'])
  const linhas = compararHarCatalogo(r, ['MLB123', 'MLB124', 'MLB125', 'MLB126'].map((id) => catalogoHar(id))).encontrados
  assert.equal(linhas.every((p) => !candidatoSeguroHar(p)), true)
  assert.match(motivosBloqueioHar(linhas[2]).join(' '), /CONDIÇÃO COMBINADA/)
  assert.throws(() => gerarPreviaHar(linhas, ['MLB123'], 'api'))
})

test('múltiplas listas, deduplicação e preservação de todas as origens', () => {
  const casa = analisarHar(arquivoHar(entradaLista(lista([cardHar('MLB123', 90), cardHar('MLB124', 80)], { total: 3 }))), 'casa.har')
  const elas = analisarHar(arquivoHar(entradaLista(lista([cardHar('MLB123', 90), cardHar('MLB125', 70)],
    { id: 'lista-elas', nome: 'Elas' }))), 'elas.har')
  const casaPagina2 = analisarHar(arquivoHar(entradaLista(lista([cardHar('MLB126', 60)], { total: 3 }))), 'casa-p2.har')
  const r = combinarHars([casa, elas, casaPagina2])
  assert.equal(r.documentosLista, 3); assert.equal(r.listas.length, 2)
  assert.equal(r.ocorrencias, 5); assert.equal(r.produtos.length, 4); assert.equal(r.duplicados, 1)
  assert.equal(r.produtos[0].conflito, null); assert.deepEqual(r.produtos[0].listasOrigem,
    [{ id: 'lista-casa', nome: 'Casa' }, { id: 'lista-elas', nome: 'Elas' }])
  assert.equal(r.listas.find((l) => l.id === 'lista-casa').status, 'COMPLETA')
  assert.equal(r.listas.find((l) => l.id === 'lista-casa').extraidos, 3)
  assert.equal(r.listas.find((l) => l.id === 'lista-elas').status, 'COMPLETA')
})

test('três páginas da mesma lista aparecem como uma lista e deduplicam ITEM_ID sobreposto', () => {
  const paginas = [
    nordicHtml([cardHar('MLB123'), cardHar('MLB124')], 4),
    nordicHtml([cardHar('MLB124'), cardHar('MLB125')], 4),
    nordicHtml([cardHar('MLB126')], 4),
  ].map((conteudo, indice) => analisarDocumentoLista(conteudo, `casa-${indice + 1}.html`))
  const r = combinarHars(paginas)
  assert.equal(r.arquivos.length, 3); assert.equal(r.documentosLista, 3)
  assert.equal(r.listas.length, 1); assert.equal(r.listas[0].status, 'COMPLETA')
  assert.equal(r.listas[0].extraidos, 4); assert.equal(r.listas[0].ocorrencias, 5)
  assert.equal(r.produtos.length, 4); assert.equal(r.duplicados, 1)
})

test('preços diferentes entre listas geram conflito, inclusive ao misturar Hub e lista', () => {
  const a = analisarDocumentoLista(html(lista([cardHar('MLB123', 90)])), 'casa.html')
  const b = analisarDocumentoLista(html(lista([cardHar('MLB123', 95)], { id: 'lista-elas', nome: 'Elas' })), 'elas.html')
  const hub = analisarHar(arquivoHar(entradaHar([cardHar('MLB123', 90)])), 'hub.har')
  const r = combinarHars([a, b, hub])
  assert.equal(r.produtos[0].precoAtual, null); assert.deepEqual(r.produtos[0].conflito.precos, [90, 95])
  assert.equal(compararHarCatalogo(r, [catalogoHar()]).encontrados[0].status, 'CONFLITO_HAR')
})

test('lista incompleta ou sem total nunca exibe cobertura total', () => {
  const incompleta = analisarDocumentoLista(html(lista([cardHar()], { total: 77 })), 'casa.html')
  assert.equal(incompleta.listas[0].extraidos, 1); assert.equal(incompleta.listas[0].status, 'INCOMPLETA')
  const semTotal = lista([cardHar()]); delete semTotal.appProps.pageProps.initialState.list.total_items
  assert.equal(analisarDocumentoLista(html(semTotal), 'sem-total.html').listas[0].status, 'TOTAL_DESCONHECIDO')
})

test('produto NORMAL da lista percorre seleção, prévia e pedido de revalidação existentes', () => {
  const r = analisarDocumentoLista(html(lista([cardHar('MLB123', 90)])), 'casa.html')
  const linhas = compararHarCatalogo(r, [catalogoHar()]).encontrados
  assert.equal(candidatoSeguroHar(linhas[0]), true)
  const previa = gerarPreviaHar(linhas, ['MLB123'], 'api')
  assert.match(previa.itens[0].arquivosOrigem[0], /casa\.html.*Casa/)
  const pedido = pedidoRevalidacaoHar(previa, linhas)
  assert.equal(pedido.itens[0].itemId, 'MLB123')
  assert.equal(pedido.itens[0].precoBase, 100)
  assert.equal(pedido.itens[0].novoPreco, 90)
  assert.equal(pedido.versao, previa.versao)
})

test('documento não retém cookies, tokens nem campos arbitrários de metadata', () => {
  const c = cardHar('MLB123', 90, { metadata: { token: 'SEGREDO', url_params: '?token=SEGREDO' } })
  const r = analisarDocumentoLista(html(lista([c])), 'lista.html')
  assert.doesNotMatch(JSON.stringify(r), /SEGREDO|token/)
})
