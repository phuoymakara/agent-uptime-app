import { createConnection } from 'net'
import { exec } from 'child_process'
import type { CheckAssert, CheckRequest, CheckResult, AttemptDetail } from './types'

const DEFAULT_TIMEOUT     = 5000
const DEFAULT_RETRIES     = 2
const DEFAULT_RETRY_DELAY = 150
const MAX_RETRIES         = 5
// Total budget per check: (attempts × timeout) + (delays) must stay under this.
// Lambda timeout is 30s — keep well clear of it so the response can still be returned.
const MAX_TOTAL_BUDGET_MS = 20_000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isExpectedStatus(status: number, expectedStatus?: number[]): boolean {
  if (expectedStatus?.length) return expectedStatus.includes(status)
  return status >= 200 && status < 400
}

function classifyError(err: any, timeout: number): string {
  if (err?.name === 'AbortError')    return `Timed out after ${timeout}ms`
  if (err?.code === 'ENOTFOUND')     return 'DNS lookup failed'
  if (err?.code === 'ECONNREFUSED')  return 'Connection refused'
  if (err?.code === 'ECONNRESET')    return 'Connection reset'
  return err?.message ?? 'Request failed'
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function performCheck({
  type,
  url,
  method         = 'GET',
  timeout        = DEFAULT_TIMEOUT,
  retries        = DEFAULT_RETRIES,
  retryDelay     = DEFAULT_RETRY_DELAY,
  expectedStatus,
  headers        = {},
  body,
  assert,
}: CheckRequest): Promise<CheckResult> {
  const clampedRetries = Math.min(retries, MAX_RETRIES)

  // Shrink retries if the full plan would exceed the total budget.
  // e.g. timeout=8000, retries=5 → budget allows only 2 retries (3 attempts × 8000 = 24000 > 20000)
  const maxAffordableAttempts = Math.max(1, Math.floor(MAX_TOTAL_BUDGET_MS / (timeout + retryDelay)))
  const safeRetries = Math.min(clampedRetries, maxAffordableAttempts - 1)

  if (type === 'tcp') return checkTcp(url, timeout, safeRetries, retryDelay)
  if (type === 'ping') return checkPing(url, timeout, safeRetries, retryDelay)
  return checkHttp(url, method, timeout, safeRetries, retryDelay, expectedStatus, headers, body, assert)
}

// ── HTTP ──────────────────────────────────────────────────────────────────

interface AttemptResult {
  success: boolean
  responseTime: number
  statusCode?: number
  message: string
}

async function attemptHttp(
  url: string,
  method: string,
  timeout: number,
  headers: Record<string, string>,
  body: string | undefined,
  assert: CheckAssert | undefined,
  expectedStatus: number[] | undefined,
): Promise<AttemptResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const start = performance.now()

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    clearTimeout(timer)

    const responseTime = Math.round(performance.now() - start)

    if (assert) {
      const text = await res.text()
      if (!text.includes(assert.value)) {
        return {
          success: false,
          responseTime,
          statusCode: res.status,
          message: `Assert failed: body does not include "${assert.value}"`,
        }
      }
    } else {
      res.body?.cancel().catch(() => {})
    }

    return {
      success: isExpectedStatus(res.status, expectedStatus),
      responseTime,
      statusCode: res.status,
      message: `${res.status} ${res.statusText}`,
    }
  } catch (err: any) {
    clearTimeout(timer)
    return {
      success: false,
      responseTime: Math.round(performance.now() - start),
      message: classifyError(err, timeout),
    }
  }
}

async function checkHttp(
  url: string,
  method: string,
  timeout: number,
  retries: number,
  retryDelay: number,
  expectedStatus: number[] | undefined,
  headers: Record<string, string>,
  body: string | undefined,
  assert: CheckAssert | undefined,
): Promise<CheckResult> {
  const mergedHeaders = { 'User-Agent': 'UptimeMonitor/1.0', ...headers }
  const maxAttempts = 1 + retries
  const attemptDetails: AttemptDetail[] = []
  let last!: AttemptResult

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await delay(retryDelay)

    last = await attemptHttp(url, method, timeout, mergedHeaders, body, assert, expectedStatus)

    if (last.success) {
      attemptDetails.push({ success: true, responseTime: last.responseTime, statusCode: last.statusCode })
      break
    }

    attemptDetails.push({ success: false, statusCode: last.statusCode, error: last.message })
  }

  const failures = attemptDetails.filter(a => !a.success).length
  const successDetail = attemptDetails.find(a => a.success)

  return {
    status: last.success ? 'up' : 'down',
    responseTime: successDetail?.responseTime ?? last.responseTime,
    statusCode: last.statusCode,
    message: last.message,
    attempts: attemptDetails.length,
    failures,
    attemptDetails,
  }
}

// ── TCP ───────────────────────────────────────────────────────────────────

async function attemptTcp(host: string, port: number, timeout: number): Promise<AttemptResult> {
  const start = performance.now()
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    socket.setTimeout(timeout)

    socket.once('connect', () => {
      socket.destroy()
      resolve({ success: true, responseTime: Math.round(performance.now() - start), message: 'Connection successful' })
    })

    socket.once('error', (err) => {
      socket.destroy()
      resolve({ success: false, responseTime: Math.round(performance.now() - start), message: err.message })
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve({ success: false, responseTime: Math.round(performance.now() - start), message: `Timed out after ${timeout}ms` })
    })
  })
}

async function checkTcp(
  address: string,
  timeout: number,
  retries: number,
  retryDelay: number,
): Promise<CheckResult> {
  const cleaned = address.replace(/^tcp:\/\//, '')
  const lastColon = cleaned.lastIndexOf(':')
  const host = cleaned.slice(0, lastColon)
  const port = parseInt(cleaned.slice(lastColon + 1), 10)

  const maxAttempts = 1 + retries
  const attemptDetails: AttemptDetail[] = []
  let last!: AttemptResult

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await delay(retryDelay)

    last = await attemptTcp(host, port, timeout)

    if (last.success) {
      attemptDetails.push({ success: true, responseTime: last.responseTime })
      break
    }

    attemptDetails.push({ success: false, error: last.message })
  }

  const failures = attemptDetails.filter(a => !a.success).length
  const successDetail = attemptDetails.find(a => a.success)

  return {
    status: last.success ? 'up' : 'down',
    responseTime: successDetail?.responseTime ?? last.responseTime,
    message: last.message,
    attempts: attemptDetails.length,
    failures,
    attemptDetails,
  }
}

// ── Ping (ICMP) ───────────────────────────────────────────────────────────
// Uses the system ping binary via child_process.
// On Amazon Linux (Lambda runtime) the ping binary has the setuid bit set,
// so ICMP sockets work without root. On Windows the same binary is used
// with different flags, making local dev work transparently.

async function attemptPing(host: string, timeout: number): Promise<AttemptResult> {
  const isWindows = process.platform === 'win32'

  // -c 1 / -n 1 : send exactly one packet
  // -W / -w      : deadline in seconds (Linux) / milliseconds (Windows)
  const cmd = isWindows
    ? `ping -n 1 -w ${timeout} ${host}`
    : `ping -c 1 -W ${Math.ceil(timeout / 1000)} ${host}`

  const start = performance.now()

  return new Promise(resolve => {
    exec(cmd, { timeout: timeout + 1000 }, (error, stdout) => {
      const elapsed = Math.round(performance.now() - start)

      if (error) {
        const message = elapsed >= timeout ? `Timed out after ${timeout}ms` : 'Host unreachable'
        resolve({ success: false, responseTime: elapsed, message })
        return
      }

      // Linux:   "time=5.32 ms"  or  "time=0.45 ms"
      // Windows: "time=5ms"      or  "time<1ms"
      const match = stdout.match(/time[=<]([\d.]+)\s*ms/i)
      const pingMs = match ? Math.round(parseFloat(match[1])) : elapsed

      resolve({ success: true, responseTime: pingMs, message: 'Host reachable' })
    })
  })
}

async function checkPing(
  address: string,
  timeout: number,
  retries: number,
  retryDelay: number,
): Promise<CheckResult> {
  const host = address.replace(/^(ping|icmp):\/\//, '').split(':')[0]

  const maxAttempts = 1 + retries
  const attemptDetails: AttemptDetail[] = []
  let last!: AttemptResult

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await delay(retryDelay)

    last = await attemptPing(host, timeout)

    if (last.success) {
      attemptDetails.push({ success: true, responseTime: last.responseTime })
      break
    }

    attemptDetails.push({ success: false, error: last.message })
  }

  const failures = attemptDetails.filter(a => !a.success).length
  const successDetail = attemptDetails.find(a => a.success)

  return {
    status: last.success ? 'up' : 'down',
    responseTime: successDetail?.responseTime ?? last.responseTime,
    message: last.message,
    attempts: attemptDetails.length,
    failures,
    attemptDetails,
  }
}
