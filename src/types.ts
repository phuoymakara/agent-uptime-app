export type CheckType = 'http' | 'tcp' | 'ping'

export interface CheckRequest {
  type: CheckType
  url: string
  timeout?: number
}

export interface CheckResult {
  status: 'up' | 'down'
  responseTime: number
  statusCode?: number
  message: string
}

export type Env = {
  Bindings: {
    AGENT_TOKENS: string
    AGENT_REGION: string
  }
}
