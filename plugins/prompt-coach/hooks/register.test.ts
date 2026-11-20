import { expect, test } from 'claude-code/testing'
import { esCaraYVaga, isMainTurn } from './register'

test('the repo check runs on main-chat turns only', () => {
  expect(isMainTurn({})).toBe(true)
  expect(isMainTurn({ agentId: 'a1' })).toBe(false)
})

test('gate fires on short costly prompts without detail', () => {
  for (const p of ['haz deploy a prod', 'migra la base', 'borra la rama vieja', 'push a producción']) expect(esCaraYVaga(p)).toBe(true)
})

test('gate stays quiet with detail, criteria or harmless prompts', () => {
  for (const p of [
    'migra `users` a la tabla nueva',
    'deploy de app/web, listo cuando pasen los tests',
    'borra config.yml',
    'push sin preguntar',
    'actualiza la skill de arquibusco',
    'haz deploy a prod del servicio api. ' + 'x'.repeat(120),
  ]) expect(esCaraYVaga(p)).toBe(false)
})
