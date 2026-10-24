import type { ProdutoAfiliado } from './extrairProdutosAfiliados'
import type { CategoriaValio } from './produtosGarimpados'
import { ehLinkOficialParaAtualizacao } from './linksAfiliados'

export type ProdutoCatalogo = {
  mercadoLivreId: string; titulo: string; preco: number; dataPreco: string
  categoria: CategoriaValio; linkAfiliado: string; imagem: string
  rating: number | null; ativo: boolean; updatedAt: string
  ofertaRelampago?: boolean; ofertaInicio?: string | null; ofertaFim?: string | null
}
export type FiltroVitrine = 'todos' | 'ativos' | 'inativos' | 'atualizados' | 'revisar-breve' | 'precisa-revisao' | 'revisar-catalogo'
export type OrdemVitrine = 'antigos' | 'recentes' | 'menor-preco' | 'maior-preco' | 'categoria'
export type IdadePreco = 'Atualizado' | 'Revisar em breve' | 'Precisa revisão'

export function classificarIdadePreco(data: string, hoje = new Date()): IdadePreco {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data)
  if (!partes) return 'Precisa revisão'
  const dia = Number(partes[1]); const mes = Number(partes[2]); const ano = Number(partes[3])
  const preco = new Date(ano, mes - 1, dia)
  if (preco.getFullYear() !== ano || preco.getMonth() + 1 !== mes || preco.getDate() !== dia) return 'Precisa revisão'
  const inicioPreco = Date.UTC(ano, mes - 1, dia)
  const inicioHoje = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const dias = Math.round((inicioHoje - inicioPreco) / 86_400_000)
  if (dias < 0) return 'Precisa revisão'
  return dias <= 7 ? 'Atualizado' : dias <= 15 ? 'Revisar em breve' : 'Precisa revisão'
}

export function compararComLote(produto: ProdutoCatalogo, extraido?: ProdutoAfiliado, categoria?: CategoriaValio) {
  if (!extraido) return { encontrado: false, precoAlterado: false, camposAlterados: [] as string[] }
  const precoAlterado = extraido.precoAtual !== null && Math.round(extraido.precoAtual * 100) !== Math.round(produto.preco * 100)
  const camposAlterados = [
    ...(extraido.titulo && extraido.titulo !== produto.titulo ? ['título'] : []),
    ...(extraido.imagemUrl && extraido.imagemUrl !== produto.imagem ? ['imagem'] : []),
    ...(extraido.linkOriginal && extraido.linkOriginal !== produto.linkAfiliado ? ['link'] : []),
    ...(categoria && categoria !== produto.categoria ? ['categoria'] : []),
  ]
  return { encontrado: true, precoAlterado, camposAlterados }
}

export function analisarCatalogo(produtos: ProdutoCatalogo[], lote: ProdutoAfiliado[] | null,
  categorias: ReadonlyMap<number, CategoriaValio>, hoje = new Date()) {
  const indices = new Map((lote ?? []).map((produto, indice) => [produto.itemId, indice]))
  return produtos.map((produto) => {
    const indice = indices.get(produto.mercadoLivreId)
    const comparacao = compararComLote(produto, indice === undefined ? undefined : lote![indice], indice === undefined ? undefined : categorias.get(indice))
    return { produto, idade: classificarIdadePreco(produto.dataPreco, hoje), ...comparacao }
  })
}

export type ItemAnalisado = ReturnType<typeof analisarCatalogo>[number]

export function resumirCatalogo(itens: ItemAnalisado[]) {
  return {
    ativos: itens.filter((item) => item.produto.ativo).length,
    inativos: itens.filter((item) => !item.produto.ativo).length,
    atualizados: itens.filter((item) => item.idade === 'Atualizado').length,
    precisamRevisao: itens.filter((item) => item.idade === 'Precisa revisão').length,
    precosAlterados: itens.filter((item) => item.precoAlterado).length,
  }
}

function prioridadeRevisao(item: ItemAnalisado) {
  if (item.idade === 'Precisa revisão') return 0
  if (item.precoAlterado) return 1
  if (!item.produto.ativo) return 2
  if (item.camposAlterados.length) return 3
  return 4
}

export function filtrarCatalogo(itens: ItemAnalisado[], filtro: FiltroVitrine, ordem: OrdemVitrine): ItemAnalisado[] {
  const filtrados = itens.filter((item) => {
    switch (filtro) {
      case 'ativos': return item.produto.ativo
      case 'inativos': return !item.produto.ativo
      case 'atualizados': return item.idade === 'Atualizado'
      case 'revisar-breve': return item.idade === 'Revisar em breve'
      case 'precisa-revisao': return item.idade === 'Precisa revisão'
      case 'revisar-catalogo': return prioridadeRevisao(item) < 4
      default: return true
    }
  })
  return filtrados.sort((a, b) => {
    if (filtro === 'revisar-catalogo') {
      const prioridade = prioridadeRevisao(a) - prioridadeRevisao(b)
      if (prioridade) return prioridade
    }
    switch (ordem) {
      case 'antigos': return compararDatas(a.produto.dataPreco, b.produto.dataPreco)
      case 'recentes': return compararDatas(b.produto.dataPreco, a.produto.dataPreco)
      case 'menor-preco': return a.produto.preco - b.produto.preco
      case 'maior-preco': return b.produto.preco - a.produto.preco
      case 'categoria': return a.produto.categoria.localeCompare(b.produto.categoria, 'pt-BR')
    }
  })
}

function compararDatas(a: string, b: string) {
  const chave = (data: string) => { const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data); return p ? `${p[3]}${p[2]}${p[1]}` : '' }
  return chave(a).localeCompare(chave(b))
}

async function requisitar(url: string, token: string, metodo: 'GET' | 'POST' | 'PATCH', corpo?: object, enviar: typeof fetch = fetch) {
  if (!token.trim()) throw new Error('Informe o token de publicação para acessar a vitrine.')
  let resposta: Response
  try { resposta = await enviar(url, { method: metodo, headers: {
    Authorization: `Bearer ${token.trim()}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}),
  }, ...(corpo ? { body: JSON.stringify(corpo) } : {}), cache: 'no-store' }) }
  catch { throw new Error('Não foi possível conectar à API da vitrine.') }
  let dados: unknown
  try { dados = await resposta.json() }
  catch { throw new Error(`A API respondeu HTTP ${resposta.status} sem JSON válido.`) }
  const resultado = dados && typeof dados === 'object' ? dados as Record<string, unknown> : {}
  if (!resposta.ok || resultado.ok !== true) throw new Error(typeof resultado.erro === 'string' ? resultado.erro : `A API respondeu HTTP ${resposta.status}.`)
  return resultado
}

export async function carregarCatalogo(token: string, enviar: typeof fetch = fetch): Promise<ProdutoCatalogo[]> {
  const resultado = await requisitar('/api/valio/catalogo', token, 'GET', undefined, enviar)
  if (!Array.isArray(resultado.produtos)) throw new Error('Resposta inválida do catálogo.')
  return resultado.produtos as ProdutoCatalogo[]
}

export async function alterarStatusProduto(id: string, ativo: boolean, token: string, enviar: typeof fetch = fetch) {
  await requisitar(`/api/valio/produtos/${encodeURIComponent(id)}/status`, token, 'PATCH', { ativo }, enviar)
}

export async function alterarCategoriaProduto(id: string, categoria: CategoriaValio, token: string, enviar: typeof fetch = fetch) {
  await requisitar(`/api/valio/produtos/${encodeURIComponent(id)}/categoria`, token, 'PATCH', { categoria }, enviar)
}

export type ResultadoLinkAfiliado = {
  produto: string; mercado_livre_id: string; link_anterior: string; link_afiliado: string
}

export async function atualizarLinkAfiliado(id: string, link: string, token: string, enviar: typeof fetch = fetch): Promise<ResultadoLinkAfiliado> {
  if (!/^MLB\d+$/.test(id)) throw new Error('Informe um ITEM_ID no formato MLB seguido de números.')
  if (!ehLinkOficialParaAtualizacao(link)) throw new Error('Informe um link oficial HTTPS meli.la ou /social/ com rastreamento.')
  const resultado = await requisitar('/api/valio/produtos/link-afiliado', token, 'PATCH',
    { mercado_livre_id: id, link_afiliado: link }, enviar)
  if (resultado.mercado_livre_id !== id || resultado.link_afiliado !== link
    || typeof resultado.produto !== 'string' || typeof resultado.link_anterior !== 'string') {
    throw new Error('A API não confirmou o link salvo para este produto.')
  }
  return resultado as ResultadoLinkAfiliado
}

export type LinhaPreviaLink = {
  linha: number; mercado_livre_id: string | null; link_novo: string | null
  titulo: string | null; link_anterior: string | null; motivo: string | null
}
export type FalhaSubloteLinks = { sublote: number; totalSublotes: number; etapa: 'pr\u00e9via' | 'atualiza\u00e7\u00e3o'; motivo: string }
export type PreviaLinksLote = { solicitadas: number; linhas: LinhaPreviaLink[]; falhasSublotes?: FalhaSubloteLinks[] }
export type ResultadoLinksLote = {
  solicitadas: number; atualizadas: number; erros: number; idsAtualizados: string[]
  falhas: { linha: number; mercado_livre_id: string | null; motivo: string }[]; falhasSublotes?: FalhaSubloteLinks[]
}

const MAX_LINHAS_LINKS_POR_CHAMADA = 50
type LinhaTextoLote = { linhaOriginal: number; texto: string }

function separarSublotesLinks(texto: string): LinhaTextoLote[][] {
  if (texto.length > 100_000) throw new Error('O texto do lote excede o limite de 100.000 caracteres.')
  const linhas = texto.split(/\r?\n/).map((conteudo, indice) => ({ texto: conteudo.trim(), linhaOriginal: indice + 1 }))
    .filter((item) => item.texto)
  const sublotes: LinhaTextoLote[][] = []
  for (let indice = 0; indice < linhas.length; indice += MAX_LINHAS_LINKS_POR_CHAMADA) {
    sublotes.push(linhas.slice(indice, indice + MAX_LINHAS_LINKS_POR_CHAMADA))
  }
  return sublotes
}

function lerLinhaEntrada(texto: string) {
  const partes = texto.split('|')
  return { mercado_livre_id: partes[0]?.trim() || null,
    link_novo: partes.length === 2 ? partes[1].trim() || null : null }
}

function linhaComFalha(linha: LinhaTextoLote, motivo: string): LinhaPreviaLink {
  return { linha: linha.linhaOriginal, ...lerLinhaEntrada(linha.texto), titulo: null, link_anterior: null, motivo }
}

export async function preverLinksLote(texto: string, token: string, enviar: typeof fetch = fetch): Promise<PreviaLinksLote> {
  const sublotes = separarSublotesLinks(texto)
  if (!sublotes.length) {
    const resultado = await requisitar('/api/valio/produtos/links-afiliados/previa', token, 'POST', { texto }, enviar)
    if (!Number.isInteger(resultado.solicitadas) || !Array.isArray(resultado.linhas)
      || resultado.linhas.length !== resultado.solicitadas) throw new Error('Resposta inv\u00e1lida da pr\u00e9via.')
    return resultado as PreviaLinksLote
  }

  const frequenciaIds = new Map<string, number>()
  for (const linha of sublotes.flat()) {
    const id = lerLinhaEntrada(linha.texto).mercado_livre_id
    if (id && /^MLB\d+$/.test(id)) frequenciaIds.set(id, (frequenciaIds.get(id) ?? 0) + 1)
  }
  const linhas: LinhaPreviaLink[] = []
  const falhasSublotes: FalhaSubloteLinks[] = []
  for (let indice = 0; indice < sublotes.length; indice++) {
    const sublote = sublotes[indice]
    const duplicados = sublote.filter((linha) => {
      const id = lerLinhaEntrada(linha.texto).mercado_livre_id
      return Boolean(id && /^MLB\d+$/.test(id) && frequenciaIds.get(id)! > 1)
    })
    const solicitaveis = sublote.filter((linha) => !duplicados.includes(linha))
    linhas.push(...duplicados.map((linha) => linhaComFalha(linha, 'ITEM_ID duplicado neste lote.')))
    if (!solicitaveis.length) continue
    try {
      const resultado = await requisitar('/api/valio/produtos/links-afiliados/previa', token, 'POST',
        { texto: solicitaveis.map((linha) => linha.texto).join('\n') }, enviar)
      if (!Number.isInteger(resultado.solicitadas) || resultado.solicitadas !== solicitaveis.length
        || !Array.isArray(resultado.linhas) || resultado.linhas.length !== solicitaveis.length) {
        throw new Error('Resposta inv\u00e1lida da pr\u00e9via.')
      }
      const recebidas = new Set<number>()
      const mapeadas: LinhaPreviaLink[] = []
      for (const valor of resultado.linhas as LinhaPreviaLink[]) {
        if (!valor || !Number.isInteger(valor.linha) || valor.linha < 1
          || valor.linha > solicitaveis.length || recebidas.has(valor.linha)) {
          throw new Error('Resposta inv\u00e1lida da pr\u00e9via: posi\u00e7\u00e3o ausente ou duplicada.')
        }
        const origem = solicitaveis[valor.linha - 1]
        const esperado = lerLinhaEntrada(origem.texto)
        if (valor.mercado_livre_id !== esperado.mercado_livre_id || valor.link_novo !== esperado.link_novo) {
          throw new Error('Resposta inv\u00e1lida da pr\u00e9via: ITEM_ID ou link fora de posi\u00e7\u00e3o.')
        }
        recebidas.add(valor.linha)
        mapeadas.push({ ...valor, linha: origem.linhaOriginal })
      }
      if (recebidas.size !== solicitaveis.length) throw new Error('Resposta inv\u00e1lida da pr\u00e9via: posi\u00e7\u00e3o ausente ou duplicada.')
      linhas.push(...mapeadas)
    } catch (falha) {
      const motivo = falha instanceof Error ? falha.message : 'Falha desconhecida na pr\u00e9via.'
      falhasSublotes.push({ sublote: indice + 1, totalSublotes: sublotes.length, etapa: 'pr\u00e9via', motivo })
      linhas.push(...solicitaveis.map((linha) => linhaComFalha(linha,
        `Falha na pr\u00e9via do sublote ${indice + 1} de ${sublotes.length}: ${motivo}`)))
    }
  }
  linhas.sort((a, b) => a.linha - b.linha)
  return { solicitadas: sublotes.reduce((total, sublote) => total + sublote.length, 0), linhas,
    ...(falhasSublotes.length ? { falhasSublotes } : {}) }
}

export async function confirmarLinksLote(texto: string, previa: PreviaLinksLote, token: string,
  enviar: typeof fetch = fetch): Promise<ResultadoLinksLote> {
  if (previa.falhasSublotes?.length) throw new Error('A pr\u00e9via est\u00e1 incompleta; consulte novamente os sublotes com falha antes de confirmar.')
  const sublotes = separarSublotesLinks(texto)
  if (!sublotes.length || previa.solicitadas !== sublotes.reduce((total, sublote) => total + sublote.length, 0)
    || previa.linhas.length !== previa.solicitadas) throw new Error('Pr\u00e9via inv\u00e1lida para confirma\u00e7\u00e3o.')
  const linhasPrevias = new Map(previa.linhas.map((linha) => [linha.linha, linha]))
  const idsEsperados = new Set(previa.linhas.filter((item) => !item.motivo && item.mercado_livre_id && item.link_anterior)
    .map((item) => item.mercado_livre_id!))
  if (!idsEsperados.size) throw new Error('Nenhuma linha v\u00e1lida para confirmar.')
  const idsAtualizados: string[] = []
  const falhas: ResultadoLinksLote['falhas'] = []
  const falhasSublotes: FalhaSubloteLinks[] = []
  let solicitadas = 0
  for (let indice = 0; indice < sublotes.length; indice++) {
    const sublote = sublotes[indice]
    const confirmacoes = sublote.flatMap((linha, local) => {
      const previaLinha = linhasPrevias.get(linha.linhaOriginal)
      return previaLinha && !previaLinha.motivo && previaLinha.mercado_livre_id && previaLinha.link_anterior
        ? [{ linha: local + 1, mercado_livre_id: previaLinha.mercado_livre_id, link_anterior: previaLinha.link_anterior }]
        : []
    })
    solicitadas += sublote.length
    try {
      const resultado = await requisitar('/api/valio/produtos/links-afiliados', token, 'PATCH',
        { texto: sublote.map((linha) => linha.texto).join('\n'), confirmacoes }, enviar)
      if (resultado.solicitadas !== sublote.length || !Number.isInteger(resultado.atualizadas)
        || !Number.isInteger(resultado.erros) || !Array.isArray(resultado.idsAtualizados)
        || !Array.isArray(resultado.falhas) || resultado.atualizadas !== resultado.idsAtualizados.length
        || resultado.erros !== resultado.falhas.length || resultado.atualizadas + resultado.erros !== sublote.length
        || resultado.idsAtualizados.some((id) => typeof id !== 'string' || !confirmacoes.some((item) => item.mercado_livre_id === id))) {
        throw new Error('Resposta inv\u00e1lida da atualiza\u00e7\u00e3o em lote.')
      }
      idsAtualizados.push(...resultado.idsAtualizados as string[])
      for (const item of resultado.falhas as ResultadoLinksLote['falhas']) {
        if (!Number.isInteger(item.linha) || item.linha < 1 || item.linha > sublote.length
          || item.mercado_livre_id !== lerLinhaEntrada(sublote[item.linha - 1].texto).mercado_livre_id) {
          throw new Error('Resposta inv\u00e1lida da atualiza\u00e7\u00e3o: posi\u00e7\u00e3o fora de ordem.')
        }
        falhas.push({ ...item, linha: sublote[item.linha - 1].linhaOriginal })
      }
    } catch (falha) {
      const motivo = falha instanceof Error ? falha.message : 'Falha desconhecida na atualiza\u00e7\u00e3o.'
      falhasSublotes.push({ sublote: indice + 1, totalSublotes: sublotes.length, etapa: 'atualiza\u00e7\u00e3o', motivo })
      for (const linha of sublote) falhas.push({ linha: linha.linhaOriginal,
        mercado_livre_id: lerLinhaEntrada(linha.texto).mercado_livre_id,
        motivo: `Falha na atualiza\u00e7\u00e3o do sublote ${indice + 1} de ${sublotes.length}: ${motivo}` })
    }
  }
  return { solicitadas, atualizadas: idsAtualizados.length, erros: falhas.length, idsAtualizados, falhas,
    ...(falhasSublotes.length ? { falhasSublotes } : {}) }
}