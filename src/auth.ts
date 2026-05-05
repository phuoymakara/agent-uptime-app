import { createMiddleware } from 'hono/factory'

const tokenSet = new Set(
  (process.env.AGENT_TOKENS ?? '').split(',').map(t => t.trim()).filter(Boolean)
)

export const auth = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (!tokenSet.has(header.slice(7))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
