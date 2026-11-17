// Runs the mod's real shell scripts (hooks/scripts.ts) on real pictures with this machine's image
// tool. `claude plugin test` cannot start processes, so this is the check for the shell side.
//
//   node --experimental-strip-types plugins/efficient-browser-use/shrink-check/shrink-check.ts
//
// Needs python3 with Pillow to draw the test pictures (and, off macOS, to shrink them).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseShrink, SHRINK, shrinkPlan, sniff, THUMB } from '../hooks/scripts.ts'

const dir = mkdtempSync(join(tmpdir(), 'ebu-check-'))
let failed = 0

function draw(name: string, w: number, h: number, format: string, mode = 'RGB'): string {
  const file = join(dir, name)
  const py = `import sys
from PIL import Image, ImageDraw
w, h = int(sys.argv[2]), int(sys.argv[3])
im = Image.new(sys.argv[5], (w, h), "white" if sys.argv[5] != "P" else 0)
if sys.argv[5] != "P":
    ImageDraw.Draw(im).rectangle([w // 4, h // 4, w // 2, h // 2], fill="black")
im.save(sys.argv[1], sys.argv[4])`
  const r = spawnSync('python3', ['-c', py, file, String(w), String(h), format, mode])
  if (r.status !== 0) throw new Error(`could not draw ${name}: ${r.stderr}`)
  return readFileSync(file).toString('base64')
}

function size(base64: string): [number, number] {
  const r = spawnSync('python3', ['-c', 'import sys,io,base64\nfrom PIL import Image\nim=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read())))\nprint(im.size[0], im.size[1], im.format)'], { input: base64 })
  const [w, h] = String(r.stdout).trim().split(' ')
  return [Number(w), Number(h)]
}

function run(script: string, args: string[], stdin: string, env: Record<string, string> = {}) {
  return spawnSync('/bin/sh', ['-c', script, 'sh', ...args], { input: stdin, env: { ...process.env, ...env }, encoding: 'utf8' })
}

function check(name: string, ok: boolean, said = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !said ? '' : `: ${said}`}`)
}

type Case = { name: string; w: number; h: number; format: string; mode?: string; want: [number, number] | 'skip'; mime: string }
const cases: Case[] = [
  { name: 'png 1600x1000 halves', w: 1600, h: 1000, format: 'PNG', want: [800, 500], mime: 'image/png' },
  { name: 'portrait png 1000x1600 halves', w: 1000, h: 1600, format: 'PNG', want: [500, 800], mime: 'image/png' },
  { name: 'png 600x400 stops at the 512 floor', w: 600, h: 400, format: 'PNG', want: [512, 341], mime: 'image/png' },
  { name: 'png 400x300 is left alone', w: 400, h: 300, format: 'PNG', want: 'skip', mime: 'image/png' },
  { name: 'png at exactly 512 is left alone', w: 512, h: 320, format: 'PNG', want: 'skip', mime: 'image/png' },
  { name: 'jpeg stays jpeg', w: 2000, h: 1200, format: 'JPEG', want: [1000, 600], mime: 'image/jpeg' },
  { name: 'rgba png stays png', w: 1600, h: 1000, format: 'PNG', mode: 'RGBA', want: [800, 500], mime: 'image/png' },
  { name: 'webp becomes png', w: 1200, h: 800, format: 'WEBP', want: [600, 400], mime: 'image/png' },
  { name: 'palette gif becomes png', w: 1200, h: 800, format: 'GIF', mode: 'P', want: [600, 400], mime: 'image/png' },
]

for (const c of cases) {
  const src = draw(`${c.name.replace(/\W+/g, '-')}.${c.format.toLowerCase()}`, c.w, c.h, c.format, c.mode)
  const kind = sniff(src, '')
  const plan = shrinkPlan(kind)
  const work = join(dir, 'work', c.name.replace(/\W+/g, '-'))
  const r = run(SHRINK, [`${work}-in`, `${work}-out.${plan.ext}`, '0.5', '512', plan.fmt], src)
  if (r.status !== 0) {
    check(c.name, false, `exit ${r.status}: ${r.stderr.slice(0, 300)}`)
    continue
  }
  const s = parseShrink(r.stdout)
  if (c.want === 'skip') {
    check(c.name, s.nw === undefined && s.w === c.w && s.h === c.h, JSON.stringify({ ...s, base64: undefined }))
  } else {
    const [w, h] = size(s.base64 ?? '')
    const same = s.nw === c.want[0] && s.nh === c.want[1] && w === c.want[0] && h === c.want[1] && sniff(s.base64 ?? '', '') === c.mime
    check(c.name, same, `reported ${s.nw}x${s.nh}, real ${w}x${h}, ${sniff(s.base64 ?? '', '?')}`)
  }
}

{
  const src = draw('thumb.png', 1600, 1000, 'PNG')
  const r = run(THUMB, [join(dir, 'work', 'thumb-in'), join(dir, 'work', 'thumb.jpg')], src)
  const out = r.stdout.replace(/\s+/g, '')
  const [w, h] = r.status === 0 ? size(out) : [0, 0]
  check('thumbnail is a 160 px jpeg', r.status === 0 && sniff(out, '') === 'image/jpeg' && w === 160 && h === 100, `exit ${r.status} ${r.stderr.slice(0, 200)} ${w}x${h}`)
}

{
  const r = run(SHRINK, [join(dir, 'work', 'none-in'), join(dir, 'work', 'none-out.png'), '0.5', '512', ''], draw('none.png', 1600, 1000, 'PNG'), { EBU_IMAGE_TOOL: 'none' })
  check('no image tool: exit 3 with a message that names the fix', r.status === 3 && r.stderr.includes('no image tool') && r.stderr.includes('Pillow'), `exit ${r.status} ${r.stderr}`)
}

{
  const work = join(dir, 'work')
  const left = existsSync(work) ? readdirSync(work) : []
  check('temp files are removed', left.length === 0, left.join(', '))
}

rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? `\nall ${cases.length + 3} checks passed` : `\n${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
