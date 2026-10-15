import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { enviarSelecionadosValio, selecionadosPublicaveis } = await vite.ssrLoadModule('/src/lib/publicarProdutosValio.ts')
const { extrairListaAfiliados } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/extrairListaAfiliados.ts')
const { processarRetornoGerador } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/processarRetornoGerador.ts')
const { prepararPublicacaoNovos } = await vite.ssrLoadModule('/src/features/importar-lista-afiliados/prepararPublicacaoNovos.ts')
const { validarProdutoPublicacao } = await vite.ssrLoadModule('/server/valioProduto.ts')
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

test('opção de criação exclusiva preserva link oficial no payload', async () => {
  const chamadas = []
  const enviar = async (url, options) => {
    chamadas.push({ url, corpo: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ ok: true, acao: 'criado' }) }
  }
  const oficial = 'https://meli.la/oficial'
  const resumo = await enviarSelecionadosValio([produto('MLB1', { linkOriginal: oficial })], new Set([0]),
    new Map([[0, 'Achados para Casa']]), 'token-local', enviar, { somenteCriar: true })
  assert.equal(resumo.criados, 1)
  assert.equal(chamadas[0].url, '/api/valio/produtos')
  assert.equal(chamadas[0].corpo.linkAfiliado, oficial)
  assert.equal(chamadas[0].corpo.somenteCriar, true)
})

test('polycard com metadata extra gera somente o DTO permitido e mantém somenteCriar', async () => {
  const id = 'MLB5735296442'
  const link = 'https://meli.la/1awFBvU'
  const lista = extrairListaAfiliados(JSON.stringify({ polycard_context: {
    picture_template: 'https://http2.mlstatic.com/D_{id}-O.webp',
  }, polycards: [{ unique_id: 'card-real', metadata: {
    id, product_id: 'MLB999', user_product_id: 'MLBU999', pid: 'PID', pid_extended: 'PID_MLB',
    url: 'www.mercadolivre.com.br/url-direta', url_params: '?extra_comm=true', url_fragments: '#bookmarks',
    bookmarks_id: 'bookmark', origin_id: 'origem', card_type: 'item', vertical: 'home',
  }, pictures: [{ id: 'imagem' }], components: [
    { id: 'title', title: { text: 'Produto real' } },
    { id: 'price', price: { current_price: { value: 79.99, currency: 'BRL' } } },
  ] }] }))
  const retorno = processarRetornoGerador(lista.produtos, link)
  const categorias = new Map([[id, 'Achados para Casa']])
  const previa = { solicitadas: 1, linhas: [{ linha: 1, mercado_livre_id: id, link_novo: link,
    titulo: null, link_anterior: null, motivo: 'Produto não encontrado; nenhum cadastro será criado.' }] }
  const novo = prepararPublicacaoNovos(retorno, previa, categorias).novos[0]
  assert.equal(novo.situacao, 'PRONTO PARA PUBLICAR')
  let corpo
  const enviar = async (_url, options) => {
    corpo = JSON.parse(options.body)
    return { ok: true, json: async () => ({ ok: true, acao: 'criado' }) }
  }
  const resumo = await enviarSelecionadosValio([novo.dados], new Set([0]),
    new Map([[0, categorias.get(id)]]), 'token-local', enviar, { somenteCriar: true })
  assert.equal(resumo.criados, 1)
  assert.deepEqual(Object.keys(corpo).sort(), [
    'categoria', 'dataPreco', 'descricao', 'imagem', 'linkAfiliado', 'mercadoLivreId',
    'preco', 'somenteCriar', 'titulo',
  ].sort())
  assert.equal(corpo.linkAfiliado, link)
  assert.equal(corpo.somenteCriar, true)
  assert.equal(corpo.imagem, 'https://http2.mlstatic.com/D_imagem-O.webp')
  const { somenteCriar, ...produtoValidado } = corpo
  assert.equal(somenteCriar, true)
  assert.equal(validarProdutoPublicacao(produtoValidado).mercadoLivreId, id)
})

test('API antiga que rejeita somenteCriar não provoca tentativa insegura', async () => {
  const resumo = await enviarSelecionadosValio([produto('MLB1', { linkOriginal: 'https://meli.la/abc' })],
    new Set([0]), new Map([[0, 'Achados para Casa']]), 'token-local', async () => ({ ok: false,
      status: 400, json: async () => ({ ok: false, erro: 'O produto contém campos não permitidos.' }) }), { somenteCriar: true })
  assert.equal(resumo.criados, 0)
  assert.match(resumo.erros[0].motivo, /payload com somenteCriar/)
})
