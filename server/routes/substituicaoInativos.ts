import type { Router } from 'express'
import { CATEGORIAS_VALIO } from '../valioProduto.js'
import { ErroDestinoAfiliado, validarDestinoAfiliado } from '../validarDestinoAfiliado.js'
import { criarSubstituicaoGateway } from '../services/supabase.js'
import type { ContextoRotas } from './contexto.js'

type Pedido = {
  confirmar: true; id_interno: number; item_id_anterior: string; mercado_livre_id: string
  titulo: string; descricao: string; preco: number; moeda: 'BRL'; imagem: string
  link_afiliado: string; categoria?: string
}
const idValido = (valor: unknown): valor is string => typeof valor === 'string' && /^MLB\d+$/.test(valor)
const urlHttps = (valor: unknown): valor is string => {
  if (typeof valor !== 'string') return false
  try { const url = new URL(valor); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}
const imagemMercadoLivre = (valor: unknown): valor is string => {
  if (!urlHttps(valor)) return false
  const hostname = new URL(valor).hostname
  return hostname === 'mlstatic.com' || hostname.endsWith('.mlstatic.com')
}
const linkAfiliadoMeliLa = (valor: unknown): valor is string => {
  if (!urlHttps(valor)) return false
  try { const url = new URL(valor); return url.hostname === 'meli.la' && Boolean(url.pathname.slice(1)) }
  catch { return false }
}
const precoValido = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor)
  && valor > 0 && Math.abs(Math.round(valor * 100) - valor * 100) < 1e-7

export function registrarSubstituicaoInativos(router: Router, { deps, autorizar }: ContextoRotas) {
  router.post('/produtos/substituir-inativo', async (req, res) => {
    const config = autorizar(req, res)
    if (!config) return
    const item = req.body as Partial<Pedido> | null
    const chaves = ['confirmar', 'id_interno', 'item_id_anterior', 'mercado_livre_id', 'titulo', 'descricao',
      'preco', 'moeda', 'imagem', 'link_afiliado']
    if (item?.categoria !== undefined) chaves.push('categoria')
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== chaves.sort().join(',')
      || item.confirmar !== true || !Number.isSafeInteger(item.id_interno) || item.id_interno! <= 0
      || !idValido(item.item_id_anterior) || !idValido(item.mercado_livre_id)
      || item.item_id_anterior === item.mercado_livre_id
      || typeof item.titulo !== 'string' || !item.titulo.trim() || item.titulo.length > 500
      || typeof item.descricao !== 'string' || item.descricao.length > 20_000
      || !precoValido(item.preco) || item.moeda !== 'BRL'
      || !imagemMercadoLivre(item.imagem) || !linkAfiliadoMeliLa(item.link_afiliado)
      || (item.categoria !== undefined && !CATEGORIAS_VALIO.includes(item.categoria as typeof CATEGORIAS_VALIO[number]))) {
      res.status(400).json({ ok: false, erro: 'Dados de substituição inválidos ou confirmação explícita ausente.' })
      return
    }

    try {
      const validar = deps.validarDestino ?? ((id, link, origem) =>
        validarDestinoAfiliado(id, link, origem, deps.resolverDestino))
      await validar(item.mercado_livre_id, item.link_afiliado, 'recuperacao-inativos:substituicao')
      const gateway = (deps.substituicao ?? criarSubstituicaoGateway)(config)
      const anterior = await gateway.buscarPorId(item.id_interno!)
      if (!anterior) { res.status(404).json({ ok: false, erro: 'Registro interno não encontrado.' }); return }
      if (anterior.ativo) { res.status(409).json({ ok: false, erro: 'O produto antigo já está ativo; recarregue a análise.' }); return }
      if (anterior.mercado_livre_id !== item.item_id_anterior) {
        res.status(409).json({ ok: false, erro: 'O produto mudou desde a prévia; recarregue a análise.' }); return
      }
      if (await gateway.existeOutro(item.mercado_livre_id!, item.id_interno!)) {
        res.status(409).json({ ok: false, erro: 'O novo ITEM_ID já existe em outro registro.' }); return
      }
      const agora = (deps.agora ?? (() => new Date()))()
      const dataPreco = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora)
      const categoria = item.categoria ?? anterior.categoria
      const atualizado = await gateway.substituir({ id: item.id_interno!, itemIdAnterior: item.item_id_anterior!,
        itemIdNovo: item.mercado_livre_id!, titulo: item.titulo!.trim(), descricao: item.descricao!,
        preco: item.preco!, dataPreco, linkAfiliado: item.link_afiliado!, imagem: item.imagem!, categoria,
        updatedAt: agora.toISOString() })
      if (!atualizado) { res.status(409).json({ ok: false, erro: 'O registro mudou durante a confirmação; nenhuma substituição foi aplicada.' }); return }
      res.json({ ok: true, id_interno: item.id_interno, mercado_livre_id: item.mercado_livre_id })
    } catch (erro) {
      if (erro instanceof ErroDestinoAfiliado) { res.status(erro.status).json({ ok: false, erro: erro.message }); return }
      if ((erro as { code?: string })?.code === '23505') {
        res.status(409).json({ ok: false, erro: 'O novo ITEM_ID passou a existir em outro registro; nenhuma substituição foi aplicada.' }); return
      }
      res.status(502).json({ ok: false, erro: 'Falha ao revalidar ou substituir o produto inativo.' })
    }
  })
}
