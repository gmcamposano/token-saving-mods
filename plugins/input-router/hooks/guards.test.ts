import { expect, test } from 'claude-code/testing'
import { catFile, diskTargets, findStyle, fromScript, isInstruction, isReader, mentions, parsePages, programs, rangeIn } from './register'

test('programs: skips env vars, starters and their flags, sees through pipes, && and $()', () => {
  expect(programs('cd /x && FOO=1 sudo -u me sed -n 1,5p f | head')).toEqual(['cd', 'sed', 'head'])
  expect(programs('echo "a | b" ; /usr/bin/cat f')).toEqual(['echo', 'cat'])
  expect(programs('x=$(grep -c foo f)')).toEqual(['grep'])
})

test('isReader: file and API reads only; never tests, builds, git or scripts', () => {
  expect(isReader('cat a.txt')).toBe(true)
  expect(isReader('grep -n foo f | sort | uniq')).toBe(true)
  expect(isReader('curl -s https://api.example.com/x | jq .')).toBe(true)
  expect(isReader('bin/rails test')).toBe(false)
  expect(isReader('git log -p')).toBe(false)
  expect(isReader('cat x.py | python3')).toBe(false)
  expect(isReader('ls -la')).toBe(false)
})

test('Guard C, findStyle: listing or counting greps and finds read nothing; context makes it a read', () => {
  expect(findStyle('grep -rl foo .')).toBe(true)
  expect(findStyle('grep -c foo f')).toBe(true)
  expect(findStyle('rg --files-with-matches foo')).toBe(true)
  expect(findStyle('find . -name "*.rb" | sort')).toBe(true)
  expect(findStyle('grep -rn foo .')).toBe(false)
  expect(findStyle('grep -c -C3 foo f')).toBe(false)
  // rg -L follows links; it does not list files.
  expect(findStyle('rg -L foo')).toBe(false)
  expect(findStyle('grep -l foo f | xargs cat')).toBe(false)
})

test('Guard B, isInstruction: skills, CLAUDE.md, AGENTS.md, memory and settings pass word for word', () => {
  for (const p of [
    '/repo/AGENTS.md',
    '/repo/CLAUDE.md',
    '/x/skills/rails/SKILL.md',
    '/x/skills/rails/reference.md',
    '/home/u/.claude/projects/-home-u-app/memory/MEMORY.md',
    '/home/u/.claude/settings.json',
    '/repo/.claude/settings.local.json',
    '/home/u/.claude/mods/switches.json',
  ])
    expect(isInstruction(p)).toBe(true)
  expect(isInstruction('/repo/README.md')).toBe(false)
  expect(isInstruction('/repo/config/settings.yml')).toBe(false)
})

test('catFile: only a lone cat of an absolute path', () => {
  expect(catFile('cat /a/b.txt')).toBe('/a/b.txt')
  expect(catFile("cat '/a b/c.log'")).toBe('/a b/c.log')
  expect(catFile('cat rel.txt')).toBeNull()
  expect(catFile('cat /a/b.txt | head')).toBeNull()
})

test('rangeIn: the lines sed, head, tail, awk and cat print', () => {
  expect(rangeIn("sed -n '10,20p' f", 100)).toEqual({ from: 10, to: 20 })
  expect(rangeIn('sed -n 5p f', 100)).toEqual({ from: 5, to: 5 })
  expect(rangeIn("sed -n '90,$p' f", 100)).toEqual({ from: 90, to: 100 })
  expect(rangeIn('head -n 30 f', 100)).toEqual({ from: 1, to: 30 })
  expect(rangeIn('tail -n 10 f', 100)).toEqual({ from: 91, to: 100 })
  expect(rangeIn('tail -n +95 f', 100)).toEqual({ from: 95, to: 100 })
  expect(rangeIn("awk 'NR>=3 && NR<=7' f", 100)).toEqual({ from: 3, to: 7 })
  expect(rangeIn('cat f', 100)).toEqual({ from: 1, to: 100 })
  expect(rangeIn('head -n 500 f', 100)).toEqual({ from: 1, to: 100 })
  expect(rangeIn('sed -n 200,300p f', 100)).toBeNull()
  expect(rangeIn('grep x f', 100)).toBeNull()
})

test('diskTargets: where a read goes to disk instead of the chat', () => {
  expect(diskTargets('curl -s -o out.json https://x')).toEqual(['out.json'])
  expect(diskTargets('wget -O page.html https://x')).toEqual(['page.html'])
  expect(diskTargets('cat a >> "my log.txt"')).toEqual(['my log.txt'])
  expect(diskTargets('cat a | tee -a log.txt')).toEqual(['log.txt'])
  expect(diskTargets('cat a > /dev/null')).toEqual([])
  expect(diskTargets("grep '>' f")).toEqual([])
  expect(diskTargets('grep -o foo f')).toEqual([])
  expect(diskTargets('cat a 2>&1')).toEqual([])
  expect(diskTargets('cat > f.txt <<EOF\nhello\nEOF')).toEqual([])
})

test('mentions: a whole path, not part of a longer name', () => {
  expect(mentions('cat /a/big.log | head', '/a/big.log')).toBe(true)
  expect(mentions('cat "/a/big.log"', '/a/big.log')).toBe(true)
  expect(mentions('cat /a/big.log2', '/a/big.log')).toBe(false)
})

test('parsePages: whole, one page, ranges, open ranges and bad values', () => {
  expect(parsePages(undefined, 10)).toEqual({ first: 1, last: 10 })
  expect(parsePages('3', 10)).toEqual({ first: 3, last: 3 })
  expect(parsePages('3-5', 10)).toEqual({ first: 3, last: 5 })
  expect(parsePages('8-', 10)).toEqual({ first: 8, last: 10 })
  expect(parsePages('4-40', 10)).toEqual({ first: 4, last: 10 })
  expect(parsePages('12', 10)).toBeNull()
  expect(parsePages('a-b', 10)).toBeNull()
})

test('Guard E, fromScript: calls a REPL script makes pass untouched; the model own calls do not', () => {
  expect(fromScript({ tool_use_id: 'repl_de6364b9-f483-485d-bf47-a9938d91586b' })).toBe(true)
  expect(fromScript({ tool_use_id: 'toolu_01H71TQuWR9Q7SphSy91QWeP' })).toBe(false)
  expect(fromScript({})).toBe(false)
})
