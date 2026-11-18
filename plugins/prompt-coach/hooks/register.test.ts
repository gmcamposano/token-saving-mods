import { expect, test } from 'claude-code/testing'
import { isMainTurn } from './register'

test('the repo check runs on main-chat turns only', () => {
  expect(isMainTurn({})).toBe(true)
  expect(isMainTurn({ agentId: 'a1' })).toBe(false)
})
