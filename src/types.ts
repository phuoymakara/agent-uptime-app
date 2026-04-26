export type CheckType = 'http' | 'tcp'

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
