import type { Router } from 'express'
import { criarCatalogoGateway } from '../services/supabase.js'
import type { ContextoRotas } from './contexto.js'

type PrecoLote = { mercadoLivreId: string; preco: number; atualizarPreco: boolean }
function validarPrecosLote(corpo: unknown): PrecoLote[] | null {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null
  const entrada = corpo as Record<string, unknown>
  if (Object.keys(entrada).length !== 1 || !Array.isArray(entrada.produtos) || !entrada.produtos.length || entrada.produtos.length > 50) return null
  const ids = new Set<string>()
  const produtos: PrecoLote[] = []
  for (const bruto of entrada.produtos) {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
    const item = bruto as Record<string, unknown>
    if (Object.keys(item).length !== 3 || typeof item.mercadoLivreId !== 'string' || !/^MLB\d+$/.test(item.mercadoLivreId)
      || typeof item.preco !== 'number' || !Number.isFinite(item.preco) || item.preco <= 0
      || typeof item.atualizarPreco !== 'boolean' || ids.has(item.mercadoLivreId)) return null
    ids.add(item.mercadoLivreId)
    produtos.push(item as PrecoLote)
  }
  return produtos
}


export function registrarPrecos(router: Router, { deps, autorizar }: ContextoRotas) {

  router.patch('/produtos/precos-lote', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const produtos = validarPrecosLote(req.body)
    if (!produtos) { res.status(400).json({ ok: false, erro: 'Envie de 1 a 50 produtos com ITEM_ID, preço e atualizarPreco, sem duplicatas.' }); return }
    const agora = (deps.agora ?? (() => new Date()))()
    const dataPreco = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora)
    const updatedAt = agora.toISOString()
    const gateway = (deps.catalogo ?? criarCatalogoGateway)(config)
    const resultados: { mercadoLivreId: string; status: 'atualizado' | 'confirmado' | 'erro'; erro?: string; dataPreco?: string; updatedAt?: string }[] = []
    for (let inicio = 0; inicio < produtos.length; inicio += 5) {
      const bloco = produtos.slice(inicio, inicio + 5)
      resultados.push(...await Promise.all(bloco.map(async (produto) => {
        try {
          const encontrado = await gateway.atualizarPreco(produto.mercadoLivreId, produto.preco, dataPreco, updatedAt, !produto.atualizarPreco)
          return encontrado
            ? { mercadoLivreId: produto.mercadoLivreId, status: produto.atualizarPreco ? 'atualizado' as const : 'confirmado' as const, dataPreco, updatedAt }
            : { mercadoLivreId: produto.mercadoLivreId, status: 'erro' as const, erro: produto.atualizarPreco ? 'Produto não encontrado.' : 'Produto não encontrado ou preço salvo diferente.' }
        } catch { return { mercadoLivreId: produto.mercadoLivreId, status: 'erro' as const, erro: 'Falha ao atualizar o produto.' } }
      })))
    }
    const atualizados = resultados.filter((item) => item.status === 'atualizado').length
    const confirmados = resultados.filter((item) => item.status === 'confirmado').length
    res.json({ ok: true, atualizados, confirmados, erros: resultados.length - atualizados - confirmados, resultados })
  })
}
