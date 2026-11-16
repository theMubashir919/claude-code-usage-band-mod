import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
// Account-wide limits from the usage endpoint: counts every window/device on the account, not just this one
const account = atom({ plugin: 'usage-band', key: 'account' } as const, null)
const accountError = atom({ plugin: 'usage-band', key: 'accountError' } as const, null)

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const LABELS: Record<string, string> = { five_hour: 'session', seven_day: 'week', spend_limit: 'spend' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const toUsage = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage => ({
  percent: context.percent,
  tokens: context.tokens,
  window: context.window,
  limits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
})

export const bar = (pct: number, width = 8) => {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const color = (pct: number) => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')

export const kTokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

export const remaining = (ms: number) => {
  if (ms <= 0) return 'resetting'
  const m = Math.floor(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m % 60}m`
}

// Local wall-clock time; adds the weekday when the reset isn't today.
export const clockTime = (at: Date, from: Date) => {
  const h = at.getHours()
  const hm = `${h % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return at.toDateString() === from.toDateString() ? hm : `${DAYS[at.getDay()]} ${hm}`
}

// Pulls the figures too, so the band stays live mid-turn (session.measure only fires after a turn)
async function refresh($: EngineInterface) {
  const { context, rateLimits } = await $.session.usage()
  const t = await $.clock.now()
  await update($, usage, () => toUsage(context, rateLimits))
  await update($, now, () => t)
}

type Window = { utilization?: number | null; resets_at?: string | null } | null | undefined

export const parseAccount = (j: Record<string, Window>): Limit[] =>
  (['five_hour', 'seven_day'] as const).flatMap(kind => {
    const w = j[kind]
    return typeof w?.utilization === 'number'
      ? [{ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt: w.resets_at ?? undefined }]
      : []
  })

let lastPoll = 0

async function pollAccount($: EngineInterface) {
  const t = await $.clock.now()
  if (t - lastPoll < 15_000) return
  lastPoll = t
  try {
    const auth = await $.session.authorize()
    if (auth?.kind !== 'bearer') return // API-key / 3P login: no account limits to poll
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (!r.ok) return void (await update($, accountError, () => `HTTP ${r.status}`))
    const limits = parseAccount(JSON.parse(r.text))
    await update($, account, () => limits)
    await update($, accountError, () => null)
  } catch (err) {
    await update($, accountError, () => String(err).slice(0, 60))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    lastPoll = 0
    await pollAccount($)
    $.clock.every(30_000, () => refresh($))
    $.clock.every(60_000, () => pollAccount($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    await update($, now, () => t)
    await pollAccount($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const u = await read($, usage)
    if (e.props.hasSurvey || u === null) return next(e)

    const t = (await read($, now)) || (await $.clock.now())
    const acct = await read($, account)
    const acctErr = await read($, accountError)
    const limits = acct ?? u.limits
    const { Box, Text } = $.ui.resolve(e)
    const ctx = u.percent ?? 0
    const ctxText = u.percent === undefined ? '-' : `${ctx}%`

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor>ctx </Text>
        <Text color={color(ctx)}>{bar(ctx)} {ctxText}</Text>
        <Text dimColor> {u.tokens === undefined ? '-' : kTokens(u.tokens)}/{kTokens(u.window)}</Text>
        {limits.map(l => {
          const reset = l.resetsAt ? new Date(l.resetsAt) : null
          return (
            <Box key={l.kind} flexDirection="row">
              <Text dimColor> │ {LABELS[l.kind] ?? l.kind} </Text>
              <Text color={color(l.percentUsed)}>{bar(l.percentUsed, 6)} {l.percentUsed}%</Text>
              {reset && (
                <Text dimColor>
                  {' '}· {remaining(reset.getTime() - t)} left ({clockTime(reset, new Date(t))})
                </Text>
              )}
            </Box>
          )
        })}
        {limits.length === 0 && <Text dimColor> │ plan limits appear after the first reply</Text>}
        {acctErr && <Text color="yellow"> │ account usage: {acctErr}</Text>}
      </Box>
    )
  })
}
