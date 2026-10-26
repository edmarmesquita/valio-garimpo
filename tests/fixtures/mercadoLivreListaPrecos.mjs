// Extração sanitizada da captura real: somente identidade pública do anúncio e campos de preço.
const registros = [
  ['MLB7607105104', 869.55, 'BRL', 935, '7% OFF no Pix'],
  ['MLB6797156948', 42, 'BRL', 99.98, '57% OFF'],
  ['MLB5872060016', 39.9, 'BRL', 64.9, '38% OFF'],
  ['MLB7567650428', 991.85, 'BRL', 1044, 'no Pix'],
  ['MLB4171634813', 44, 'BRL', 99.9, '55% OFF'],
  ['MLB5677676192', 23.4, 'BRL', 49.9, '53% OFF'],
  ['MLB6865101456', 95.85, 'BRL', 109, '12% OFF'],
  ['MLB4012712645', 189.99, 'BRL', 590, '67% OFF no Pix'],
  ['MLB7480431976', 62.65, 'BRL', 199.98, '68% OFF no Pix'],
  ['MLB4317803385', 104.31, 'BRL', 299.9, '65% OFF no Pix'],
  ['MLB5070173491', 675.18, 'BRL', 1499, '54% OFF'],
  ['MLB5390599255', 475, 'BRL', 500, '5% OFF no Pix'],
  ['MLB3621404839', 102.5, 'BRL', 206.9, '50% OFF no Pix'],
  ['MLB3573257631', 98.8, 'BRL', 202.9, '51% OFF'],
  ['MLB4931487704', 45.57, 'BRL', 69.9, '34% OFF'],
  ['MLB4480453667', 41.9, 'BRL', 78.99, '46% OFF'],
  ['MLB5419374399', 186.15, 'BRL', 219, '15% OFF no Pix'],
  ['MLB4049279695', 89.9, 'BRL', 169.99, '47% OFF'],
]

export const polycardsListaPrecosMercadoLivre = registros.map(([id, atual, moeda, anterior, desconto]) => ({
  unique_id: `fixture-${id}`,
  metadata: { id },
  pictures: { pictures: [] },
  components: [{ id: 'price', type: 'price', price: {
    previous_price: { value: anterior, currency: moeda },
    current_price: { value: atual, currency: moeda },
    discount_label: { text: desconto },
  } }],
}))

export const htmlListaPrecosMercadoLivre = `<!DOCTYPE html><html><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r = ${JSON.stringify({
  appProps: { pageProps: { components: [{ id: 'recommendations_row', bricks: [{ id: 'recommendations_card', data: {
    recommendations: { polycard_context: {}, polycards: polycardsListaPrecosMercadoLivre },
  } }] }] } },
})};</script></html>`
