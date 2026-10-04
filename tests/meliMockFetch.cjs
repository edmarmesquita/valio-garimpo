const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = String(input)
  if (url === 'https://api.mercadolibre.com/oauth/token') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/oauth/token`, init)
  }
  if (url === 'https://api.mercadolibre.com/users/me') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/users/me`, init)
  }
  return originalFetch(input, init)
}
