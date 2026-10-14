import { useState } from 'react'
import { atualizarLinkAfiliado, confirmarLinksLote, preverLinksLote } from '../lib/manutencaoVitrine'
import type { PreviaLinksLote, ResultadoLinkAfiliado, ResultadoLinksLote } from '../lib/manutencaoVitrine'
import './LinksAfiliadosPanel.css'

type Props = { token: string; onLinksAtualizados?: (links: ReadonlyMap<string, string>) => void }

export default function LinksAfiliadosPanel({ token, onLinksAtualizados }: Props) {
  const [itemIdLink, setItemIdLink] = useState('')
  const [linkOficial, setLinkOficial] = useState('')
  const [salvandoLink, setSalvandoLink] = useState(false)
  const [erroLink, setErroLink] = useState('')
  const [resultadoLink, setResultadoLink] = useState<ResultadoLinkAfiliado | null>(null)
  const [textoLote, setTextoLote] = useState('')
  const [previaLote, setPreviaLote] = useState<(PreviaLinksLote & { texto: string }) | null>(null)
  const [resultadoLote, setResultadoLote] = useState<ResultadoLinksLote | null>(null)
  const [erroLote, setErroLote] = useState('')
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [confirmandoLote, setConfirmandoLote] = useState(false)

  async function salvarLink(evento: React.SubmitEvent<HTMLFormElement>) {
    evento.preventDefault()
    setSalvandoLink(true); setErroLink(''); setResultadoLink(null)
    try {
      const resultado = await atualizarLinkAfiliado(itemIdLink.trim(), linkOficial.trim(), token)
      setResultadoLink(resultado)
      onLinksAtualizados?.(new Map([[resultado.mercado_livre_id, resultado.link_afiliado]]))
    } catch (falha) { setErroLink(falha instanceof Error ? falha.message : 'Não foi possível atualizar o link afiliado.') }
    finally { setSalvandoLink(false) }
  }

  async function prepararLote() {
    setCarregandoPrevia(true); setErroLote(''); setPreviaLote(null); setResultadoLote(null)
    try {
      const previa = await preverLinksLote(textoLote, token)
      setPreviaLote({ ...previa, texto: textoLote })
    } catch (falha) { setErroLote(falha instanceof Error ? falha.message : 'Não foi possível preparar a prévia.') }
    finally { setCarregandoPrevia(false) }
  }

  async function aplicarLote() {
    if (!previaLote || confirmandoLote) return
    const previa = previaLote
    setConfirmandoLote(true); setErroLote(''); setResultadoLote(null)
    try {
      const resultado = await confirmarLinksLote(previa.texto, previa, token)
      setResultadoLote(resultado)
      const atualizados = new Set(resultado.idsAtualizados)
      const linksNovos = new Map(previa.linhas.filter((item) => item.mercado_livre_id && item.link_novo && atualizados.has(item.mercado_livre_id))
        .map((item) => [item.mercado_livre_id!, item.link_novo!]))
      onLinksAtualizados?.(linksNovos)
      setPreviaLote(null)
    } catch (falha) { setErroLote(falha instanceof Error ? falha.message : 'Não foi possível atualizar o lote.') }
    finally { setConfirmandoLote(false) }
  }

  return <>
    <form className="vitrine-atualizar-link" onSubmit={(evento) => void salvarLink(evento)}>
      <h3>Atualizar link afiliado</h3>
      <p>Atualize um produto por vez usando o link oficial gerado pelo Mercado Livre.</p>
      <div className="vitrine-atualizar-link-campos">
        <label>ITEM_ID<input type="text" value={itemIdLink} onChange={(evento) => setItemIdLink(evento.target.value)}
          placeholder="MLB5348529958" required autoComplete="off" /></label>
        <label>Link afiliado oficial<input type="url" value={linkOficial} onChange={(evento) => setLinkOficial(evento.target.value)}
          placeholder="https://meli.la/..." required autoComplete="off" /></label>
      </div>
      <button type="submit" disabled={!token.trim() || salvandoLink}>{salvandoLink ? 'Atualizando...' : 'Atualizar link'}</button>
      {erroLink && <p role="alert" className="extrair-erro">{erroLink}</p>}
      {resultadoLink && <div role="status" className="vitrine-link-resultado">
        <strong>Link afiliado atualizado.</strong>
        <p>Produto encontrado: {resultadoLink.produto}</p>
        <p>ITEM_ID: {resultadoLink.mercado_livre_id}</p>
        <p>Link anterior: {resultadoLink.link_anterior}</p>
        <p>Link novo: {resultadoLink.link_afiliado}</p>
      </div>}
    </form>
    <section className="vitrine-lote-links" aria-labelledby="vitrine-lote-links-titulo">
      <h3 id="vitrine-lote-links-titulo">Atualizar links afiliados em lote</h3>
      <p>Até 20 produtos por vez. Uma linha por produto: <code>MLB5348529958 | https://meli.la/...</code></p>
      <label htmlFor="vitrine-lote-links-texto">ITEM_ID | Link afiliado oficial</label>
      <textarea id="vitrine-lote-links-texto" value={textoLote} disabled={carregandoPrevia || confirmandoLote}
        onChange={(evento) => { setTextoLote(evento.target.value); setPreviaLote(null); setResultadoLote(null); setErroLote('') }}
        placeholder={'MLB5348529958 | https://meli.la/...\nMLB6234029308 | https://meli.la/...'} spellCheck={false} />
      <div className="vitrine-lote-links-acoes">
        <button type="button" disabled={!token.trim() || !textoLote.trim() || carregandoPrevia || confirmandoLote}
          onClick={() => void prepararLote()}>{carregandoPrevia ? 'Consultando...' : 'Ver prévia'}</button>
        {previaLote && <button type="button" className="extrair-secundario" disabled={confirmandoLote}
          onClick={() => { setPreviaLote(null); setErroLote('') }}>Cancelar prévia</button>}
      </div>
      {erroLote && <p role="alert" className="extrair-erro">{erroLote}</p>}
      {previaLote && <div className="vitrine-lote-previa">
        <h4>Prévia — nenhuma alteração feita</h4>
        <p>{previaLote.solicitadas} linha(s) solicitada(s); {previaLote.linhas.filter((item) => !item.motivo).length} pronta(s) para atualizar.</p>
        <div className="vitrine-lote-tabela"><table><thead><tr><th>Linha / ITEM_ID</th><th>Produto</th><th>Link atual</th><th>Link novo</th><th>Situação</th></tr></thead>
          <tbody>{previaLote.linhas.map((item) => <tr key={item.linha}>
            <td>{item.linha} · {item.mercado_livre_id ?? 'Inválido'}</td><td>{item.titulo ?? '—'}</td>
            <td>{item.link_anterior ?? '—'}</td><td>{item.link_novo ?? '—'}</td><td>{item.motivo ?? 'Pronto'}</td>
          </tr>)}</tbody></table></div>
        <button type="button" disabled={confirmandoLote || !previaLote.linhas.some((item) => !item.motivo)}
          onClick={() => void aplicarLote()}>{confirmandoLote ? 'Atualizando...' : `Confirmar atualização de ${previaLote.linhas.filter((item) => !item.motivo).length} link(s)`}</button>
      </div>}
      {resultadoLote && <div role="status" className="vitrine-link-resultado">
        <strong>Resultado da atualização em lote</strong>
        <p>Solicitados: {resultadoLote.solicitadas} · Atualizados: {resultadoLote.atualizadas} · Com erro: {resultadoLote.erros}</p>
        <p>ITEM_IDs atualizados: {resultadoLote.idsAtualizados.join(', ') || 'Nenhum'}</p>
        {resultadoLote.falhas.length > 0 && <ul>{resultadoLote.falhas.map((falha) => <li key={falha.linha}>
          Linha {falha.linha} ({falha.mercado_livre_id ?? 'ITEM_ID inválido'}): {falha.motivo}
        </li>)}</ul>}
      </div>}
    </section>
  </>
}
