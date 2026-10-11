import { createHash, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { criarConsultaProdutosGateway, criarProdutosGateway, getSupabaseConfig, publicarProduto } from './services/supabase.js'
import type { ConsultaProdutosGateway, ProdutosGateway, SupabaseConfig } from './services/supabase.js'
import { validarProdutoPublicacao } from './valioProduto.js'

type Dependencias = {
  config?: () => SupabaseConfig | null
  gateway?: (config: SupabaseConfig) => ProdutosGateway
  consulta?: (config: SupabaseConfig) => ConsultaProdutosGateway
  token?: () => string | undefined
}

function tokenValido(informado: string | undefined, esperado: string): boolean {
  if (!informado) return false
  const hashInformado = createHash('sha256').update(informado).digest()
  const hashEsperado = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(hashInformado, hashEsperado)
}

export function criarRotaValioProdutos(deps: Dependencias = {}) {
  const router = Router()
  function autorizar(req: import('express').Request, res: import('express').Response): SupabaseConfig | null {
    const config = (deps.config ?? getSupabaseConfig)()
    const esperado = (deps.token ?? (() => process.env.VALIO_PUBLISH_TOKEN))()?.trim()
    if (!config || !esperado || esperado.length < 32 || esperado === config.serviceRoleKey) {
      res.status(503).json({ ok: false, erro: 'Publicação no Valiô não configurada no servidor.' })
      return null
    }
    const authorization = req.get('authorization')
    const informado = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    if (!tokenValido(informado, esperado)) {
      res.status(401).json({ ok: false, erro: 'Token de publicação inválido.' })
      return null
    }
    return config
  }
  router.post('/produtos/verificar', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const entrada = req.body?.mercadoLivreIds
    if (!Array.isArray(entrada) || entrada.some((id) => typeof id !== 'string')) {
      res.status(400).json({ ok: false, erro: 'Envie mercadoLivreIds como lista de IDs.' })
      return
    }
    const ids = [...new Set(entrada.map((id: string) => id.trim()).filter(Boolean))]
    if (ids.length > 500 || ids.some((id) => !/^MLB\d+$/.test(id))) {
      res.status(400).json({ ok: false, erro: 'Envie até 500 ITEM_IDs válidos.' })
      return
    }
    if (!ids.length) { res.json({ ok: true, existentes: [] }); return }
    try {
      const existentes = await (deps.consulta ?? criarConsultaProdutosGateway)(config).consultarExistentes(ids)
      res.json({ ok: true, existentes })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível verificar os produtos no Valiô.' })
    }
  })
  router.post('/produtos', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    let produto
    try { produto = validarProdutoPublicacao(req.body) }
    catch (erro) {
      res.status(400).json({ ok: false, erro: erro instanceof Error ? erro.message : 'Produto inválido.' })
      return
    }
    try {
      const gateway = (deps.gateway ?? criarProdutosGateway)(config)
      const acao = await publicarProduto(produto, gateway)
      res.json({ ok: true, acao })
    } catch {
      res.status(502).json({ ok: false, erro: 'Falha ao publicar no Valiô. Confira a configuração e tente novamente.' })
    }
  })
  return router
}
