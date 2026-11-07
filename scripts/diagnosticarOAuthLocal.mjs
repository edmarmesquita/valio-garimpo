import 'dotenv/config'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ conectado: false, motivo: 'DATABASE_URL ausente' }))
  process.exit(0)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
try {
  await client.connect()
  const { rows } = await client.query('SELECT to_regclass($1) AS sessions, to_regclass($2) AS attempts',
    ['public.oauth_sessions', 'public.oauth_attempts'])
  console.log(JSON.stringify({ conectado: true, tabelas: {
    oauth_sessions: Boolean(rows[0].sessions), oauth_attempts: Boolean(rows[0].attempts),
  } }))
} catch (error) {
  console.log(JSON.stringify({ conectado: false, codigo: error?.code ?? null, nome: error?.name ?? null }))
} finally {
  await client.end().catch(() => {})
}
