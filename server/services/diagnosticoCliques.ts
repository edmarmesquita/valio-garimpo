type CamposErro = { status?: number; code?: string; message?: string; details?: string; hint?: string }

export function diagnosticarErroClique(erro: unknown, env: NodeJS.ProcessEnv = process.env): CamposErro {
  const objeto = erro && typeof erro === 'object' ? erro as Record<string, unknown> : {}
  const segredos = [env.SUPABASE_SERVICE_ROLE_KEY, env.VALIO_PUBLISH_TOKEN, env.OPENAI_API_KEY]
    .filter((valor): valor is string => typeof valor === 'string' && valor.length > 0)
  const textoSeguro = (valor: unknown) => {
    if (typeof valor !== 'string') return undefined
    let texto = valor.slice(0, 1000)
    for (const segredo of segredos) texto = texto.replaceAll(segredo, '[REDACTED]')
    return texto.replace(/sb_secret_[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
  }
  return {
    status: typeof objeto.status === 'number' ? objeto.status : undefined,
    code: textoSeguro(objeto.code), message: textoSeguro(objeto.message),
    details: textoSeguro(objeto.details), hint: textoSeguro(objeto.hint),
  }
}
