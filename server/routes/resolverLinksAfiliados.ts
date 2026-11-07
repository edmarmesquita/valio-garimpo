import type { Router } from 'express'
import { criarConsultaProdutosGateway } from '../services/supabase.js'
import { resolverLoteAfiliado } from '../resolverLinksAfiliados.js'
import type { ContextoRotas } from './contexto.js'

export function registrarResolucaoLinks(router: Router, { deps, autorizar }: ContextoRotas) {
  router.post('/afiliados/resolver-links', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const links = req.body?.links
    if (!Array.isArray(links) || links.length < 1 || links.length > 30 ||
      links.some((link) => typeof link !== 'string' || link.length > 4096)) {
      res.status(400).json({ ok: false, erro: 'Envie de 1 a 30 links meli.la.' }); return
    }
    try {
      const consultar = (deps.consulta ?? criarConsultaProdutosGateway)(config).consultarExistentes
      const produtos = await resolverLoteAfiliado(links, consultar)
      res.json({ ok: true, produtos })
    } catch {
      res.status(502).json({ ok: false, erro: 'Não foi possível consultar o catálogo do Valiô.' })
    }
  })
}
