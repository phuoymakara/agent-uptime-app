const region = process.env.AGENT_REGION ?? 'unknown'

function timestamp() {
  return new Date().toISOString()
}

function tag(label: string) {
  return `[${timestamp()}] [${region}] [${label}]`
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.log(`${tag('INFO')} ${msg}${extra}`)
  },

  request: (type: string, url: string, timeout: number) => {
    console.log(`${tag('CHECK')} → type=${type} url=${url} timeout=${timeout}ms`)
  },

  result: (type: string, url: string, result: {
    status: string
    responseTime: number
    statusCode?: number
    message: string
  }) => {
    const code = result.statusCode ? ` code=${result.statusCode}` : ''
    const icon = result.status === 'up' ? '✓' : '✗'
    console.log(
      `${tag('RESULT')} ${icon} type=${type} url=${url} status=${result.status}${code} responseTime=${result.responseTime}ms msg="${result.message}"`
    )
  },

  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : String(err ?? '')
    console.error(`${tag('ERROR')} ${msg}${detail ? ' — ' + detail : ''}`)
  },

  boot: (port: number) => {
    console.log(`${tag('BOOT')} uptime-agent started port=${port} region=${region}`)
  },
}
