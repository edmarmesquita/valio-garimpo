import express from 'express'
import backend from '../server/server.js'

const app = express()

app.use((req, _res, next) => {
  const url = new URL(req.url, 'http://localhost')
  const route = url.searchParams.get('__route')

  if (route) {
    url.searchParams.delete('__route')
    req.url = `/api/${route}${url.search}`
  }

  next()
})

app.use(backend)

export default app
