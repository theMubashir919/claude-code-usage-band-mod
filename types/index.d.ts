export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = { percent?: number; tokens?: number; window: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null; now: number; account: Limit[] | null; accountError: string | null }
  }
}
