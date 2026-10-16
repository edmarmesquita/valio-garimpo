import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        configure(proxy) {
          proxy.on('error', (erro, _req, resposta) => {
            console.error('[api local] Falha no proxy:', {
              status: 502,
              message: 'Backend local indisponível.',
              cause: 'code' in erro && typeof erro.code === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(erro.code)
                ? erro.code : 'ProxyError',
            })
            if ('writeHead' in resposta && !resposta.headersSent && !resposta.writableEnded) {
              resposta.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
              resposta.end(JSON.stringify({ ok: false, erro: 'Não foi possível conectar à API local em localhost:3001. Verifique se o backend está ativo.' }))
            }
          })
        },
      },
    },
  },
})
