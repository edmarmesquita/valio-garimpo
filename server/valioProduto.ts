export const CATEGORIAS_VALIO = [
  'Achados para Casa',
  'Achados para Maridos',
  'Achados para Elas',
  'Achados para Presentear',
] as const

export type CategoriaValio = typeof CATEGORIAS_VALIO[number]
export type ProdutoPublicacao = {
  mercadoLivreId: string
  titulo: string
  descricao: string
  preco: number
  dataPreco: string
  linkAfiliado: string
  categoria: CategoriaValio
  rating: number | null
  imagem: string
}

type Registro = Record<string, unknown>
const CHAVES = new Set([
  'mercadoLivreId', 'titulo', 'descricao', 'preco', 'dataPreco',
  'linkAfiliado', 'categoria', 'rating', 'imagem',
])

function urlHttps(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false
  try { return new URL(valor).protocol === 'https:' }
  catch { return false }
}

function dataBrasileira(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor)
  if (!partes) return false
  const dia = Number(partes[1]); const mes = Number(partes[2]); const ano = Number(partes[3])
  const data = new Date(ano, mes - 1, dia)
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia
}

export function validarProdutoPublicacao(entrada: unknown): ProdutoPublicacao {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw new Error('Envie um produto em formato JSON.')
  const dados = entrada as Registro
  if (Object.keys(dados).some((chave) => !CHAVES.has(chave))) throw new Error('O produto contém campos não permitidos.')
  if (typeof dados.mercadoLivreId !== 'string' || !/^MLB\d+$/.test(dados.mercadoLivreId)) throw new Error('mercadoLivreId obrigatório ou inválido.')
  if (typeof dados.titulo !== 'string' || !dados.titulo.trim()) throw new Error('titulo obrigatório.')
  if (dados.descricao !== undefined && typeof dados.descricao !== 'string') throw new Error('descricao inválida.')
  if (typeof dados.preco !== 'number' || !Number.isFinite(dados.preco) || dados.preco <= 0) throw new Error('preco obrigatório ou inválido.')
  if (!dataBrasileira(dados.dataPreco)) throw new Error('dataPreco deve estar em dd/mm/aaaa.')
  if (!urlHttps(dados.linkAfiliado)) throw new Error('linkAfiliado HTTPS obrigatório ou inválido.')
  if (!CATEGORIAS_VALIO.includes(dados.categoria as CategoriaValio)) throw new Error('categoria inválida.')
  if (dados.rating !== undefined && dados.rating !== null && (typeof dados.rating !== 'number' || !Number.isFinite(dados.rating) || dados.rating < 0 || dados.rating > 5)) throw new Error('rating inválido.')
  if (!urlHttps(dados.imagem)) throw new Error('imagem HTTPS obrigatória ou inválida.')
  return {
    mercadoLivreId: dados.mercadoLivreId,
    titulo: dados.titulo,
    descricao: dados.descricao ?? '',
    preco: dados.preco,
    dataPreco: dados.dataPreco,
    linkAfiliado: dados.linkAfiliado,
    categoria: dados.categoria as CategoriaValio,
    rating: dados.rating ?? null,
    imagem: dados.imagem,
  }
}
