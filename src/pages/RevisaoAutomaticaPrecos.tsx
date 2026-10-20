import { useEffect, useRef, useState } from 'react'
import type { ProdutoCatalogo } from '../lib/manutencaoVitrine'
import { enviarPrecosEmBlocos, type EntradaPreco, type ResultadoPreco } from '../lib/revisaoPrecosLote'
import { CHAVE_REVISAO_AUTOMATICA, SessaoMercadoLivreExpirada, classificarConsulta, consultarPrecosOficiais, ofertaAindaAtiva,
  restaurarRevisao, type ResultadoAutomatico, type RevisaoSalva } from '../lib/revisaoAutomaticaPrecos'

type Props = { catalogo: ProdutoCatalogo[]; token: string;
  mercadoLivreConectado: boolean; onSessaoExpirada: () => void;
  onResultados: (resultados: ResultadoPreco[], entradas: EntradaPreco[]) => void }
const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
const vazio = (): RevisaoSalva => ({ versao: 1, ids: [], resultados: {} })
const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function RevisaoAutomaticaPrecos({ catalogo, token, mercadoLivreConectado, onSessaoExpirada, onResultados }: Props) {
  const [revisao, setRevisao] = useState<RevisaoSalva>(() => restaurarRevisao(window.localStorage) ?? vazio())
  const [pilotoTexto, setPilotoTexto] = useState(() => {
    const salva = restaurarRevisao(window.localStorage)
    return salva?.ids.length === 5 ? salva.ids.join(' ') : ''
  })
  const [pilotoOk, setPilotoOk] = useState(() => restaurarRevisao(window.localStorage)?.pilotoAprovado === true)
  const [executando, setExecutando] = useState(false)
  const [pausado, setPausado] = useState(false)
  const [erro, setErro] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [previa, setPrevia] = useState<{ entradas: EntradaPreco[]; token: string } | null>(null)
  const [ordenacao, setOrdenacao] = useState<'diferenca' | 'aumento' | 'reducao' | 'antigos' | 'recentes'>('diferenca')
  const controle = useRef({ pausar: false, cancelar: false, abortar: null as AbortController | null })
  const ativos = catalogo.filter((item) => item.ativo && /^MLB\d+$/.test(item.mercadoLivreId))
  const porId = new Map(ativos.map((item) => [item.mercadoLivreId, item]))
  const resultados = revisao.ids.flatMap((id) => {
    const produto = porId.get(id), resultado = revisao.resultados[id]
    return produto && resultado ? [{ produto, resultado }] : []
  })
  const contagem = (status: ResultadoAutomatico['status']) => resultados.filter((item) => item.resultado.status === status).length
  const pendentes = revisao.ids.filter((id) => porId.has(id) && !revisao.resultados[id])
  const selecionadosAlterados = resultados.filter(({ produto, resultado }) => selecionados.has(produto.mercadoLivreId)
    && resultado.status === 'PREÇO ALTERADO' && !ofertaAindaAtiva(produto))

  useEffect(() => {
    try {
      if (revisao.ids.length) window.localStorage.setItem(CHAVE_REVISAO_AUTOMATICA, JSON.stringify(revisao))
      else window.localStorage.removeItem(CHAVE_REVISAO_AUTOMATICA)
    } catch { /* revisão continua em memória */ }
  }, [revisao])

  async function executar(ids: string[], inicial: RevisaoSalva, piloto = false, limite = 20) {
    if (executando || !ids.length) return
    controle.current = { pausar: false, cancelar: false, abortar: null }
    setExecutando(true); setPausado(false); setErro(''); setPrevia(null)
    let atual = inicial
    const fila = ids.filter((id) => !atual.resultados[id]).slice(0, limite)
    try {
      for (let inicioLote = 0; inicioLote < fila.length; inicioLote += 20) {
        const lote = fila.slice(inicioLote, inicioLote + 20)
        for (let indice = 0; indice < lote.length; indice += 5) {
          if (controle.current.pausar || controle.current.cancelar) break
          const grupo = lote.slice(indice, indice + 5)
          const abortar = new AbortController()
          controle.current.abortar = abortar
          let consultas
          try { consultas = await consultarPrecosOficiais(grupo, abortar.signal) }
          catch (falha) {
            if (controle.current.cancelar) break
            if (falha instanceof SessaoMercadoLivreExpirada) {
              controle.current.pausar = true
              setErro(falha.message); onSessaoExpirada(); break
            }
            consultas = grupo.map((itemId) => ({ itemId, situacao: 'ERRO TEMPORÁRIO' as const, preco: null,
              motivo: falha instanceof Error ? falha.message : 'Falha temporária.' }))
          }
          const novos = { ...atual.resultados }
          for (const consulta of consultas) {
            const produto = porId.get(consulta.itemId)
            if (produto) novos[consulta.itemId] = classificarConsulta(produto, consulta)
          }
          atual = { ...atual, resultados: novos }
          setRevisao(atual)
          if (inicioLote + indice + 5 < fila.length && !controle.current.pausar && !controle.current.cancelar) await pausa(300)
        }
        if (controle.current.pausar || controle.current.cancelar) break
      }
      if (piloto) {
        const passou = ids.every((id) => ['PREÇO IGUAL', 'PREÇO ALTERADO'].includes(atual.resultados[id]?.status))
        setPilotoOk(passou)
        atual = { ...atual, pilotoAprovado: passou }
        setRevisao(atual)
        if (!passou && !controle.current.pausar) setErro('O piloto não confirmou preço confiável para os cinco ITEM_IDs. A varredura completa permanece bloqueada.')
      }
    } finally {
      controle.current.abortar = null
      setExecutando(false)
      setPausado(controle.current.pausar && !controle.current.cancelar)
    }
  }

  function iniciarPiloto() {
    if (!mercadoLivreConectado) { setErro('Conecte sua conta do Mercado Livre antes do piloto.'); return }
    const ids = pilotoTexto.match(/MLB\d+/gi)?.map((id) => id.toUpperCase()) ?? []
    if (ids.length !== 5 || new Set(ids).size !== 5 || ids.some((id) => !porId.has(id))) {
      setErro('Escolha exatamente cinco ITEM_IDs distintos dos produtos ativos do catálogo carregado.'); return
    }
    const inicial = { versao: 1 as const, ids, resultados: {} }
    setPilotoOk(false); setRevisao(inicial); setSelecionados(new Set())
    void executar(ids, inicial, true)
  }

  function iniciarCompleta() {
    if (!pilotoOk || !mercadoLivreConectado) return
    const ids = ativos.map((item) => item.mercadoLivreId)
    const anteriores = Object.fromEntries(ids.flatMap((id) => revisao.resultados[id] ? [[id, revisao.resultados[id]]] : []))
    const inicial: RevisaoSalva = { versao: 1, ids, resultados: anteriores, pilotoAprovado: true }
    setRevisao(inicial)
    void executar(ids, inicial, false, Number.POSITIVE_INFINITY)
  }

  function continuar() { if (mercadoLivreConectado && pendentes.length) void executar(revisao.ids, revisao, false, Number.POSITIVE_INFINITY) }
  function proximos() { if (mercadoLivreConectado && pendentes.length) void executar(revisao.ids, revisao) }

  function limpar() {
    controle.current.cancelar = true; controle.current.abortar?.abort()
    setRevisao(vazio()); setSelecionados(new Set()); setPrevia(null); setPilotoOk(false); setPausado(false); setErro('')
    try { window.localStorage.removeItem(CHAVE_REVISAO_AUTOMATICA) } catch { /* sem efeito fora da sessão */ }
  }

  function prepararPrevia() {
    const entradas = selecionadosAlterados.map(({ produto, resultado }) => ({ mercadoLivreId: produto.mercadoLivreId,
      preco: resultado.preco!, atualizarPreco: true, precoEsperado: produto.preco }))
    if (!entradas.length) return
    setPrevia({ entradas, token }); setErro('')
  }

  async function confirmar() {
    if (!previa || previa.token !== token || !token.trim()) return
    const atuais = selecionadosAlterados.map(({ produto, resultado }) => ({ mercadoLivreId: produto.mercadoLivreId,
      preco: resultado.preco!, atualizarPreco: true, precoEsperado: produto.preco }))
    if (JSON.stringify(atuais) !== JSON.stringify(previa.entradas)) {
      setPrevia(null); setErro('A seleção ou os preços mudaram. Gere uma nova prévia.'); return
    }
    setExecutando(true); setErro('')
    try {
      const confirmados: EntradaPreco[] = []
      const conflitos: string[] = []
      for (let i = 0; i < previa.entradas.length; i += 5) {
        const grupo = previa.entradas.slice(i, i + 5)
        const respostas = await consultarPrecosOficiais(grupo.map((item) => item.mercadoLivreId))
        for (const [indice, resposta] of respostas.entries()) {
          const entrada = grupo[indice]
          if (resposta.situacao !== 'OK' || Math.round(resposta.preco! * 100) !== Math.round(entrada.preco * 100))
            conflitos.push(entrada.mercadoLivreId)
          else confirmados.push(entrada)
        }
      }
      if (conflitos.length) {
        setErro(`Preço mudou ou não pôde ser revalidado para: ${conflitos.join(', ')}. Revise esses ITEM_IDs novamente.`)
        setRevisao((atual) => ({ ...atual, resultados: Object.fromEntries(Object.entries(atual.resultados)
          .filter(([id]) => !conflitos.includes(id))) }))
      }
      if (confirmados.length) {
        const resultadosGravacao = await enviarPrecosEmBlocos(confirmados, token)
        onResultados(resultadosGravacao, confirmados)
        setSelecionados((atual) => new Set([...atual].filter((id) => !confirmados.some((item) => item.mercadoLivreId === id))))
      }
    } catch (falha) {
      if (falha instanceof SessaoMercadoLivreExpirada) onSessaoExpirada()
      setErro(falha instanceof Error ? falha.message : 'Falha ao revalidar os preços no Mercado Livre.')
    }
    finally { setExecutando(false); setPrevia(null) }
  }

  const ordenados = [...resultados].sort((a, b) => {
    const diferenca = (item: typeof a) => item.resultado.preco === null ? 0 : item.resultado.preco - item.produto.preco
    if (ordenacao === 'aumento') return diferenca(b) - diferenca(a)
    if (ordenacao === 'reducao') return diferenca(a) - diferenca(b)
    if (ordenacao === 'antigos') return a.produto.dataPreco.localeCompare(b.produto.dataPreco)
    if (ordenacao === 'recentes') return b.produto.dataPreco.localeCompare(a.produto.dataPreco)
    return Math.abs(diferenca(b)) - Math.abs(diferenca(a))
  })

  return <section className="fila-revisao" aria-label="Revisão automática do catálogo">
    <h3>Revisão automática do catálogo</h3>
    <p>Consulta o preço de venda do canal marketplace por ITEM_ID na API oficial do Mercado Livre. Requer a conta Mercado Livre conectada. Nenhum preço é atualizado durante a varredura.</p>
    <label htmlFor="piloto-ids">Piloto: cinco ITEM_IDs ativos do catálogo</label>
    <textarea id="piloto-ids" value={pilotoTexto} onChange={(evento) => setPilotoTexto(evento.target.value)}
      placeholder="MLB123… MLB456…" />
    <div className="fila-acoes">
      <button type="button" disabled={executando || !mercadoLivreConectado} onClick={iniciarPiloto}>Testar piloto de 5 produtos</button>
      <button type="button" disabled={!pilotoOk || executando || !mercadoLivreConectado} onClick={iniciarCompleta}>Revisar catálogo inteiro por ITEM_ID</button>
      <button type="button" disabled={executando || !pendentes.length || !pilotoOk || !mercadoLivreConectado} onClick={proximos}>Revisar próximos pendentes</button>
      <button type="button" disabled={!executando} onClick={() => { controle.current.pausar = true; setPausado(true) }}>Pausar</button>
      <button type="button" disabled={executando || !pendentes.length || !pilotoOk || !mercadoLivreConectado} onClick={continuar}>Continuar</button>
      <button type="button" disabled={!executando} onClick={() => { controle.current.cancelar = true; controle.current.abortar?.abort() }}>Cancelar</button>
      <button type="button" className="extrair-secundario" disabled={executando} onClick={limpar}>Limpar revisão automática</button>
    </div>
    {revisao.ids.length > 0 && pendentes.length > 0 && !executando && <p role="status">Revisão interrompida em {resultados.length}/{revisao.ids.length}. Continuar?</p>}
    <p role="status">{executando ? 'Revisando catálogo' : pausado ? 'Revisão pausada' : 'Revisão pronta'}: {resultados.length} / {revisao.ids.length || ativos.length}</p>
    <div className="fila-contadores"><span>Total ativo: {ativos.length}</span><span>Verificados: {resultados.length}</span>
      <span>Preço igual: {contagem('PREÇO IGUAL')}</span><span>Preço alterado: {contagem('PREÇO ALTERADO')}</span>
      <span>Não encontrado: {contagem('NÃO ENCONTRADO')}</span><span>Revisar: {contagem('REVISAR')}</span>
      <span>Erros: {contagem('ERRO TEMPORÁRIO')}</span></div>
    {erro && <p role="alert" className="extrair-erro">{erro}</p>}
    <label>Ordenar resultados <select value={ordenacao} onChange={(evento) => setOrdenacao(evento.target.value as typeof ordenacao)}>
      <option value="diferenca">Maior diferença</option><option value="aumento">Maior aumento</option>
      <option value="reducao">Maior redução</option><option value="antigos">Mais antigo</option><option value="recentes">Mais recente</option>
    </select></label>
    <div className="fila-lista">{ordenados.map(({ produto, resultado }) => <div className="fila-item" key={produto.mercadoLivreId}>
      <label className="fila-selecao"><input type="checkbox" aria-label={`Selecionar ${produto.mercadoLivreId}`}
        disabled={executando || resultado.status !== 'PREÇO ALTERADO' || ofertaAindaAtiva(produto)}
        checked={selecionados.has(produto.mercadoLivreId)} onChange={(evento) => { setPrevia(null); setSelecionados((atual) => {
          const proximo = new Set(atual); if (evento.target.checked) proximo.add(produto.mercadoLivreId); else proximo.delete(produto.mercadoLivreId)
          return proximo
        }) }} /><span><strong>{produto.titulo}</strong><small>{produto.mercadoLivreId} · {resultado.status}</small>
          {resultado.possivelOfertaExpirada && <small>Preço possivelmente herdado de oferta expirada</small>}
          {resultado.motivo && <small>{resultado.motivo}</small>}</span></label>
      <div><strong>Preço</strong><span>Valiô: {moeda(produto.preco)}</span>
        <span>Mercado Livre: {resultado.preco === null ? '—' : moeda(resultado.preco)}</span>
        {resultado.preco !== null && <span>Diferença: {moeda(resultado.preco - produto.preco)} ({((resultado.preco - produto.preco) / produto.preco * 100).toFixed(1)}%)</span>}</div>
    </div>)}</div>
    <button type="button" disabled={!selecionadosAlterados.length || executando || !token.trim()} onClick={prepararPrevia}>Prévia dos preços selecionados</button>
    {previa && <section className="fila-previa" aria-label="Prévia automática de preços"><h4>Prévia de {previa.entradas.length} preço(s)</h4>
      <ul>{previa.entradas.map((item) => <li key={item.mercadoLivreId}>{item.mercadoLivreId}: Valiô {moeda(item.precoEsperado!)} → Mercado Livre {moeda(item.preco)}</li>)}</ul>
      <button type="button" disabled={executando} onClick={() => void confirmar()}>Confirmar revisão automática</button>
    </section>}
  </section>
}
