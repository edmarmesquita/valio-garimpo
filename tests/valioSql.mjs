import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('SQL manual cria tabela, chave única e política de leitura ativa', async () => {
  const db = await PGlite.create()
  try {
    await db.exec('create role service_role; create role anon; create role authenticated;')
    const sql = await readFile(new URL('../migrations/002_valio_produtos_supabase.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    const colunas = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'produtos'")
    assert.deepEqual(new Set(colunas.rows.map((linha) => linha.column_name)), new Set([
      'id', 'mercado_livre_id', 'titulo', 'descricao', 'preco', 'data_preco',
      'link_afiliado', 'categoria', 'rating', 'imagem', 'ativo', 'created_at', 'updated_at',
    ]))
    const campos = ['MLB1', 'Produto', '', 10, '10/10/2026', 'https://exemplo.com/?a=1#b', 'Achados para Casa', 4.8, 'https://imagem.exemplo/1.webp']
    await db.query('insert into public.produtos (mercado_livre_id, titulo, descricao, preco, data_preco, link_afiliado, categoria, rating, imagem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', campos)
    await db.query('insert into public.produtos (mercado_livre_id, titulo, descricao, preco, data_preco, link_afiliado, categoria, rating, imagem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (mercado_livre_id) do update set preco = excluded.preco', [...campos.slice(0, 3), 20, ...campos.slice(4)])
    const resultado = await db.query('select count(*)::int as total, max(preco)::numeric as preco from public.produtos')
    assert.equal(resultado.rows[0].total, 1)
    assert.equal(Number(resultado.rows[0].preco), 20)
    const politica = await db.query("select qual from pg_policies where schemaname = 'public' and tablename = 'produtos' and policyname = 'produtos_ativos_publicos'")
    assert.match(politica.rows[0].qual, /ativo = true/)
  } finally { await db.close() }
})
