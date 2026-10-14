import { useEffect, useRef } from 'react'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import { CATEGORIAS_VALIO } from '../../lib/produtosGarimpados'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import type { Publicacao } from './usePublicacaoProdutos'
import './PublicacaoProdutosPanel.css'

export function CategoriaPublicacao({ valor, onChange }: { valor: CategoriaValio | undefined; onChange: (valor: string) => void }) {
  return <label className="extrair-categoria">Coleção do Valiô<select value={valor ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Escolha uma coleção</option>{CATEGORIAS_VALIO.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
}

export function AcessoPublicacaoPanel({ publicacao }: { publicacao: Publicacao }) {
  return <section className="extrair-card extrair-acesso" aria-labelledby="acesso-titulo"><h2 id="acesso-titulo">Acesso à vitrine</h2>
    <label htmlFor="token-publicacao">Token de publicação</label>
    <input id="token-publicacao" type="password" autoComplete="off" value={publicacao.tokenPublicacao} onChange={(event) => publicacao.atualizarToken(event.target.value)} placeholder="Token configurado no backend" />
    <p>Use o token de publicação do Garimpo para verificar, enviar e manter produtos. Não informe a Service Role nesta tela.</p>
  </section>
}

export function ResumoPublicacaoPanel({ produtos, selecionados, origemHtml, publicacao }: {
  produtos: ProdutoAfiliado[]; selecionados: Set<number>; origemHtml: boolean; publicacao: Publicacao
}) {
  const escolhidos = produtos.filter((_, indice) => selecionados.has(indice))
  const media = (valores: number[]) => valores.length ? valores.reduce((soma, valor) => soma + valor, 0) / valores.length : null
  const comissaoMedia = media(escolhidos.flatMap((p) => p.comissaoPercentual === null ? [] : [p.comissaoPercentual]))
  const precoMedio = media(escolhidos.flatMap((p) => p.precoAtual === null ? [] : [p.precoAtual]))
  const dinheiro = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
  return <section className="extrair-card" aria-labelledby="resumo-titulo"><h2 id="resumo-titulo">Resumo do garimpo</h2>
    <div className="extrair-resumo">
      <div><strong>{produtos.length}</strong><span>produtos encontrados</span></div>
      <div><strong>{publicacao.estadoVerificacao === 'pronto' ? publicacao.totalNovos : '—'}</strong><span>novos</span></div>
      <div><strong>{publicacao.estadoVerificacao === 'pronto' ? publicacao.totalCadastrados : '—'}</strong><span>já cadastrados</span></div>
      <div><strong>{selecionados.size}</strong><span>selecionados</span></div>
      <div><strong>{produtos.filter((p) => p.extraCommission).length}</strong><span>com comissão extra</span></div>
      <div><strong>{comissaoMedia === null ? '—' : `${comissaoMedia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</strong><span>comissão média selecionada</span></div>
      <div><strong>{precoMedio === null ? '—' : dinheiro(precoMedio)}</strong><span>preço médio selecionado</span></div>
    </div>
    {publicacao.estadoVerificacao === 'pendente' && <p className="extrair-aviso">Informe o token de publicação para verificar quais produtos já estão no Valiô.</p>}
    {publicacao.estadoVerificacao === 'consultando' && <p role="status" className="extrair-aviso">Verificando produtos no Valiô...</p>}
    {publicacao.estadoVerificacao === 'erro' && <p role="status" className="extrair-aviso">Não foi possível verificar quais produtos já estão no Valiô. O JSON continua disponível; o envio fica desabilitado.</p>}
    {publicacao.estadoVerificacao === 'pronto' && <p className="extrair-aviso">A verificação cobre os ITEM_IDs da tabela de produtos do Supabase. Produtos antigos exibidos no Valiô fora dessa tabela não são reconhecidos por esta consulta.</p>}
    {origemHtml && publicacao.estadoVerificacao === 'pronto' && publicacao.totalCadastrados > 0 && <p role="status" className="extrair-aviso">Produto já cadastrado. O envio deste HTML está bloqueado.</p>}
  </section>
}

export default function PublicacaoProdutosPanel({ origemHtml, publicacao }: { origemHtml: boolean; publicacao: Publicacao }) {
  const resultadoRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (publicacao.resultadoValio) resultadoRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [publicacao.resultadoValio])
  return <>
    <section className="extrair-card" aria-labelledby="exportar-titulo"><h2 id="exportar-titulo">Preparar para o Valiô</h2><p>Selecione os produtos e defina uma coleção para cada um. Produtos sem preço, link, ITEM_ID ou título não podem ser exportados.</p><button type="button" onClick={publicacao.gerar}>Gerar produtos para o Valiô</button>
      {publicacao.erroExportacao && <p role="alert" className="extrair-erro extrair-erro-exportacao">{publicacao.erroExportacao}</p>}
      <div className="extrair-publicacao">
        <h3>Envio direto</h3>
        <p>Para enviar, todos os selecionados precisam de categoria, ITEM_ID, título, preço, link e imagem.</p>
        <p>Use o token de publicação informado em “Acesso à vitrine”.</p>
        <div className="extrair-acoes-publicacao"><button type="button" disabled={!publicacao.podeEnviarNovos || !publicacao.tokenPublicacao.trim() || publicacao.enviando} onClick={() => void publicacao.enviarParaValio('novos')}>{publicacao.enviando ? 'Enviando...' : 'Enviar novos para o Valiô'}</button>
        {!origemHtml && <button type="button" className="extrair-secundario" disabled={!publicacao.podeAtualizar || !publicacao.tokenPublicacao.trim() || publicacao.enviando} onClick={() => void publicacao.enviarParaValio('cadastrados')}>Atualizar existentes</button>}</div>
        {publicacao.erroEnvio && <p role="alert" className="extrair-erro">{publicacao.erroEnvio}</p>}
        {publicacao.resumoEnvio && <div role="status" className="extrair-resumo-envio">
          <strong>{publicacao.resumoEnvio.enviados} produto{publicacao.resumoEnvio.enviados === 1 ? '' : 's'} enviado{publicacao.resumoEnvio.enviados === 1 ? '' : 's'} ao Valiô</strong>
          <p>{publicacao.resumoEnvio.criados} criado{publicacao.resumoEnvio.criados === 1 ? '' : 's'} · {publicacao.resumoEnvio.atualizados} atualizado{publicacao.resumoEnvio.atualizados === 1 ? '' : 's'} · {publicacao.resumoEnvio.erros.length} erro{publicacao.resumoEnvio.erros.length === 1 ? '' : 's'}</p>
          {publicacao.resumoEnvio.erros.length > 0 && <ul>{publicacao.resumoEnvio.erros.map((falha) => <li key={falha.id}><strong>{falha.titulo} ({falha.id}):</strong> {falha.motivo}</li>)}</ul>}
        </div>}
      </div>
    </section>
    {publicacao.resultadoValio && <section ref={resultadoRef} className="extrair-card extrair-json-resultado" aria-labelledby="json-valio-titulo">
      <div className="extrair-resultado-cabecalho"><div><h2 id="json-valio-titulo">JSON para o Valiô</h2><p>{publicacao.resultadoValio.quantidade} produto{publicacao.resultadoValio.quantidade === 1 ? '' : 's'} gerado{publicacao.resultadoValio.quantidade === 1 ? '' : 's'}</p></div><button type="button" onClick={() => void publicacao.copiar(publicacao.resultadoValio!.json)}>Copiar JSON para o Valiô</button></div>
      <p role="status" className="extrair-notificacao">JSON para o Valiô gerado com sucesso. Revise antes de usar.</p>
      <pre aria-label="JSON para o Valiô">{publicacao.resultadoValio.json}</pre>
    </section>}
  </>
}
