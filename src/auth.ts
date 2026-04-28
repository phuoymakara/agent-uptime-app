import { createMiddleware } from 'hono/factory'
import type { Env } from './types'

export const auth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const tokens = (c.env.AGENT_TOKENS ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  if (!tokens.includes(header.slice(7))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
