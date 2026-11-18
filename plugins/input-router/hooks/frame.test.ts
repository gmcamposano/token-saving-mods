import { expect, test } from 'claude-code/testing'
import { frame, unchanged } from './register'

const saved = '/s.txt'
const output = {
  noun: 'output' as const,
  label: 'cmd',
  about: '238 lines, all read; L120 = its line 120.',
  body: 'BODY',
  covers: 'They cover the whole output',
  exact: `Full output: ${saved}. Read short ranges of it (offset/limit) only to quote exact text; they pass through untouched.`,
}

test('the frame around shell-output notes stays under 450 characters', () => {
  const text = frame(saved, output, 'fresh')
  expect(text.length - 'BODY'.length).toBeLessThan(450)
})

test('the frame keeps every instruction: who, scope, where the full text is, how to get it whole', () => {
  const text = frame(saved, output, 'fresh')
  for (const s of ['Haiku (a helper model)', 'written for this task', 'L120', 'no need to re-run', saved, 'only to quote exact text', 'pass through untouched', 'returns these notes', '/input-router full']) {
    expect(text).toContain(s)
  }
  expect(frame(saved, output, 'kept')).toContain('earlier in this chat; the output has not changed since')
  const file = frame('/a/b.rb', { ...output, noun: undefined, about: '10 lines, all read; L120 = its line 120.', covers: 'They cover the whole file' }, 'disk')
  expect(file).toContain('in an earlier chat; the file has not changed since')
  expect(file).toContain('or a range of 100+ lines')
})

test('unchanged: only a file_unchanged result, whatever the build types say', () => {
  expect(unchanged({ type: 'file_unchanged', file: { filePath: '/a' } })).toBe('/a')
  expect(unchanged({ type: 'text', file: { filePath: '/a' } })).toBeNull()
  expect(unchanged(undefined)).toBeNull()
})
