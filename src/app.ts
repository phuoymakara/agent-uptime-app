import { Hono } from 'hono'
import { auth } from './auth'
import { performCheck } from './checker'
import { log } from './logger'
import type { CheckRequest } from './types'

const region = process.env.AGENT_REGION ?? 'unknown'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ ok: true, region, commit: __COMMIT__ ?? 'unknown', builtAt: __BUILT_AT__ ?? 'unknown' })
})

app.post('/check', auth, async (c) => {
  let body: CheckRequest
  try {
    body = await c.req.json<CheckRequest>()
  } catch {
    log.error('invalid JSON body from ' + (c.req.header('x-forwarded-for') ?? 'unknown'))
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  log.info('received check request', { body })

  if (!body.type || !body.url) {
    log.error('missing required fields', { body })
    return c.json({ error: 'Missing required fields: type, url' }, 400)
  }

  if (!['http', 'tcp', 'ping'].includes(body.type)) {
    log.error(`invalid type "${body.type}"`)
    return c.json({ error: 'Invalid type, must be http, tcp, or ping' }, 400)
  }

  log.request(body.type, body.url, body.timeout ?? 5000)
  const result = await performCheck(body)
  log.result(body.type, body.url, result)

  return c.json(result)
})

export default app
