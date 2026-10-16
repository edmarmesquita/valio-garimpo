import { validarRegistroSnapshot, type RegistroSnapshot } from '../importar-lista-afiliados/snapshotLoteAfiliados'
import { processarRetornoGerador } from '../importar-lista-afiliados/processarRetornoGerador'
import type { PreviaRemotaOfertas, ResultadoConfirmacaoOfertas } from '../../lib/ofertasRelampagoApi'

export const CHAVE_SNAPSHOT_OFERTAS = 'valio-garimpa:flash-batch-snapshot:v1'

function retornoValido(registro: RegistroSnapshot) {
  const retorno = processarRetornoGerador(registro.snapshot.produtos, registro.retornoTexto ?? '')
  return retorno.consistente && retorno.pareamentos.every((item) => item.retorno?.tipo === 'LINK')
}

export function validarLoteOfertas(valor: unknown): valor is RegistroSnapshot {
  if (!validarRegistroSnapshot(valor)) return false
  return valor.status === 'AGUARDANDO RETORNO' || retornoValido(valor)
    && (valor.status !== 'FINALIZADO' || valor.snapshot.produtos.every((item) => valor.novosConcluidos.includes(item.itemId)))
}

export function registrarRetornoLote(registro: RegistroSnapshot, texto: string): RegistroSnapshot {
  if (registro.status === 'FINALIZADO' || texto === (registro.retornoTexto ?? '')) return registro
  // Corrigir o retorno não desfaz criações já confirmadas de um lote parcial.
  const proximo: RegistroSnapshot = { ...registro, retornoTexto: texto }
  return retornoValido(proximo) ? { ...proximo, status: 'RETORNO PROCESSADO' }
    : { ...proximo, status: 'AGUARDANDO RETORNO', retornoTexto: null }
}

export function registrarConfirmacaoLote(registro: RegistroSnapshot, previa: PreviaRemotaOfertas,
  resultado: ResultadoConfirmacaoOfertas): RegistroSnapshot {
  if (registro.status === 'FINALIZADO' || !retornoValido(registro)
    || !['ATIVAR', 'ENVIAR', 'SUBSTITUIR'].includes(previa.modo)) return registro
  const concluidos = new Set(registro.novosConcluidos)
  for (const produto of registro.snapshot.produtos) {
    const operacao = previa.operacoes.find((item) => item.itemId === produto.itemId)
    if (!operacao) continue
    const itens = resultado.itens.filter((item) => item.itemId === produto.itemId)
    const sucesso = itens.length === 1 && ['CRIADA', 'ATIVAR', 'ATUALIZAR', 'SEM ALTERAÇÃO'].includes(itens[0].resultado)
      && ['CRIAR COMO OFERTA', 'ATIVAR', 'ATUALIZAR', 'SEM ALTERAÇÃO'].includes(operacao.acao)
    if (sucesso) concluidos.add(produto.itemId)
    else concluidos.delete(produto.itemId)
  }
  const finalizado = resultado.erros === 0 && resultado.conflitos === 0
    && registro.snapshot.produtos.every((item) => concluidos.has(item.itemId))
  return { ...registro, novosConcluidos: [...concluidos], status: finalizado ? 'FINALIZADO' : 'RETORNO PROCESSADO' }
}
