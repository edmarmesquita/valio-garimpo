import pg from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'

let pool: pg.Pool | undefined

function getPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) throw new Error('DATABASE_URL ausente')

  pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  })

  // Impede que erros de conexões ociosas derrubem a função; não registra a URL.
  pool.on('error', () => console.error('Conexão ociosa do banco OAuth indisponível.'))
  return pool
}

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
  return getPool().query<T>(sql, params)
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
