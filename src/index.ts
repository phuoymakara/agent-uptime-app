import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { auth } from './auth'
import { performCheck } from './checker'
import type { CheckRequest } from './types'

const app = new Hono()
const region = process.env.AGENT_REGION ?? 'unknown'
const port = parseInt(process.env.PORT ?? '3001', 10)

app.get('/health', (c) => c.json({ ok: true, region, version: '1.0.0' }))

app.post('/check', auth, async (c) => {
  let body: CheckRequest
  try {
    body = await c.req.json<CheckRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.type || !body.url) {
    return c.json({ error: 'Missing required fields: type, url' }, 400)
  }

  if (!['http', 'tcp', 'ping'].includes(body.type)) {
    return c.json({ error: 'Invalid type, must be http, tcp, or ping' }, 400)
  }

  const result = await performCheck(body)
  return c.json(result)
})

serve({ fetch: app.fetch, port }, () => {
  console.log(`[uptime-agent] port=${port} region=${region}`)
})
