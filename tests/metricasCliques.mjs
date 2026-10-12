import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import fs from 'node:fs/promises'
import express from 'express'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { criarRotaValioProdutos } = await vite.ssrLoadModule('/server/valioProdutos.ts')
const { validarClique, agregarCliques, inicioPeriodo } = await vite.ssrLoadModule('/server/metricasCliques.ts')
const { getSupabaseConfig, diagnosticarSupabaseEnv } = await vite.ssrLoadModule('/server/services/supabase.ts')
const { criarCliquesGateway } = await vite.ssrLoadModule('/server/services/cliques.ts')
const { diagnosticarErroClique } = await vite.ssrLoadModule('/server/services/diagnosticoCliques.ts')
after(async () => vite.close())
const token = 'token-de-publicacao-local-com-mais-de-32-caracteres'
const config = { url: 'https://teste.supabase.co', serviceRoleKey: 'service-role-simulada-com-mais-de-32-caracteres' }
const agora = new Date('2026-10-12T15:00:00Z')
const produto = (id, titulo, categoria, ativo = true) => ({ mercadoLivreId: id, titulo, categoria, ativo,
  preco: 100, dataPreco: '10/10/2026', linkAfiliado: 'https://mercadolivre.com.br/oferta', imagem: 'https://imagem.com/a', rating: 4.8, updatedAt: '2026-10-10T12:00:00Z' })
const catalogo = [produto('MLB1', 'Primeiro', 'Achados para Casa'), produto('MLB2', 'Segundo', 'Achados para Elas'),
  produto('MLB3', 'Sem clique', 'Achados para Maridos'), produto('MLB4', 'Inativo', 'Achados para Casa', false)]
const linhas = [
  { mercadoLivreId: 'MLB1', categoria: 'Achados para Casa', dia: '2026-10-12', cliques: 3 },
  { mercadoLivreId: 'MLB1', categoria: 'Achados para Casa', dia: '2026-10-06', cliques: 2 },
  { mercadoLivreId: 'MLB2', categoria: 'Achados para Elas', dia: '2026-10-11', cliques: 4 },
  { mercadoLivreId: 'MLB2', categoria: 'Achados para Elas', dia: '2026-09-20', cliques: 10 },
]

test('configuração reconhece variáveis presentes, ausentes e chave moderna sem expor valores', () => {
  const presente = { SUPABASE_URL: 'https://teste.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_chave-simulada' }
  assert.deepEqual(getSupabaseConfig(presente), { url: presente.SUPABASE_URL, serviceRoleKey: presente.SUPABASE_SERVICE_ROLE_KEY })
  assert.deepEqual(diagnosticarSupabaseEnv(presente), {
    SUPABASE_URL: { encontrada: true, comprimentoMaiorQueZero: true },
    SUPABASE_SERVICE_ROLE_KEY: { encontrada: true, comprimentoMaiorQueZero: true }, urlHttps: true,
  })
  assert.equal(getSupabaseConfig({ SUPABASE_URL: presente.SUPABASE_URL }), null)
  assert.equal(getSupabaseConfig({ SUPABASE_URL: 'http://teste.supabase.co', SUPABASE_SERVICE_ROLE_KEY: presente.SUPABASE_SERVICE_ROLE_KEY }), null)
  assert.deepEqual(diagnosticarSupabaseEnv({ SUPABASE_URL: ' ', SUPABASE_SERVICE_KEY: 'alias-incorreto' }), {
    SUPABASE_URL: { encontrada: true, comprimentoMaiorQueZero: false },
    SUPABASE_SERVICE_ROLE_KEY: { encontrada: false, comprimentoMaiorQueZero: false }, urlHttps: false,
  })
  assert.equal(JSON.stringify(diagnosticarSupabaseEnv(presente)).includes(presente.SUPABASE_SERVICE_ROLE_KEY), false)
})

test('gateway insere nas colunas corretas e preserva status e erro seguro do Supabase', async () => {
  const capturas = []
  let falhar = false
  const enviar = async (url, options) => {
    capturas.push({ url, body: JSON.parse(options.body) })
    return falhar ? new Response(JSON.stringify({ code: '42501', message: 'permission denied', details: 'RLS', hint: 'service role' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }) : new Response(null, { status: 201 })
  }
  const gateway = criarCliquesGateway(config, enviar)
  await gateway.registrar({ mercadoLivreId: 'MLB1', categoria: 'Achados para Casa', origem: 'vitrine' })
  assert.match(capturas[0].url, /\/rest\/v1\/produto_cliques$/)
  assert.deepEqual(capturas[0].body, { mercado_livre_id: 'MLB1', categoria: 'Achados para Casa', origem: 'vitrine' })
  assert.equal('clicked_at' in capturas[0].body, false)
  falhar = true
  await assert.rejects(gateway.registrar({ mercadoLivreId: 'MLB1', categoria: null, origem: null }), (erro) => {
    assert.deepEqual(diagnosticarErroClique(erro), { status: 403, code: '42501', message: 'permission denied', details: 'RLS', hint: 'service role' })
    return true
  })
  const seguro = diagnosticarErroClique({ message: `Falha ${config.serviceRoleKey} e sb_secret_qualquer`, code: '42501' }, { SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey })
  assert.equal(JSON.stringify(seguro).includes(config.serviceRoleKey), false)
  assert.equal(JSON.stringify(seguro).includes('sb_secret_qualquer'), false)
})

test('valida somente ITEM_ID, categoria e origem; recusa dados pessoais e campos extras', () => {
  assert.deepEqual(validarClique({ mercadoLivreId: 'MLB123', origem: 'vitrine' }), { mercadoLivreId: 'MLB123', categoria: null, origem: 'vitrine' })
  assert.throws(() => validarClique({ origem: 'vitrine' }), /ITEM_ID/)
  assert.throws(() => validarClique({ mercadoLivreId: 'MLB1', categoria: 'Outra' }), /Categoria/)
  assert.throws(() => validarClique({ mercadoLivreId: 'MLB1', origem: 'email' }), /Origem/)
  for (const campo of ['nome', 'email', 'ip', 'fingerprint', 'localizacao', 'cookie'])
    assert.throws(() => validarClique({ mercadoLivreId: 'MLB1', [campo]: 'dado' }), /Campos não permitidos/)
})

test('agrega produtos, categorias, dias e períodos sem identificar visitantes', () => {
  assert.deepEqual([inicioPeriodo('hoje', agora), inicioPeriodo('7dias', agora), inicioPeriodo('30dias', agora), inicioPeriodo('todos', agora)],
    ['2026-10-12', '2026-10-06', '2026-09-13', undefined])
  const hoje = agregarCliques(linhas, catalogo, 'hoje', agora)
  assert.deepEqual([hoje.totalCliques, hoje.totalProdutosComClique, hoje.produtosSemClique], [3, 1, 2])
  assert.deepEqual(hoje.cliquesPorDia, [{ data: '12/10/2026', cliques: 3 }])
  const sete = agregarCliques(linhas, catalogo, '7dias', agora)
  assert.deepEqual([sete.totalCliques, sete.totalProdutosComClique, sete.produtosSemClique], [9, 2, 1])
  assert.deepEqual(sete.rankingProdutos.map((item) => [item.mercadoLivreId, item.titulo, item.cliques]), [['MLB1', 'Primeiro', 5], ['MLB2', 'Segundo', 4]])
  assert.deepEqual(sete.rankingCategorias.map((item) => [item.categoria, item.cliques]), [['Achados para Casa', 5], ['Achados para Elas', 4]])
  assert.deepEqual(sete.cliquesPorDia.map((item) => item.data), ['06/10/2026', '11/10/2026', '12/10/2026'])
  assert.equal(agregarCliques(linhas, catalogo, '30dias', agora).totalCliques, 19)
  assert.equal(agregarCliques(linhas, catalogo, 'todos', agora).totalCliques, 19)
  assert.equal(agregarCliques([], catalogo, 'todos', agora).produtosSemClique, 3)
  assert.equal(agregarCliques([], catalogo, 'todos', agora).rankingProdutos.length, 0)
})

test('ranking limita a dez produtos e período usa dia local brasileiro', () => {
  const muitos = Array.from({ length: 15 }, (_, i) => ({ mercadoLivreId: `MLB${i + 10}`, categoria: null, dia: '2026-10-12', cliques: i + 1 }))
  const ranking = agregarCliques(muitos, [], 'todos', agora).rankingProdutos
  assert.equal(ranking.length, 10)
  assert.deepEqual([ranking[0].mercadoLivreId, ranking[0].cliques], ['MLB24', 15])
  assert.equal(inicioPeriodo('hoje', new Date('2026-10-12T01:00:00Z')), '2026-10-11')
})

test('rotas pública e protegida validam payload, falha de banco, limite e segredo', async () => {
  const registrados = []
  let falharBanco = false
  const consultas = []
  const gateway = { async registrar(clique) { if (falharBanco) throw new Error('Segredo do banco'); registrados.push(clique) },
    async listarPorDia(inicio) { consultas.push(inicio); if (falharBanco) throw new Error('Segredo do banco'); return linhas } }
  const app = express(); app.use(express.json()); app.use('/api/valio', criarRotaValioProdutos({
    config: () => config, token: () => token, agora: () => agora, limiteCliques: 3,
    cliques: () => gateway, catalogo: () => ({ async listar() { return catalogo } }),
  }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/valio`
    const post = async (body) => { const res = await fetch(`${base}/cliques`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, json: await res.json() } }
    assert.equal((await post({ mercadoLivreId: 'MLB1', categoria: 'Achados para Casa', origem: 'vitrine' })).status, 201)
    assert.deepEqual(registrados, [{ mercadoLivreId: 'MLB1', categoria: 'Achados para Casa', origem: 'vitrine' }])
    for (const body of [{}, { mercadoLivreId: 'MLB1', categoria: 'Inválida' }, { mercadoLivreId: 'MLB1', origem: 'outro' }, { mercadoLivreId: 'MLB1', email: 'a@b.com' }])
      assert.equal((await post(body)).status, 400)
    assert.equal(registrados.length, 1)
    falharBanco = true
    const falha = await post({ mercadoLivreId: 'MLB2' })
    assert.equal(falha.status, 502)
    assert.equal(JSON.stringify(falha.json).includes('Segredo do banco'), false)
    falharBanco = false
    assert.equal((await post({ mercadoLivreId: 'MLB2' })).status, 201)
    assert.equal((await post({ mercadoLivreId: 'MLB3' })).status, 429)
    const metricas = (periodo, bearer = token) => fetch(`${base}/metricas/cliques?periodo=${periodo}`, { headers: { Authorization: `Bearer ${bearer}` } })
    assert.equal((await metricas('7dias', 'errado')).status, 401)
    assert.equal((await metricas('invalido')).status, 400)
    const resposta = await metricas('7dias')
    assert.equal(resposta.status, 200)
    const json = await resposta.json()
    assert.deepEqual([json.totalCliques, json.totalProdutosComClique, json.produtosSemClique], [9, 2, 1])
    assert.deepEqual(consultas, ['2026-10-06'])
    assert.equal(JSON.stringify(json).includes(config.serviceRoleKey), false)
    assert.equal(JSON.stringify(json).includes(token), false)
    falharBanco = true
    const falhaMetricas = await metricas('hoje')
    assert.equal(falhaMetricas.status, 502)
    assert.equal(JSON.stringify(await falhaMetricas.json()).includes('Segredo do banco'), false)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('configuração ausente retorna 503 antes do insert; entrypoint da Vercel monta a rota', async () => {
  let insercoes = 0
  const semConfig = express(); semConfig.use(express.json())
  semConfig.use('/api/valio', criarRotaValioProdutos({ config: () => null, cliques: () => ({ async registrar() { insercoes++ } }) }))
  const { default: vercelApp } = await vite.ssrLoadModule('/api/index.ts')
  const verificar = async (app, caminho, body) => {
    const server = app.listen(0, '127.0.0.1')
    try {
      await new Promise((resolve) => server.once('listening', resolve))
      const resposta = await fetch(`http://127.0.0.1:${server.address().port}${caminho}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: resposta.status, json: await resposta.json() }
    } finally { await new Promise((resolve) => server.close(resolve)) }
  }
  const indisponivel = await verificar(semConfig, '/api/valio/cliques', { mercadoLivreId: 'MLB1' })
  assert.deepEqual(indisponivel, { status: 503, json: { ok: false, erro: 'Registro de cliques indisponível.' } })
  assert.equal(insercoes, 0)
  const entradaVercel = await verificar(vercelApp, '/api/index?__route=valio/cliques', {})
  assert.equal(entradaVercel.status, 400)
  assert.match(entradaVercel.json.erro, /ITEM_ID/)
})

test('SQL manual contém somente campos mínimos e restringe leitura direta', async () => {
  const sql = await fs.readFile(new URL('../migrations/003_valio_produto_cliques.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.produto_cliques/)
  assert.match(sql, /produto_cliques_mercado_livre_id_idx/)
  assert.match(sql, /produto_cliques_clicked_at_idx/)
  assert.match(sql, /security_invoker = true/)
  assert.match(sql, /revoke all on public\.produto_cliques from public, anon, authenticated/)
  assert.doesNotMatch(sql, /\b(email|fingerprint|cookie|ip_address|user_id)\s+(text|varchar|inet|uuid)/i)
})
