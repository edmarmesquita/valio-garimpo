// Estrutura sintética: não contém dados de capturas reais.
export const cardHar = (id = 'MLB123', preco = 90, options = {}) => ({
  metadata: { id, product_id: 'MLB456', user_product_id: 'MLBU789',
    url: 'www.mercadolivre.com.br/produto-teste/p/MLB456',
    url_fragments: '#polycard_client=affiliates&wid=MLB123&sid=affiliates',
    url_params: '?pdp_filters=item_id%3AMLB123&extra_comm=true&brand_comm=false',
    extra_commission: 'true', brand_commission: 'false', ...options.metadata },
  components: [{ type: 'title', title: { text: options.titulo ?? 'Produto sintético' } },
    { id: 'price', price: { current_price: { value: preco, currency: options.moeda ?? 'BRL' },
      ...(options.anterior === undefined ? {} : { previous_price: { value: options.anterior } }),
      ...(options.label === undefined ? {} : { discount_label: { text: options.label } }) } }],
})
export const entradaHar = (cards = [cardHar()], options = {}) => ({
  request: { url: options.url ?? 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop' },
  response: { status: options.status ?? 200, content: { mimeType: 'application/json',
    text: JSON.stringify({ polycard_client_model: { polycards: cards } }), ...options.content } },
})
export const arquivoHar = (...entries) => JSON.stringify({ log: { version: '1.2', entries } })
export const catalogoHar = (id = 'MLB123', options = {}) => ({ mercadoLivreId: id, titulo: 'Produto sintético', preco: 100,
  ativo: true, dataPreco: '21/10/2026', updatedAt: '', categoria: 'Achados para Casa',
  linkAfiliado: '', imagem: '', rating: null, ...options })
