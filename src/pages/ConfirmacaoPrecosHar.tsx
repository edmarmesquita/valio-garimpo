import { useEffect, useRef, useState } from 'react'
import type { ComparacaoHar } from '../lib/compararHarCatalogo'
import type { PreviaFinalHar } from '../lib/previaHar'
import type { RevalidacaoAssinadaHar, ResultadoPrecoHar } from '../lib/atualizacaoHarTipos'
import { confirmarPrecosHar, revalidarPrecosHar } from '../lib/atualizarPrecosHar'

const dinheiro = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export default function ConfirmacaoPrecosHar({ previa, linhas, token }: { previa: PreviaFinalHar; linhas: ComparacaoHar[]; token: string }) {
  const [estado, setEstado] = useState<{ previa: PreviaFinalHar; token: string; revalidacao: RevalidacaoAssinadaHar | null;
    resultados: ResultadoPrecoHar[] | null; ocupado: boolean; erro: string; finalizado: boolean }>({ previa, token, revalidacao: null, resultados: null, ocupado: false, erro: '', finalizado: false })
  const geracao = useRef(0)
  useEffect(() => () => { geracao.current++ }, [previa, token])
  if (estado.previa !== previa || estado.token !== token) setEstado({ previa, token, revalidacao: null, resultados: null, ocupado: false, erro: '', finalizado: false })
  const atual = estado.previa === previa && estado.token === token ? estado : null
  async function revalidar() {
    if (previa.fonte !== 'api' || atual?.ocupado || atual?.finalizado) return
    const versao = ++geracao.current
    setEstado({ previa, token, revalidacao: null, resultados: null, ocupado: true, erro: '', finalizado: false })
    try {
      const revalidacao = await revalidarPrecosHar(previa, linhas, token)
      if (versao !== geracao.current) return
      setEstado({ previa, token, revalidacao, resultados: null, ocupado: false, erro: '', finalizado: false })
    } catch (e) {
      if (versao === geracao.current) setEstado({ previa, token, revalidacao: null, resultados: null, ocupado: false, erro: e instanceof Error ? e.message : 'Falha na revalidação.', finalizado: false })
    }
  }
  async function confirmar() {
    if (!atual?.revalidacao || atual.ocupado || atual.finalizado || previa.fonte !== 'api') return
    const versao = ++geracao.current
    const revalidacao = atual.revalidacao
    setEstado({ ...atual, ocupado: true, revalidacao: null, finalizado: true, erro: '' })
    try {
      const resultados = await confirmarPrecosHar(revalidacao, token)
      if (versao !== geracao.current) return
      setEstado({ previa, token, revalidacao: null, resultados, ocupado: false, erro: '', finalizado: true })
    } catch (e) {
      if (versao === geracao.current) setEstado({ previa, token, revalidacao: null, resultados: null, ocupado: false,
        erro: e instanceof Error ? e.message : 'Resultado desconhecido; recarregue o catálogo.', finalizado: true })
    }
  }
  const resultados = atual?.resultados ?? atual?.revalidacao?.previa.resultados ?? []
  const prontos = resultados.filter((p) => p.status === 'PRONTO').length
  if (previa.fonte !== 'api') return <p>Atualização indisponível com catálogo CSV. Carregue o catálogo pela API para revalidar e gravar.</p>
  return <section className="har-confirmacao" aria-label="Revalidação e atualização HAR">
    <h4>Rechecagem no banco</h4>
    <p>Variações superiores a ±30% são bloqueadas, sem override. Revalidações expiram em cinco minutos.</p>
    <button type="button" disabled={!token.trim() || Boolean(atual?.ocupado || atual?.finalizado)} onClick={() => void revalidar()}>Revalidar e preparar atualização</button>
    {!token.trim() && <p>Informe o token operacional para consultar e revalidar na API.</p>}
    {atual?.ocupado && <p role="status">Processando os itens no backend…</p>}
    {atual?.erro && <p role="alert">{atual.erro}</p>}
    {resultados.length > 0 && <>
      <div className="har-cards">{['PRONTO', 'BLOQUEADO_PRECO_ALTERADO', 'BLOQUEADO_VARIACAO_EXTREMA', 'BLOQUEADO_OFERTA', 'BLOQUEADO_CLASSIFICACAO', 'BLOQUEADO_INATIVO', 'BLOQUEADO_NAO_ENCONTRADO', 'ERRO'].map((s) =>
        <div key={s}><strong>{resultados.filter((r) => r.status === s).length}</strong><span>{s}</span></div>)}</div>
      {atual?.revalidacao && prontos > 0 && <div className="har-etapa-confirmar">
        <p>Esta ação atualizará {prontos} preços no banco. Somente o campo preco será alterado. Cada item será consultado novamente antes da escrita.</p>
        <button type="button" disabled={atual.ocupado} onClick={() => void confirmar()}>Confirmar atualização dos preços</button>
      </div>}
      {atual?.resultados && <p role="status">Atualizados: {resultados.filter((p) => p.status === 'ATUALIZADO').length} · Bloqueados: {resultados.filter((p) => p.status.startsWith('BLOQUEADO')).length} · Erros: {resultados.filter((p) => p.status === 'ERRO').length}. Recarregue o catálogo para uma nova revisão.</p>}
      <div className="har-tabela"><table><thead><tr>{['ITEM_ID', 'Título', 'Preço-base', 'Novo preço', 'Status', 'Motivo'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{resultados.map((r) => <tr key={r.itemId}><td>{r.itemId}</td><td>{r.titulo}</td><td>{dinheiro(r.precoBase)}</td><td>{dinheiro(r.novoPreco)}</td><td>{r.status}</td><td>{r.motivo}</td></tr>)}</tbody></table></div>
    </>}
  </section>
}
