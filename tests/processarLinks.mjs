import assert from 'node:assert/strict'
import test from 'node:test'
import { extrairIdItem, extrairIdProdutoCatalogo } from '../src/lib/processarLinks.ts'

test('extrai o ID do anúncio do wid no fragmento da URL real', () => {
  const link = 'https://www.mercadolivre.com.br/colchao-inflavel-casal-com-inflador-embutido-multiuso-homefy/p/MLB29179705?pdp_filters=deal%3AMLB1578289-1&extra_comm=false&brand_comm=false#polycard_client=affiliates&wid=MLB3910897819&sid=affiliates'
  assert.equal(extrairIdItem(link), 'MLB3910897819')
  assert.equal(extrairIdProdutoCatalogo(link), 'MLB29179705')
})

test('aceita os parâmetros de anúncio no fragmento e preserva o catálogo como inválido', () => {
  for (const key of ['wid', 'item_id', 'itemId']) {
    assert.equal(extrairIdItem(`https://www.mercadolivre.com.br/p/MLB29179705#source=affiliates&${key}=MLB3910897819`), 'MLB3910897819')
  }
  assert.equal(extrairIdItem('https://www.mercadolivre.com.br/p/MLB29179705'), null)
  assert.equal(extrairIdProdutoCatalogo('https://www.mercadolivre.com.br/p/MLB29179705'), 'MLB29179705')
})
