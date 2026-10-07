// Node 26 no Windows pode falhar em uv_os_get_passwd no ambiente de teste.
const os = require('node:os')
try { os.userInfo() } catch {
  os.userInfo = () => ({ username: process.env.USERNAME || 'test', uid: -1, gid: -1, shell: null, homedir: os.homedir() })
}

const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = String(input)
  if (url.startsWith('https://produto.mercadolivre.com.br/MLB-')) {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/public/${new URL(url).pathname.slice(1)}`, init)
  }
  if (url === 'https://api.mercadolibre.com/oauth/token') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/oauth/token`, init)
  }
  if (url === 'https://api.mercadolibre.com/users/me') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/users/me`, init)
  }
  if (url === 'https://api.mercadolibre.com/applications/6332151948097527/grants') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/applications/6332151948097527/grants`, init)
  }
  if (url === 'https://api.mercadolibre.com/applications/6332151948097527') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/applications/6332151948097527`, init)
  }
  if (url === 'https://api.mercadolibre.com/users/3334862827?attributes=status') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/users/3334862827?attributes=status`, init)
  }
  if (url === 'https://api.mercadolibre.com/applications/v1/6332151948097527/consumed-applications') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/applications/v1/6332151948097527/consumed-applications`, init)
  }
  if (url === 'https://api.mercadolibre.com/items/bulk?ids=MLB4045941169') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/items/bulk?ids=MLB4045941169`, init)
  }
  if (url === 'https://api.mercadolibre.com/sites/MLB/search?q=tenis%20carina%20street%20puma') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/sites/MLB/search?q=tenis%20carina%20street%20puma`, init)
  }
  if (url.startsWith('https://api.mercadolibre.com/items/')) {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/items/${url.split('/').pop()}`, init)
  }
  return originalFetch(input, init)
}
