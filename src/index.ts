import { serve } from '@hono/node-server'
import app from './app'
import { log } from './logger'

const port = parseInt(process.env.PORT ?? '3001', 10)

serve({ fetch: app.fetch, port }, () => {
  log.boot(port)
})
