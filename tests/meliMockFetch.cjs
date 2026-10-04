// Node 26 no Windows pode falhar em uv_os_get_passwd no ambiente de teste.
const os = require('node:os')
try { os.userInfo() } catch {
  os.userInfo = () => ({ username: process.env.USERNAME || 'test', uid: -1, gid: -1, shell: null, homedir: os.homedir() })
}

const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = String(input)
  if (url === 'https://api.mercadolibre.com/oauth/token') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/oauth/token`, init)
  }
  if (url === 'https://api.mercadolibre.com/users/me') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/users/me`, init)
  }
  if (url === 'https://api.mercadolibre.com/applications/6332151948097527/grants') {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/applications/6332151948097527/grants`, init)
  }
  if (url.startsWith('https://api.mercadolibre.com/items/')) {
    return originalFetch(`http://127.0.0.1:${process.env.MELI_TEST_PROVIDER_PORT}/items/${url.split('/').pop()}`, init)
  }
  return originalFetch(input, init)
}
