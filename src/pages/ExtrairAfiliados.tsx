import { useState } from 'react'
import './ExtrairAfiliados.css'
import type { ProdutoAfiliado } from '../lib/extrairProdutosAfiliados'
import { validarLinkHtml } from '../lib/extrairProdutoHtml'
import { alternarSelecao, selecionarTodos } from '../lib/produtosGarimpados'
import type { CategoriaValio } from '../lib/produtosGarimpados'
import ImportacaoProdutosPanel from '../features/importar/ImportacaoProdutosPanel'
import PublicacaoProdutosPanel, { AcessoPublicacaoPanel, CategoriaPublicacao, ResumoPublicacaoPanel } from '../features/publicar/PublicacaoProdutosPanel'
import { usePublicacaoProdutos } from '../features/publicar/usePublicacaoProdutos'

export default function ExtrairAfiliados({ visivel = true }: { visivel?: boolean }) {
  const [produtos, setProdutos] = useState<ProdutoAfiliado[] | null>(null)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [categorias, setCategorias] = useState<Map<number, CategoriaValio>>(new Map())
  const [origemHtml, setOrigemHtml] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const publicacao = usePublicacaoProdutos({ produtos, selecionados, categorias, origemHtml, setCategorias, setMensagem, setErro })

  function importar(encontrados: ProdutoAfiliado[], html: boolean, aviso: string) {
    publicacao.invalidarResultado()
    setProdutos(encontrados); setSelecionados(new Set()); setCategorias(new Map())
    publicacao.reiniciarVerificacao(true); setOrigemHtml(html); setMensagem(aviso)
  }
  function limparJson() {
    setProdutos(null); setSelecionados(new Set()); setCategorias(new Map())
    publicacao.reiniciarVerificacao(false); publicacao.invalidarResultado()
  }
  function limparHtml() {
    if (!origemHtml) return
    limparJson(); setOrigemHtml(false)
  }
  function erroJson(aviso: string) {
    publicacao.invalidarResultado(); setOrigemHtml(false); setProdutos(null); setErro(aviso)
  }
  function erroHtml() {
    if (!origemHtml) return
    setProdutos(null); setSelecionados(new Set()); publicacao.reiniciarVerificacao(false)
    setOrigemHtml(false); publicacao.invalidarResultado()
  }
  function categoria(indice: number, valor: string) {
    const proximas = new Map(categorias)
    if (valor) proximas.set(indice, valor as CategoriaValio)
    else proximas.delete(indice)
    setCategorias(proximas); publicacao.invalidarResultado()
  }
  function atualizarLinkOficial(indice: number, link: string): boolean {
    try { validarLinkHtml(link) }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Link afiliado inválido.'); return false }
    setProdutos((atuais) => atuais?.map((produto, posicao) => posicao === indice ? { ...produto, linkOriginal: link } : produto) ?? null)
    publicacao.invalidarResultado()
    return true
  }
  return <main className="extrair-afiliados" hidden={!visivel}>
    {visivel && <>
      <a href="/">← Voltar ao Valiô Garimpo</a>
      <header><p className="extrair-marca">VALIÔ GARIMPO</p><h1>Produtos garimpados</h1><p>Cole o JSON da Central de Afiliados, revise os produtos e prepare uma lista para o Valiô.</p></header>
      <AcessoPublicacaoPanel publicacao={publicacao} />
    </>}
    <ImportacaoProdutosPanel visivel={visivel} produtos={produtos} selecionados={selecionados} categorias={categorias}
      origemHtml={origemHtml} existentes={publicacao.existentes} estadoVerificacao={publicacao.estadoVerificacao}
      totalCadastrados={publicacao.totalCadastrados} mensagem={mensagem} erro={erro}
      resumo={produtos && <ResumoPublicacaoPanel produtos={produtos} selecionados={selecionados} origemHtml={origemHtml} publicacao={publicacao} />}
      publicacao={<PublicacaoProdutosPanel origemHtml={origemHtml} publicacao={publicacao} />}
      onImportar={importar} onLimparJson={limparJson} onLimparHtml={limparHtml} onErroJson={erroJson} onErroHtml={erroHtml}
      onSelecionar={(indice) => { setSelecionados((atual) => alternarSelecao(atual, indice)); publicacao.invalidarResultado() }}
      onSelecionarTodos={(quantidade) => { setSelecionados(selecionarTodos(quantidade)); publicacao.invalidarResultado() }}
      onDesmarcarTodos={() => { setSelecionados(new Set()); publicacao.invalidarResultado() }}
      renderCategoria={(indice) => <CategoriaPublicacao valor={categorias.get(indice)} onChange={(valor) => categoria(indice, valor)} />}
      onLinkOficial={atualizarLinkOficial} onCopiar={(conteudo) => void publicacao.copiar(conteudo)} />
  </main>
}
