import { useEffect, useState } from 'react'
import { useSessaoOperacional } from '../../app/sessaoOperacionalContext'
import type { ProdutoAfiliado } from '../../lib/extrairProdutosAfiliados'
import { CATEGORIAS_VALIO, gerarProdutosValio } from '../../lib/produtosGarimpados'
import type { CategoriaValio } from '../../lib/produtosGarimpados'
import { enviarSelecionadosValio, selecionadosPublicaveis } from '../../lib/publicarProdutosValio'
import type { ResumoEnvio } from '../../lib/publicarProdutosValio'
import { idsParaVerificar, separarSelecionados, verificarProdutosValio } from '../../lib/verificarProdutosValio'
import type { ProdutoExistente } from '../../lib/verificarProdutosValio'
type EstadoVerificacao = 'pendente' | 'consultando' | 'pronto' | 'erro'
type Lote = {
  produtos: ProdutoAfiliado[] | null
  selecionados: Set<number>
  categorias: Map<number, CategoriaValio>
  origemHtml: boolean
  setCategorias: React.Dispatch<React.SetStateAction<Map<number, CategoriaValio>>>
  setMensagem: (valor: string) => void
  setErro: (valor: string) => void
}

export function usePublicacaoProdutos({ produtos, selecionados, categorias, origemHtml, setCategorias, setMensagem, setErro }: Lote) {
  const { token: tokenPublicacao, setToken: setTokenPublicacao, setDiagnostico } = useSessaoOperacional()
  const [resultadoValio, setResultadoValio] = useState<{ json: string; quantidade: number } | null>(null)
  const [erroExportacao, setErroExportacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resumoEnvio, setResumoEnvio] = useState<ResumoEnvio | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')
  const [existentes, setExistentes] = useState<Map<string, ProdutoExistente>>(new Map())
  const [estadoVerificacao, setEstadoVerificacao] = useState<EstadoVerificacao>('pendente')
  const separados = produtos ? separarSelecionados(produtos, selecionados, existentes) : { novos: new Set<number>(), cadastrados: new Set<number>() }
  const podeEnviarNovos = produtos !== null && estadoVerificacao === 'pronto' && selecionadosPublicaveis(produtos, separados.novos, categorias)
  const podeAtualizar = !origemHtml && produtos !== null && estadoVerificacao === 'pronto' && selecionadosPublicaveis(produtos, separados.cadastrados, categorias)
  const totalCadastrados = produtos?.filter((produto) => produto.itemId && existentes.has(produto.itemId)).length ?? 0
  const totalNovos = produtos?.filter((produto) => produto.itemId && /^MLB\d+$/.test(produto.itemId) && !existentes.has(produto.itemId)).length ?? 0

  useEffect(() => {
    setDiagnostico(produtos ? { idsEnviados: idsParaVerificar(produtos), idsRetornados: [...existentes.keys()],
      estado: estadoVerificacao, novos: totalNovos, cadastrados: totalCadastrados } : null)
  }, [produtos, existentes, estadoVerificacao, totalNovos, totalCadastrados, setDiagnostico])

  useEffect(() => {
    if (!produtos || !tokenPublicacao.trim()) return
    let cancelada = false
    void verificarProdutosValio(produtos, tokenPublicacao).then((encontrados) => {
      if (cancelada) return
      setExistentes(encontrados); setEstadoVerificacao('pronto')
      setCategorias((atuais) => {
        const proximas = new Map(atuais)
        produtos.forEach((produto, indice) => {
          const existente = encontrados.get(produto.itemId ?? '')
          if (existente && CATEGORIAS_VALIO.includes(existente.categoria) && !proximas.has(indice)) proximas.set(indice, existente.categoria)
        })
        return proximas
      })
    }).catch(() => { if (!cancelada) { setExistentes(new Map()); setEstadoVerificacao('erro') } })
    return () => { cancelada = true }
  }, [produtos, tokenPublicacao, setCategorias])

  function invalidarResultado() {
    setResultadoValio(null); setErroExportacao(''); setResumoEnvio(null); setErroEnvio(''); setMensagem(''); setErro('')
  }
  function reiniciarVerificacao(temProdutos: boolean) {
    setExistentes(new Map())
    setEstadoVerificacao(temProdutos && tokenPublicacao.trim() ? 'consultando' : 'pendente')
  }
  function atualizarToken(valor: string) {
    setTokenPublicacao(valor)
    setExistentes(new Map())
    setEstadoVerificacao(produtos && valor.trim() ? 'consultando' : 'pendente')
  }
  async function copiar(conteudo: string) {
    try { await navigator.clipboard.writeText(conteudo); setErro(''); setMensagem('JSON copiado.') }
    catch { setErro('Não foi possível copiar automaticamente. Selecione o JSON abaixo para copiar.') }
  }
  function gerar() {
    if (!produtos) return
    try {
      const gerados = gerarProdutosValio(produtos, selecionados, categorias)
      setResultadoValio({ json: JSON.stringify(gerados, null, 2), quantidade: gerados.length })
      setErroExportacao(''); setErro(''); setMensagem('')
    } catch (falha) {
      setResultadoValio(null)
      setErroExportacao(falha instanceof Error ? falha.message : 'Não foi possível gerar o JSON.')
    }
  }
  async function enviarParaValio(tipo: 'novos' | 'cadastrados') {
    if (!produtos || enviando) return
    if (estadoVerificacao !== 'pronto') { setErroEnvio('Verifique os produtos antes de enviar.'); return }
    const indices = separarSelecionados(produtos, selecionados, existentes)[tipo]
    if (!indices.size) return
    setEnviando(true); setResumoEnvio(null); setErroEnvio('')
    try {
      const resumo = await enviarSelecionadosValio(produtos, indices, categorias, tokenPublicacao, fetch,
        { origemLink: origemHtml ? 'importacao-html' : 'importacao-json' })
      setResumoEnvio(resumo)
      if (resumo.enviados > 0) {
        setEstadoVerificacao('consultando')
        try { setExistentes(await verificarProdutosValio(produtos, tokenPublicacao)); setEstadoVerificacao('pronto') }
        catch { setExistentes(new Map()); setEstadoVerificacao('erro') }
      }
    }
    catch (falha) { setErroEnvio(falha instanceof Error ? falha.message : 'Não foi possível enviar os produtos.') }
    finally { setEnviando(false) }
  }
  return { tokenPublicacao, resultadoValio, erroExportacao, enviando, resumoEnvio, erroEnvio, existentes,
    estadoVerificacao, podeEnviarNovos, podeAtualizar, totalCadastrados, totalNovos, invalidarResultado,
    reiniciarVerificacao, atualizarToken, copiar, gerar, enviarParaValio }
}

export type Publicacao = ReturnType<typeof usePublicacaoProdutos>
