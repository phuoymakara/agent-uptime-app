import { createConnection } from 'net'
// import ping from 'ping'
import type { CheckRequest, CheckResult } from './types'

export async function performCheck({ type, url, timeout = 10000 }: CheckRequest): Promise<CheckResult> {
  if (type === 'tcp') return checkTcp(url, timeout)
  // if (type === 'ping') return checkPing(url, timeout)
  return checkHttp(url, timeout)
}

async function checkHttp(url: string, timeout: number): Promise<CheckResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timer)
    const responseTime = Date.now() - start
    return {
      status: res.status < 400 ? 'up' : 'down',
      responseTime,
      statusCode: res.status,
      message: `${res.status} ${res.statusText}`,
    }
  } catch (err: any) {
    return {
      status: 'down',
      responseTime: Date.now() - start,
      message: err?.message ?? 'Request failed',
    }
  }
}

async function checkTcp(address: string, timeout: number): Promise<CheckResult> {
  const cleaned = address.replace(/^tcp:\/\//, '')
  const lastColon = cleaned.lastIndexOf(':')
  const host = cleaned.slice(0, lastColon)
  const port = parseInt(cleaned.slice(lastColon + 1), 10)
  const start = Date.now()

  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    socket.setTimeout(timeout)

    socket.once('connect', () => {
      socket.destroy()
      resolve({ status: 'up', responseTime: Date.now() - start, message: 'Connection successful' })
    })

    socket.once('error', (err) => {
      socket.destroy()
      resolve({ status: 'down', responseTime: Date.now() - start, message: err.message })
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve({ status: 'down', responseTime: Date.now() - start, message: 'Connection timed out' })
    })
  })
}
