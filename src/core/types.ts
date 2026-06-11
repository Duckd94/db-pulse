export type ProbeFunction = () => Promise<
  { responseTimeMs?: number; metadata?: Record<string, unknown> } | void
>

export interface ProbeConfig {
  interval: number
  timeout?: number
}

export interface ProbeResult {
  name: string
  status: 'up' | 'down'
  responseTimeMs: number | null
  timestamp: string
  error: string | null
  metadata: Record<string, unknown>
}

export type WebhookPayload = ProbeResult

export interface WebhookOptions {
  headers?: Record<string, string>
  onlyOnChange?: boolean
}

export interface SignalDocksOptions {
  monitors: Record<string, string>
}

export interface RegisteredProbe {
  name: string
  fn: ProbeFunction
  config: Required<ProbeConfig>
}
