export type CheckType = 'http' | 'tcp' | 'ping'
export type CheckMethod = 'HEAD' | 'GET' | 'POST' | 'PUT'

export interface CheckAssert {
  type: 'includes'
  value: string
}

export interface CheckRequest {
  type: CheckType
  url: string
  method?: CheckMethod          // default: GET — use HEAD when no assert needed (faster)
  timeout?: number              // ms, default: 5000
  retries?: number              // default: 2  (3 total attempts), capped at 5
  retryDelay?: number           // ms between retries, default: 150
  expectedStatus?: number[]     // default: 200–399
  headers?: Record<string, string>
  body?: string                 // optional request body (HTTP only)
  assert?: CheckAssert          // optional body content assertion (HTTP only)
}

export interface AttemptDetail {
  success: boolean
  responseTime?: number
  statusCode?: number
  error?: string
}

export interface CheckResult {
  status: 'up' | 'down'
  responseTime: number
  statusCode?: number
  message: string
  attempts: number
  failures: number
  attemptDetails: AttemptDetail[]
}
