function timestamp() {
  return new Date().toISOString()
}

function tag(region: string, label: string) {
  return `[${timestamp()}] [${region}] [${label}]`
}

export function createLogger(region: string) {
  return {
    info: (msg: string, data?: Record<string, unknown>) => {
      const extra = data ? ' ' + JSON.stringify(data) : ''
      console.log(`${tag(region, 'INFO')} ${msg}${extra}`)
    },

    request: (type: string, url: string, timeout: number) => {
      console.log(`${tag(region, 'CHECK')} → type=${type} url=${url} timeout=${timeout}ms`)
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
        `${tag(region, 'RESULT')} ${icon} type=${type} url=${url} status=${result.status}${code} responseTime=${result.responseTime}ms msg="${result.message}"`
      )
    },

    error: (msg: string, err?: unknown) => {
      const detail = err instanceof Error ? err.message : String(err ?? '')
      console.error(`${tag(region, 'ERROR')} ${msg}${detail ? ' — ' + detail : ''}`)
    },
  }
}
