import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const arquivoCatalogo = path.resolve(raiz, '..', 'valio', 'src', 'data', 'products-legacy-backup.ts')
export const arquivoRelatorio = path.join(raiz, 'migration-reports', 'valio-produtos-migracao.json')
export const arquivoRelatorioMarkdown = path.join(raiz, 'migration-reports', 'valio-produtos-migracao.md')
const categorias = new Set(['Achados para Casa', 'Achados para Maridos', 'Achados para Elas', 'Achados para Presentear'])

function literal(no) {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text
  if (ts.isNumericLiteral(no)) return Number(no.text)
  if (no.kind === ts.SyntaxKind.TrueKeyword) return true
  if (no.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(no)) return no.elements.map(literal)
  return undefined
}

export function lerCatalogoTexto(texto) {
  const fonte = ts.createSourceFile('products-legacy-backup.ts', texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let lista
  fonte.forEachChild((no) => {
    if (!ts.isVariableStatement(no)) return
    for (const declaracao of no.declarationList.declarations) {
      if (declaracao.name.getText(fonte) === 'products' && ts.isArrayLiteralExpression(declaracao.initializer)) lista = declaracao.initializer
    }
  })
  if (!lista) throw new Error('Array products não encontrado na origem informada.')
  return lista.elements.map((elemento) => {
    if (!ts.isObjectLiteralExpression(elemento)) throw new Error('Produto fora do formato literal esperado.')
    const produto = {}
    for (const propriedade of elemento.properties) {
      if (!ts.isPropertyAssignment(propriedade)) continue
      const nome = propriedade.name.getText(fonte).replace(/^['"]|['"]$/g, '')
      produto[nome] = literal(propriedade.initializer)
    }
    return produto
  })
}

function dataValida(data) {
  if (typeof data !== 'string') return false
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data)
  if (!partes) return false
  const date = new Date(Number(partes[3]), Number(partes[2]) - 1, Number(partes[1]))
  return date.getDate() === Number(partes[1]) && date.getMonth() + 1 === Number(partes[2]) && date.getFullYear() === Number(partes[3])
}

function urlHttps(valor) {
  try { return typeof valor === 'string' && new URL(valor).protocol === 'https:' }
  catch { return false }
}

function validarMigravel(produto) {
  const faltas = []
  if (!Number.isInteger(produto.id)) faltas.push('id interno inválido')
  if (typeof produto.name !== 'string' || !produto.name.trim()) faltas.push('título ausente')
  if (typeof produto.shortDescription !== 'string') faltas.push('descrição inválida')
  if (typeof produto.price !== 'number' || !Number.isFinite(produto.price) || produto.price <= 0) faltas.push('preço numérico ausente')
  if (!dataValida(produto.priceReferenceDate)) faltas.push('data fora de dd/mm/aaaa')
  if (!urlHttps(produto.affiliateUrl)) faltas.push('link afiliado HTTPS ausente')
  if (!categorias.has(produto.category)) faltas.push('categoria do Valiô ausente ou inválida')
  if (produto.rating !== undefined && (typeof produto.rating !== 'number' || produto.rating < 0 || produto.rating > 5)) faltas.push('rating inválido')
  if (!urlHttps(produto.image)) faltas.push('imagem HTTPS ausente')
  return faltas
}

export function planejarMigracao(produtos, idsExistentes) {
  const existentes = new Set(idsExistentes)
  const vistos = new Set()
  const linhas = []
  const itens = produtos.map((produto) => {
    const base = { idInterno: produto.id ?? null, titulo: produto.name ?? null, marketplaceId: produto.marketplaceId ?? null }
    const id = typeof produto.marketplaceId === 'string' ? produto.marketplaceId.trim() : ''
    if (!id) return { ...base, status: 'semItemId', motivo: 'marketplaceId não informado; nenhum ITEM_ID foi inferido.' }
    if (!/^MLB\d+$/.test(id)) return { ...base, status: 'invalido', motivo: 'marketplaceId inválido.' }
    if (vistos.has(id)) return { ...base, status: 'invalido', motivo: 'marketplaceId duplicado no catálogo estático.' }
    vistos.add(id)
    const faltas = validarMigravel(produto)
    if (faltas.length) return { ...base, status: 'invalido', motivo: faltas.join('; ') }
    if (existentes.has(id)) return { ...base, status: 'jaExistente', motivo: 'mercado_livre_id já cadastrado no Supabase; não atualizar.' }
    const linha = {
      mercado_livre_id: id, titulo: produto.name, descricao: produto.shortDescription,
      preco: produto.price, data_preco: produto.priceReferenceDate,
      link_afiliado: produto.affiliateUrl, categoria: produto.category,
      rating: produto.rating ?? null, imagem: produto.image, ativo: true,
    }
    linhas.push(linha)
    return { ...base, status: 'migravel', motivo: 'Pronto para inserir sem alterar registros existentes.',
      priceReferenceOriginal: produto.priceReference ?? null, dadosMigracao: linha }
  })
  const contar = (status) => itens.filter((item) => item.status === status).length
  const relatorio = {
    total: itens.length, migraveis: contar('migravel'), jaExistentes: contar('jaExistente'),
    semItemId: contar('semItemId'), invalidos: contar('invalido'), produtos: itens,
  }
  return { relatorio, linhas }
}

export async function executarMigracao({ origem = arquivoCatalogo, destino = arquivoRelatorio, gateway, executar = false }) {
  const texto = await fs.readFile(origem, 'utf8')
  const produtos = lerCatalogoTexto(texto)
  const ids = [...new Set(produtos.map((produto) => produto.marketplaceId).filter((id) => typeof id === 'string' && /^MLB\d+$/.test(id)))]
  const existentes = ids.length ? await gateway.buscarExistentes(ids) : []
  const { relatorio, linhas } = planejarMigracao(produtos, existentes)
  if (executar && linhas.length) await gateway.inserirSemAtualizar(linhas)
  const final = { modo: executar ? 'execucao' : 'dry-run', ...relatorio }
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.writeFile(destino, `${JSON.stringify(final, null, 2)}\n`, 'utf8')
  const escape = (valor) => String(valor ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
  const secoes = [
    ['Migráveis', 'migravel'], ['Já existentes no Supabase', 'jaExistente'],
    ['Produtos antigos sem ITEM_ID', 'semItemId'], ['Inválidos', 'invalido'],
  ]
  const markdown = [
    '# Migração do catálogo estático do Valiô', '',
    `Modo: ${final.modo}. Nenhuma credencial está incluída neste relatório.`, '',
    `Total: ${final.total} · Migráveis: ${final.migraveis} · Já existentes: ${final.jaExistentes} · Sem ITEM_ID: ${final.semItemId} · Inválidos: ${final.invalidos}`, '',
    ...secoes.flatMap(([titulo, status]) => [
      `## ${titulo}`, '', '| ID interno | Título | marketplaceId | Motivo |', '| --- | --- | --- | --- |',
      ...final.produtos.filter((produto) => produto.status === status).map((produto) =>
        `| ${escape(produto.idInterno)} | ${escape(produto.titulo)} | ${escape(produto.marketplaceId)} | ${escape(produto.motivo)} |`),
      '',
    ]),
  ].join('\n')
  await fs.writeFile(destino.replace(/\.json$/i, '.md'), `${markdown}\n`, 'utf8')
  return final
}

function gatewaySupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no backend.')
  const cliente = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async buscarExistentes(ids) {
      const { data, error } = await cliente.from('produtos').select('mercado_livre_id').in('mercado_livre_id', ids)
      if (error) throw new Error(`Falha ao consultar IDs existentes (${error.code || 'sem código'}).`)
      return (data ?? []).map((row) => row.mercado_livre_id)
    },
    async inserirSemAtualizar(linhas) {
      const { error } = await cliente.from('produtos').upsert(linhas, { onConflict: 'mercado_livre_id', ignoreDuplicates: true })
      if (error) throw new Error(`Falha ao inserir produtos (${error.code || 'sem código'}).`)
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const executar = process.argv.includes('--execute')
  if (executar && !process.argv.includes('--confirm=INSERIR_APENAS_NOVOS')) {
    console.error('Para executar, acrescente --confirm=INSERIR_APENAS_NOVOS. Nenhum produto foi escrito.')
    process.exitCode = 1
  } else {
    try {
      const relatorio = await executarMigracao({ gateway: gatewaySupabase(), executar })
      console.log(`${relatorio.total} produtos encontrados; ${relatorio.migraveis} migráveis; ${relatorio.jaExistentes} já existentes; ${relatorio.semItemId} sem ITEM_ID; ${relatorio.invalidos} inválidos.`)
      for (const produto of relatorio.produtos) console.log(`${produto.idInterno} | ${produto.titulo} | ${produto.marketplaceId ?? 'sem ITEM_ID'} | ${produto.status} | ${produto.motivo}`)
      console.log(`Relatórios: ${arquivoRelatorio} e ${arquivoRelatorioMarkdown}`)
    } catch (erro) {
      console.error(erro instanceof Error ? erro.message : 'Falha na migração.')
      process.exitCode = 1
    }
  }
}
