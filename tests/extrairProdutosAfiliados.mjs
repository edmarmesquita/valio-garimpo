import assert from 'node:assert/strict'
import test from 'node:test'
import { extrairProdutosAfiliados } from '../src/lib/extrairProdutosAfiliados.ts'

const item = {
  unique_id: 'item-1',
  metadata: {
    id: 'MLB2011818434', variation_id: '175597736949',
    url: 'produto.mercadolivre.com.br/MLB-2011818434-camiseta',
    url_params: '?searchVariation=175597736949&extra_comm=false&brand_comm=false',
    url_fragments: '#polycard_client=affiliates&sid=affiliates',
    type: 'item',
  },
  pictures: [{ id: '636166-MLB100389447094_122025' }],
  components: [
    { type: 'review_compacted', alt_text: 'Classificação 4.8 de 5 estrelas. Mais de 10mil produtos vendidos.' },
    { id: 'affiliates_commission_chip', chip: { pill: { text: 'GANHOS 16%' } } },
    { type: 'price', price: {
      previous_price: { value: 129.99, currency: 'BRL' },
      current_price: { value: 79.99, currency: 'BRL' },
      discount_label: { text: '38% OFF' },
      installments: { text: '3x {price} sem juros', no_interest: true,
        values: [{ key: 'price', type: 'price', price: { value: 26.66, currency: 'BRL' } }] },
    } },
    { type: 'highlight', highlight: { text: 'MAIS VENDIDO' } },
    { type: 'title', title: { text: 'Camiseta Nike' } },
  ],
}

test('extrai todos os dados do card item em qualquer ordem', () => {
  const [produto] = extrairProdutosAfiliados({ polycard_context: {
    picture_template: 'https://http2.mlstatic.com/D_{id}-O.jpg',
  }, results: [item] })
  assert.deepEqual(produto, {
    itemId: 'MLB2011818434', productId: null, userProductId: null,
    variationId: '175597736949', titulo: 'Camiseta Nike', precoAtual: 79.99,
    precoAnterior: 129.99, moeda: 'BRL', desconto: '38% OFF', parcelas: 3,
    valorParcela: 26.66, semJuros: true, avaliacao: 4.8,
    vendidosTexto: '+10mil vendidos', comissaoTexto: 'GANHOS 16%',
    comissaoPercentual: 16, destaque: 'MAIS VENDIDO',
    imagemId: '636166-MLB100389447094_122025',
    imagemUrl: 'https://http2.mlstatic.com/D_636166-MLB100389447094_122025-O.jpg',
    linkOriginal: 'https://produto.mercadolivre.com.br/MLB-2011818434-camiseta?searchVariation=175597736949&extra_comm=false&brand_comm=false#polycard_client=affiliates&sid=affiliates',
    extraCommission: false, brandCommission: false, tipoOrigem: 'item',
  })
})

test('extrai card product, preserva link e ignora blocos sem estrutura de card', () => {
  const product = {
    unique_id: 'product-1',
    metadata: {
      id: 'MLB7665678820', product_id: 'MLB64996643', user_product_id: 'MLBU5244151342',
      url: 'www.mercadolivre.com.br/produto/p/MLB64996643',
      url_params: '?pdp_filters=item_id%3AMLB7665678820&extra_comm=true&brand_comm=false',
      url_fragments: '#polycard_client=affiliates&wid=MLB7665678820&sid=affiliates',
      extra_commission: 'true', brand_commission: 'false', type: 'product',
    },
    pictures: [], components: [{ id: 'title', title: { text: 'Produto catálogo' } }],
  }
  const resposta = { unrelated: { metadata: {}, pictures: [], components: [] },
    nested: { cards: [item, { other: [product] }] } }
  const produtos = extrairProdutosAfiliados(resposta)
  assert.equal(produtos.length, 2)
  assert.equal(produtos[1].productId, 'MLB64996643')
  assert.equal(produtos[1].userProductId, 'MLBU5244151342')
  assert.equal(produtos[1].extraCommission, true)
  assert.equal(produtos[1].tipoOrigem, 'product')
  assert.equal(produtos[1].linkOriginal, `https://${product.metadata.url}${product.metadata.url_params}${product.metadata.url_fragments}`)
})

test('link afiliado oficial importado prevalece sobre URL comum do card sem alterações', () => {
  const curto = 'https://meli.la/1Yu9QRC'
  const social = 'https://www.mercadolivre.com.br/social/ee20260414070618?matt_word=valiosite&matt_tool=20840303&forceInApp=true&ref=a%2Fb#origem=afiliado'
  for (const oficial of [curto, social]) {
    const [produto] = extrairProdutosAfiliados([{ ...item, metadata: { ...item.metadata, affiliate_url: oficial } }])
    assert.equal(produto.itemId, item.metadata.id)
    assert.equal(produto.linkOriginal, oficial)
    const [direto] = extrairProdutosAfiliados([{ ...item, metadata: { ...item.metadata, url: oficial } }])
    assert.equal(direto.linkOriginal, oficial)
  }
})

test('card incompleto retorna null nos campos ausentes e não fabrica imagem', () => {
  const [produto] = extrairProdutosAfiliados({ polycard_context: { picture_template: 'modelo-sem-placeholder' },
    data: [{ unique_id: 'incompleto', metadata: {}, pictures: [{ id: 'foto' }], components: [] }] })
  assert.equal(produto.itemId, null)
  assert.equal(produto.precoAtual, null)
  assert.equal(produto.avaliacao, null)
  assert.equal(produto.imagemId, 'foto')
  assert.equal(produto.imagemUrl, null)
  assert.equal(produto.extraCommission, null)
  assert.equal(produto.tipoOrigem, null)
})

test('aceita ausência de review e lê parcelas em componente separado', () => {
  const card = { unique_id: 'x', metadata: { id: 'MLB123', url: 'https://www.mercadolivre.com.br/x' },
    pictures: [], components: [{ id: 'installments', installments: { text: '10x {price}', no_interest: false,
      values: [{ price: { value: 10, currency: 'BRL' } }] } }] }
  const [produto] = extrairProdutosAfiliados([card])
  assert.equal(produto.parcelas, 10)
  assert.equal(produto.valorParcela, 10)
  assert.equal(produto.semJuros, false)
  assert.equal(produto.avaliacao, null)
  assert.equal(produto.linkOriginal, 'https://www.mercadolivre.com.br/x')
})

test('encontra dois cards sob polycard_client_model em arrays e objetos aninhados', () => {
  const outro = {
    components: [{ id: 'title', title: { text: 'Segundo produto' } }],
    pictures: [{ id: 'imagem-2' }],
    metadata: { id: 'MLB2', type: 'item' },
    unique_id: 'item-2',
  }
  const resposta = {
    polycard_client_model: {
      polycard_context: {
        contract_version: '1.3.0',
        picture_template: 'https://http2.mlstatic.com/D_{id}-O.jpg',
      },
      estrutura_intermediaria: {
        grupos: [{ dados: { qualquer_nome: [[item], { nivel: [{ cards: [outro] }] }] } }],
      },
    },
  }
  const produtos = extrairProdutosAfiliados(resposta)
  assert.equal(produtos.length, 2)
  assert.deepEqual(produtos.map((produto) => produto.itemId), ['MLB2011818434', 'MLB2'])
  assert.equal(produtos[0].titulo, 'Camiseta Nike')
  assert.equal(produtos[1].imagemUrl, 'https://http2.mlstatic.com/D_imagem-2-O.jpg')
})

test('extrai os cards no formato real polycard_client_model.polycards', () => {
  const resposta = {
    polycard_client_model: {
      polycard_context: {
        contract_version: '1.3.0',
        picture_template: 'https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp',
        picture_size_default: 'AB', picture_square_default: 'Q',
      },
      polycards: [
        {
          unique_id: 'Ft1qXsRrPUQnk1Caocp1AE2SQU6IjKPVp4khzsNNQ18',
          metadata: { id: 'MLB5125191351', product_id: 'MLB78198525',
            user_product_id: 'MLBU4898838008', type: 'product',
            url: 'www.mercadolivre.com.br/geladeira/p/MLB78198525',
            url_params: '?extra_comm=false&brand_comm=false',
            url_fragments: '#polycard_client=affiliates' },
          pictures: { scale: 'FILL', pictures: [{ id: '901684-MLA116661159495_082026' }], square: 'Q' },
          components: [
            { id: 'title', title: { text: 'Geladeira Midea Rt554' } },
            { id: 'review_compacted', review_compacted: {
              alt_text: 'Classificação 4.9 de 5 estrelas. Mais de 500 produtos vendidos.' } },
            { id: 'affiliates_commission_chip', chip: { pill: { text: 'GANHOS 5%' } } },
            { id: 'price', price: { current_price: { value: 2315, currency: 'BRL' },
              installments: { text: '10x {price} sem juros', no_interest: true,
                values: [{ key: 'price', price: { value: 231.54 } }] } } },
            { id: 'highlight', highlight: { text: 'MAIS VENDIDO' } },
          ],
        },
        {
          unique_id: 'VRAI0l9fTe1PduQjrxxuXyynKNq2pHacr8hSIxrumqA',
          metadata: { id: 'MLB3756638061', product_id: 'MLB35955851',
            user_product_id: 'MLBU597517437', type: 'product' },
          pictures: { pictures: [{ id: '636038-MLA100097918507_122025' }], square: 'Q' },
          components: [
            { id: 'title', title: { text: 'Lavadora De Alta Pressão Philco' } },
            { id: 'price', price: { previous_price: { value: 449 },
              current_price: { value: 278.07 }, discount_label: { text: '38% OFF no Pix' },
              installments: { text: '{o} {price_total} {en} 8x {price} sem juros',
                no_interest: true, values: [
                  { key: 'price_total', price: { value: 299 } },
                  { key: 'price', price: { value: 37.38 } },
                ] } } },
            { id: 'affiliates_commission_chip', chip: { pill: { text: 'GANHOS 12%' } } },
          ],
        },
      ],
      contract_version: '1.3.0',
    },
  }
  const produtos = extrairProdutosAfiliados(resposta)
  assert.equal(produtos.length, 2)
  assert.deepEqual(produtos.map((produto) => produto.itemId), ['MLB5125191351', 'MLB3756638061'])
  assert.equal(produtos[0].imagemId, '901684-MLA116661159495_082026')
  assert.equal(produtos[0].imagemUrl,
    'https://http2.mlstatic.com/D_Q_NP_2X_901684-MLA116661159495_082026-AB.webp')
  assert.equal(produtos[0].avaliacao, 4.9)
  assert.equal(produtos[0].vendidosTexto, '+500 vendidos')
  assert.equal(produtos[0].comissaoPercentual, 5)
  assert.equal(produtos[0].linkOriginal,
    'https://www.mercadolivre.com.br/geladeira/p/MLB78198525?extra_comm=false&brand_comm=false#polycard_client=affiliates')
  assert.equal(produtos[1].precoAnterior, 449)
  assert.equal(produtos[1].desconto, '38% OFF no Pix')
  assert.equal(produtos[1].valorParcela, 37.38)
  assert.equal(produtos[1].comissaoPercentual, 12)
})

test('extrai comissão composta e variation_id do objeto pictures', () => {
  const card = {
    unique_id: 'item-real', metadata: { id: 'MLB3201795906', type: 'item' },
    pictures: { pictures: [{ id: '854537-MLB112847468462_072026' }],
      variation_id: '176621315119', sanitized_title: '-kit-capa-sofa' },
    components: [{ id: 'affiliates_commission_chip', chip: {
      pill: { text: '{ganancia} {extra}', values: [
        { key: 'ganancia', label: { text: 'GANHOS' } },
        { key: 'extra', label: { text: 'EXTRAS' } },
      ] }, label: { text: '16%' },
    } }],
  }
  const [produto] = extrairProdutosAfiliados({ polycard_client_model: {
    polycard_context: { picture_template: 'https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp',
      picture_size_default: 'AB', picture_square_default: 'Q' }, polycards: [card],
  } })
  assert.equal(produto.variationId, '176621315119')
  assert.equal(produto.comissaoTexto, 'GANHOS EXTRAS 16%')
  assert.equal(produto.comissaoPercentual, 16)
  assert.equal(produto.imagemUrl,
    'https://http2.mlstatic.com/D_Q_NP_2X_854537-MLB112847468462_072026-AB-kit-capa-sofa.webp')
})

test('deduplica por unique_id e usa metadata.id quando unique_id esta vazio', () => {
  const cardSemUniqueId = { unique_id: '', metadata: { id: 'MLB3' }, pictures: [], components: [] }
  const resposta = {
    polycard_client_model: {
      primeiro: [item, cardSemUniqueId],
      segundo: [{ ...item }, { ...cardSemUniqueId }],
    },
  }
  assert.deepEqual(extrairProdutosAfiliados(resposta).map((produto) => produto.itemId),
    ['MLB2011818434', 'MLB3'])
})

test('reconhece card incompleto com as quatro chaves estruturais', () => {
  const [produto] = extrairProdutosAfiliados({ polycard_client_model: {
    camada: [{ unique_id: 'incompleto-2', metadata: {}, pictures: null, components: null }],
  } })
  assert.equal(produto.itemId, null)
  assert.equal(produto.titulo, null)
  assert.equal(produto.imagemUrl, null)
})

test('retorna lista vazia quando a resposta nao contem cards', () => {
  assert.deepEqual(extrairProdutosAfiliados({ polycard_client_model: {
    polycard_context: { contract_version: '1.3.0' },
    dados: [{ metadata: {}, pictures: [], components: [] }],
  } }), [])
})
