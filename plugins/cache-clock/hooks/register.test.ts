import { expect, test } from 'claude-code/testing'
import { PING_PROMPT } from './register'

test('the keep-warm ping asks for a one-word answer with no thinking', () => {
  expect(PING_PROMPT).toContain('single word ok')
  expect(PING_PROMPT).toContain('without thinking')
  expect(PING_PROMPT.length).toBeLessThan(120)
})
