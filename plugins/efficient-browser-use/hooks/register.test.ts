import { expect, test } from 'claude-code/testing'
import { bytesOf, findImages, findTexts, HINT, hint, imageTokens, ownSizes, relabel, setBytes } from './register.ts'

type Obj = Record<string, unknown>
const quiet = () => undefined

// ---- tokens ----

test('imageTokens is w x h / 750, rounded up', () => {
  expect(imageTokens(800, 500)).toBe(534)
  expect(imageTokens(750, 1)).toBe(1)
})

test('imageTokens caps at the API long side of 1568 px', () => {
  // 3136x1960 is scaled to 1568x980 by the API before the model sees it.
  expect(imageTokens(3136, 1960)).toBe(imageTokens(1568, 980))
  expect(imageTokens(1600, 1000)).toBe(Math.ceil((1568 * 980) / 750))
})

// ---- the coordinate frame: clicks depend on it ----

test('relabel turns an unscaled screenshot line into a scaled view of the same frame', () => {
  const t = { type: 'text', text: 'Took it.\nScreenshot size: 1600x1000\nDone.' }
  expect(relabel([t], 1600, 1000, 800, 500)).toBe(true)
  expect(t.text).toBe('Took it.\nScreenshot size: 800x500 0.5-scale view; coordinate frame: 1600x1000\nDone.')
})

test('relabel keeps an existing coordinate frame and computes scale against it', () => {
  // The tool already sent a 0.8 view of a 2000x1250 frame; the mod halves the picture again.
  const t = { type: 'text', text: 'Screenshot size: 1600x1000 0.8-scale view; coordinate frame: 2000x1250.' }
  expect(relabel([t], 1600, 1000, 800, 500)).toBe(true)
  expect(t.text).toBe('Screenshot size: 800x500 0.4-scale view; coordinate frame: 2000x1250.')
})

test('relabel leaves lines for other sizes alone and reports no match', () => {
  const t = { type: 'text', text: 'Screenshot size: 1280x720' }
  expect(relabel([t], 1600, 1000, 800, 500)).toBe(false)
  expect(t.text).toBe('Screenshot size: 1280x720')
})

test('relabel rewrites only the first matching line', () => {
  const a = { type: 'text', text: 'Screenshot size: 1600x1000' }
  const b = { type: 'text', text: 'Screenshot size: 1600x1000' }
  expect(relabel([a, b], 1600, 1000, 800, 500)).toBe(true)
  expect(b.text).toBe('Screenshot size: 1600x1000')
})

test('relabel picks the matching line when one text names two sizes', () => {
  const t = { type: 'text', text: 'Screenshot size: 640x480\nScreenshot size: 1600x1000' }
  expect(relabel([t], 1600, 1000, 800, 500)).toBe(true)
  expect(t.text).toBe('Screenshot size: 640x480\nScreenshot size: 800x500 0.5-scale view; coordinate frame: 1600x1000')
})

// ---- finding pictures in each result shape ----

test('findImages finds MCP, API and Read blocks, with the text just before as label', () => {
  const result = {
    content: [
      { type: 'text', text: 'Screenshot size: 1600x1000' },
      { type: 'image', data: 'iVBOR', mimeType: 'image/png' },
      { type: 'image', source: { type: 'base64', data: '/9j/', media_type: 'image/jpeg' } },
    ],
    nested: { type: 'image', file: { base64: 'R0lGOD', type: 'image/gif' } },
  }
  const hits = findImages(result)
  expect(hits.length).toBe(3)
  expect(hits[0]!.label?.text).toBe('Screenshot size: 1600x1000')
  expect(hits[1]!.label).toBe(undefined)
  expect(hits.map(h => bytesOf(h.block).mime)).toEqual(['image/png', 'image/jpeg', 'image/gif'])
  expect(findTexts(result).length).toBe(1)
})

test('findImages ignores image blocks without bytes', () => {
  expect(findImages([{ type: 'image', url: 'https://x' }]).length).toBe(0)
})

test('setBytes writes back into each shape', () => {
  const mcp: Obj = { type: 'image', data: 'old', mimeType: 'image/webp' }
  setBytes(mcp, 'new', 'image/png', 1600, 1000, 800, 500)
  expect(mcp).toEqual({ type: 'image', data: 'new', mimeType: 'image/png' })

  const api: Obj = { type: 'image', source: { type: 'base64', data: 'old', media_type: 'image/jpeg' } }
  setBytes(api, 'new', 'image/jpeg', 1600, 1000, 800, 500)
  expect(api.source).toEqual({ type: 'base64', data: 'new', media_type: 'image/jpeg' })
})

test('setBytes on a Read result keeps the original size, so a mapped click lands right', () => {
  const read: Obj = { type: 'image', file: { base64: 'old', type: 'image/png', dimensions: { originalWidth: 3200, originalHeight: 2000, displayWidth: 1600, displayHeight: 1000 } } }
  setBytes(read, 'new', 'image/png', 1600, 1000, 800, 500)
  expect(read.file).toEqual({ base64: 'new', type: 'image/png', dimensions: { originalWidth: 3200, originalHeight: 2000, displayWidth: 800, displayHeight: 500 } })

  const bare: Obj = { type: 'image', file: { base64: 'old', type: 'image/png' } }
  setBytes(bare, 'new', 'image/png', 1600, 1000, 800, 500)
  expect((bare.file as Obj).dimensions).toEqual({ originalWidth: 1600, originalHeight: 1000, displayWidth: 800, displayHeight: 500 })
})

// ---- pictures Claude sized itself stay as asked ----

test('ownSizes: a plain screenshot is shrunk, a zoom or own scale is not', () => {
  expect(ownSizes({ action: 'screenshot' }, [''], '', 512, quiet)).toEqual([null])
  expect(ownSizes({ action: 'zoom' }, [''], '', 512, quiet)).toEqual(['a zoom, Claude picked its size'])
  expect(ownSizes({ action: 'screenshot', scale: 0.7 }, [''], '', 512, quiet)).toEqual(['Claude set scale 0.7'])
})

test('ownSizes: a picture Claude sized that is under the floor says already small', () => {
  expect(ownSizes({ scale: 0.3 }, ['Screenshot size: 480x300'], '', 512, quiet)).toEqual(['already small (Claude set scale 0.3)'])
})

test('ownSizes: a batch matches pictures to screenshot and zoom actions in order', () => {
  const input = {
    actions: [
      { input: { action: 'click' } },
      { input: { action: 'screenshot' } },
      { input: { action: 'zoom' } },
    ],
  }
  expect(ownSizes(input, ['', ''], '', 512, quiet)).toEqual([null, 'a zoom, Claude picked its size'])
})

test('ownSizes: a batch with uneven counts falls back to labels and warns', () => {
  const warned: string[] = []
  const input = { actions: [{ input: { action: 'screenshot' } }] }
  const labels = ['[computer:screenshot] Screenshot size: 1600x1000', '[computer:zoom]', 'Screenshot size: 600x400 0.6-scale view; coordinate frame: 1000x667']
  expect(ownSizes(input, labels, '', 512, s => warned.push(s))).toEqual([null, 'a zoom, Claude picked its size', 'Claude set its own scale'])
  expect(warned.length).toBe(1)
})

test('hint: the zoom hint goes under the first shrunk picture of each context only', () => {
  const seen = new Set<string>()
  const first = ['shrank 1']
  hint(first, seen, 'main')
  expect(first).toEqual(['shrank 1', HINT])
  const again = ['shrank 2']
  hint(again, seen, 'main')
  expect(again).toEqual(['shrank 2'])
  const sub = ['shrank 3']
  hint(sub, seen, 'agent-1')
  expect(sub).toEqual(['shrank 3', HINT])
  const none: string[] = []
  hint(none, new Set(), 'main')
  expect(none).toEqual([])
})
