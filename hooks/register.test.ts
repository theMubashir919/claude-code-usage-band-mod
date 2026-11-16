import { expect, mock, test } from 'claude-code/testing'

import { bar, clockTime, kTokens, remaining } from './register'

const T0 = Date.parse('2026-10-05T10:00:00Z')
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('helpers', () => {
  expect(bar(50, 8)).toBe('████░░░░')
  expect(bar(150, 4)).toBe('████')
  expect(kTokens(84_321)).toBe('84k')
  expect(kTokens(1_000_000)).toBe('1M')
  expect(remaining(2 * 3600_000 + 14 * 60_000)).toBe('2h14m')
  expect(remaining((3 * 24 + 4) * 3600_000)).toBe('3d4h')
  expect(remaining(-1)).toBe('resetting')
  const day = new Date(2026, 9, 5, 9, 0)
  expect(clockTime(new Date(2026, 9, 5, 0, 5), day)).toBe('12:05 AM')
  expect(clockTime(new Date(2026, 9, 5, 12, 0), day)).toBe('12:00 PM')
  expect(clockTime(new Date(2026, 9, 5, 14, 30), day)).toBe('2:30 PM')
  expect(clockTime(new Date(2026, 9, 9, 21, 7), day)).toBe('Fri 9:07 PM')
})

test('band shows context and limits, countdown ticks', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(T0 + 3 * 3600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 76 * 3600_000).toISOString() },
    ],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /84k\/200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3h00m left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3d4h left/ })).toBeDefined()
    await ui.unmount()
  }

  // No session.start in this test, so drive the tick via another measure after time passes
  await clock.advance(60 * 60_000)
  await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(T0 + 3 * 3600_000).toISOString() },
  ], changed: ['rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /2h00m left/ })).toBeDefined()
})

test('session.start timer keeps the countdown live with no turns', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  let pct = 10
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { tokens: 20_000, window: 200_000, percent: pct },
      rateLimits: [{ kind: 'five_hour', percentUsed: 5, resetsAt: new Date(T0 + 3600_000).toISOString() }],
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /1h00m left/ })).toBeDefined()

  pct = 55
  await clock.advance(31 * 60_000)
  expect(await ui.find({ type: 'Text', text: /29m left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /55%/ })).toBeDefined()
})

test('account poll picks up usage from other windows with no turns here', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  let acct = 20
  on('session.usage', () => ({
    value: { startedAt: T0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [] },
  }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('http.fetch', (_$, e) => {
    expect(e.url).toBe('https://api.anthropic.com/api/oauth/usage')
    const body = {
      five_hour: { utilization: acct, resets_at: new Date(T0 + 3600_000).toISOString() },
      seven_day: { utilization: 8, resets_at: null },
      seven_day_opus: null,
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /20%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /week/ })).toBeDefined()

  acct = 64 // another window burned usage
  await clock.advance(61_000)
  expect(await ui.find({ type: 'Text', text: /64%/ })).toBeDefined()
})
