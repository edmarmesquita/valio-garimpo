import { ehLinkOficialParaAtualizacao } from '../src/lib/linksAfiliados.js'
import type { LinkAfiliadoGateway } from './services/supabase.js'
import { ErroDestinoAfiliado, validarDestinoAfiliado, type ValidarDestino } from './validarDestinoAfiliado.js'

export type LinhaPreviaLink = {
  linha: number
  mercado_livre_id: string | null
  link_novo: string | null
  titulo: string | null
  link_anterior: string | null
  motivo: string | null
}
export type ConfirmacaoLink = { linha: number; mercado_livre_id: string; link_anterior: string }
export type FalhaLink = { linha: number; mercado_livre_id: string | null; motivo: string }

type LinhaEntrada = { linha: number; mercado_livre_id: string | null; link_novo: string | null; motivo: string | null }

export function analisarLinhasLinks(texto: unknown): LinhaEntrada[] {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 100_000) {
    throw new Error('Informe de 1 a 50 linhas no formato ITEM_ID | link oficial.')
  }
  const linhas = texto.split(/\r?\n/).map((conteudo, indice) => ({ conteudo: conteudo.trim(), linha: indice + 1 }))
    .filter((item) => item.conteudo)
  if (linhas.length > 50) throw new Error('O lote aceita no máximo 50 linhas. Nenhum link foi alterado.')
  const entradas = linhas.map(({ conteudo, linha }) => {
    const partes = conteudo.split('|')
    const id = partes[0]?.trim() || null
    const link = partes.length === 2 ? partes[1].trim() || null : null
    let motivo: string | null = null
    if (partes.length !== 2) motivo = 'Use ITEM_ID | link oficial, com um único separador.'
    else if (!id || !/^MLB\d+$/.test(id)) motivo = 'ITEM_ID inválido; use MLB seguido de números.'
    else if (!link || !ehLinkOficialParaAtualizacao(link)) motivo = 'Link inválido; use HTTPS meli.la ou /social/ com rastreamento.'
    return { linha, mercado_livre_id: id, link_novo: link, motivo }
  })
  const frequencia = new Map<string, number>()
  for (const item of entradas) if (item.mercado_livre_id && /^MLB\d+$/.test(item.mercado_livre_id)) {
    frequencia.set(item.mercado_livre_id, (frequencia.get(item.mercado_livre_id) ?? 0) + 1)
  }
  return entradas.map((item) => item.mercado_livre_id && frequencia.get(item.mercado_livre_id)! > 1
    ? { ...item, motivo: 'ITEM_ID duplicado neste lote.' } : item)
}

export async function criarPreviaLinks(texto: unknown, gateway: LinkAfiliadoGateway, validar: ValidarDestino = validarDestinoAfiliado) {
  const entradas = analisarLinhasLinks(texto)
  const linhas: LinhaPreviaLink[] = await Promise.all(entradas.map(async (item) => {
    const base = { ...item, titulo: null, link_anterior: null }
    if (item.motivo || !item.mercado_livre_id) return base
    try {
      await validar(item.mercado_livre_id, item.link_novo!, 'gerador-ou-links-lote:previa')
      const encontrados = await gateway.buscar(item.mercado_livre_id)
      if (!encontrados.length) return { ...base, motivo: 'Produto não encontrado; nenhum cadastro será criado.' }
      if (encontrados.length !== 1) return { ...base, motivo: 'Mais de um produto corresponde ao ITEM_ID.' }
      const encontrado = encontrados[0]
      return { ...base, titulo: encontrado.titulo, link_anterior: encontrado.link_afiliado,
        motivo: encontrado.link_afiliado === item.link_novo ? 'Este link já está salvo.' : null }
    } catch (erro) { return { ...base, motivo: erro instanceof ErroDestinoAfiliado ? erro.message : 'Não foi possível consultar este produto.' } }
  }))
  return { solicitadas: linhas.length, linhas }
}

export function validarConfirmacoes(valor: unknown): ConfirmacaoLink[] {
  if (!Array.isArray(valor) || valor.length > 50) throw new Error('Confirmações inválidas.')
  const numeros = new Set<number>()
  for (const item of valor) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).length !== 3 || !Number.isSafeInteger(item.linha) || item.linha < 1
      || typeof item.mercado_livre_id !== 'string' || !/^MLB\d+$/.test(item.mercado_livre_id)
      || typeof item.link_anterior !== 'string' || !item.link_anterior
      || numeros.has(item.linha)) throw new Error('Confirmações inválidas.')
    numeros.add(item.linha)
  }
  return valor as ConfirmacaoLink[]
}

export async function confirmarLinksLote(texto: unknown, confirmacoes: unknown, gateway: LinkAfiliadoGateway,
  validar: ValidarDestino = validarDestinoAfiliado) {
  const entradas = analisarLinhasLinks(texto)
  const porLinha = new Map(validarConfirmacoes(confirmacoes).map((item) => [item.linha, item]))
  const resultados = await Promise.all(entradas.map(async (item): Promise<{ id: string | null; falha: FalhaLink | null }> => {
    const id = item.mercado_livre_id
    const falhar = (motivo: string) => ({ id: null, falha: { linha: item.linha, mercado_livre_id: id, motivo } })
    if (item.motivo || !id || !item.link_novo) return falhar(item.motivo ?? 'Linha inválida.')
    const confirmacao = porLinha.get(item.linha)
    if (!confirmacao || confirmacao.mercado_livre_id !== id) return falhar('Linha sem confirmação da prévia.')
    try {
      const encontrados = await gateway.buscar(id)
      if (!encontrados.length) return falhar('Produto não encontrado; nenhum cadastro foi criado.')
      if (encontrados.length !== 1) return falhar('Mais de um produto corresponde ao ITEM_ID.')
      if (encontrados[0].link_afiliado !== confirmacao.link_anterior) return falhar('O link mudou desde a prévia; revise novamente.')
      if (encontrados[0].link_afiliado === item.link_novo) return falhar('Este link já está salvo.')
      await validar(id, item.link_novo, 'atualizacao:lote-confirmacao')
      const atualizados = await gateway.atualizar(id, confirmacao.link_anterior, item.link_novo)
      if (atualizados.length !== 1 || atualizados[0].mercado_livre_id !== id
        || atualizados[0].link_afiliado !== item.link_novo) return falhar('Atualização não confirmada; confira o cadastro.')
      return { id, falha: null }
    } catch (erro) { return falhar(erro instanceof ErroDestinoAfiliado ? erro.message : 'Não foi possível atualizar este produto.') }
  }))
  const idsAtualizados = resultados.flatMap((item) => item.id ? [item.id] : [])
  const falhas = resultados.flatMap((item) => item.falha ? [item.falha] : [])
  return { solicitadas: entradas.length, atualizadas: idsAtualizados.length, erros: falhas.length, idsAtualizados, falhas }
}
