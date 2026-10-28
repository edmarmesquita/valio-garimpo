import type { Router } from 'express'
import { criarReativacaoGateway } from '../services/supabase.js'
import type { ContextoRotas } from './contexto.js'

type Pedido = { mercado_livre_id: string; item_id_capturado: string; preco: number; moeda: 'BRL' }
const idValido = (id: unknown): id is string => typeof id === 'string' && /^MLB\d+$/.test(id)
const precoValido = (preco: unknown): preco is number => typeof preco === 'number' && Number.isFinite(preco)
  && preco > 0 && Math.abs(Math.round(preco * 100) - preco * 100) < 1e-7

export function registrarReativacaoInativos(router: Router, { deps, autorizar }: ContextoRotas) {
  router.post('/produtos/reativar-inativos', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const produtos = req.body?.produtos
    if (!Array.isArray(produtos) || produtos.length === 0 || produtos.length > 100) {
      res.status(400).json({ ok: false, erro: 'Envie de 1 a 100 produtos.' })
      return
    }
    const gateway = (deps.reativacao ?? criarReativacaoGateway)(config)
    const vistos = new Set<string>()
    const resultados: { mercado_livre_id: string; status: 'REATIVADO' | 'ERRO'; motivo?: string }[] = []
    for (const entrada of produtos as unknown[]) {
      const item = entrada as Partial<Pedido> | null
      const id = typeof item?.mercado_livre_id === 'string' ? item.mercado_livre_id : ''
      let motivo = ''
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).sort().join(',') !== 'item_id_capturado,mercado_livre_id,moeda,preco'
        || !idValido(id) || !idValido(item.item_id_capturado) || id !== item.item_id_capturado) {
        motivo = 'ITEM_ID da captura deve ser exatamente o ITEM_ID do registro.'
      } else if (vistos.has(id)) motivo = 'ITEM_ID repetido no lote.'
      else if (item.moeda !== 'BRL') motivo = 'Moeda diferente de BRL.'
      else if (!precoValido(item.preco)) motivo = 'Preço inválido.'
      vistos.add(id)
      if (!motivo) {
        try {
          const salvo = await gateway.buscar(id)
          if (!salvo) motivo = 'Produto não encontrado.'
          else if (salvo.mercado_livre_id !== id) motivo = 'ITEM_ID do registro não corresponde à captura.'
          else if (salvo.ativo) motivo = 'Produto já está ativo.'
          else if (!Number.isSafeInteger(salvo.id)) motivo = 'Identidade interna inválida.'
          else {
            const atualizado = await gateway.reativar(id, salvo.id, item!.preco!, (deps.agora ?? (() => new Date()))().toISOString())
            if (!atualizado) {
              const atual = await gateway.buscar(id)
              motivo = atual?.ativo ? 'Produto já está ativo.' : 'Produto mudou durante a revalidação.'
            }
          }
        } catch { motivo = 'Falha ao revalidar ou reativar produto.' }
      }
      resultados.push(motivo ? { mercado_livre_id: id, status: 'ERRO', motivo }
        : { mercado_livre_id: id, status: 'REATIVADO' })
    }
    res.json({ ok: true, reativados: resultados.filter((item) => item.status === 'REATIVADO').length,
      erros: resultados.filter((item) => item.status === 'ERRO').length, resultados })
  })
}
