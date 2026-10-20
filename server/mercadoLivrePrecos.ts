import { Router } from 'express'
import { getMercadoLivreConfig, type MercadoLivreConfig } from './mercadoLivreConfig.js'
import { assertEncryptionConfigured, hashOpaque } from './mercadoLivreCrypto.js'
import { getBackendAccessToken } from './mercadoLivreTokenService.js'
import { consultarPrecoAtual, type PrecoConsultado } from './mercadoLivrePrecoAtual.js'

const router = Router()

export async function consultarGrupoLimitado(ids: string[], token: string,
  consultar: typeof consultarPrecoAtual = consultarPrecoAtual): Promise<PrecoConsultado[]> {
  const resultados: PrecoConsultado[] = new Array(ids.length)
  let proximo = 0
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (proximo < ids.length) {
      const indice = proximo++
      resultados[indice] = await consultar(ids[indice], token)
    }
  }))
  return resultados
}

export async function consultarComRenovacao(ids: string[], sessionHash: string, config: MercadoLivreConfig,
  obterToken: typeof getBackendAccessToken = getBackendAccessToken,
  consultar: typeof consultarPrecoAtual = consultarPrecoAtual): Promise<
    { tipo: 'ok'; resultados: PrecoConsultado[] } | { tipo: 'sem_sessao' | 'rejeitada' }
  > {
  let refreshExecutado = false
  let refreshBemSucedido: boolean | null = null
  const registrarRefresh = (bemSucedido: boolean) => {
    refreshExecutado = true
    refreshBemSucedido = bemSucedido
  }
  const anotarRefresh = (resultado: PrecoConsultado) => {
    if (resultado.diagnostico) {
      resultado.diagnostico.refreshExecutado = refreshExecutado
      resultado.diagnostico.refreshBemSucedido = refreshBemSucedido
    }
  }
  let token = await obterToken(sessionHash, config, undefined, registrarRefresh)
  if (!token) return { tipo: 'sem_sessao' }
  const resultados = await consultarGrupoLimitado(ids, token, consultar)
  resultados.forEach(anotarRefresh)
  if (resultados.some((item) => item.autenticacaoExpirada)) {
    token = await obterToken(sessionHash, config, token, registrarRefresh)
    if (!token) return { tipo: 'sem_sessao' }
    for (const [indice, resultado] of resultados.entries()) {
      if (resultado.autenticacaoExpirada) {
        resultados[indice] = await consultar(resultado.itemId, token)
        anotarRefresh(resultados[indice])
      }
    }
  }
  return resultados.some((item) => item.autenticacaoExpirada) ? { tipo: 'rejeitada' } : { tipo: 'ok', resultados }
}

router.post('/precos/consultar', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const ids = req.body?.itemIds
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || ids.some((id) => typeof id !== 'string' || !/^MLB\d+$/.test(id))
    || new Set(ids).size !== ids.length) {
    res.status(400).json({ ok: false, erro: 'Envie de 1 a 5 ITEM_IDs únicos.' })
    return
  }
  const sessionId = req.get('cookie')?.split(';').map((parte) => parte.trim())
    .find((parte) => parte.startsWith('meli_oauth_session='))?.slice('meli_oauth_session='.length)
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
    res.status(401).json({ ok: false, erro: 'Conecte sua conta do Mercado Livre para consultar preços.' })
    return
  }
  try {
    const config = getMercadoLivreConfig()
    if (!config) throw new Error('OAuth indisponível')
    assertEncryptionConfigured()
    const consulta = await consultarComRenovacao(ids, hashOpaque(sessionId), config)
    if (consulta.tipo !== 'ok') {
      res.status(401).json({ ok: false, erro: consulta.tipo === 'rejeitada'
        ? 'Sessão do Mercado Livre rejeitada. Conecte novamente.'
        : 'Sessão do Mercado Livre expirada. Conecte novamente.' })
      return
    }
    const diagnosticoHabilitado = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'
    res.json({ ok: true, resultados: consulta.resultados.map(({ itemId, situacao, preco, motivo, diagnostico }) => ({
      itemId, situacao, preco, motivo, ...(diagnosticoHabilitado && diagnostico ? { diagnostico } : {}),
    })) })
  } catch {
    res.status(503).json({ ok: false, erro: 'Não foi possível consultar a fonte oficial de preços.' })
  }
})

export default router
