import { expect, test } from 'claude-code/testing'
import { parseShrink, SHRINK, shrinkPlan, sniff, THUMB } from './scripts.ts'

// The scripts themselves run for real in shrink-check/ (tests here cannot start processes).

test('sniff trusts the bytes over the declared type', () => {
  expect(sniff('iVBORw0KGgo', 'image/jpeg')).toBe('image/png')
  expect(sniff('/9j/4AAQ', '')).toBe('image/jpeg')
  expect(sniff('R0lGODlh', '')).toBe('image/gif')
  expect(sniff('UklGRiQA', '')).toBe('image/webp')
  expect(sniff('AAAA', 'image/bmp')).toBe('image/bmp')
  expect(sniff('AAAA', '')).toBe('image/png')
})

test('shrinkPlan keeps PNG and JPEG, turns the rest into PNG', () => {
  expect(shrinkPlan('image/png')).toEqual({ ext: 'png', fmt: '', mime: 'image/png' })
  expect(shrinkPlan('image/jpeg')).toEqual({ ext: 'jpg', fmt: '', mime: 'image/jpeg' })
  expect(shrinkPlan('image/webp')).toEqual({ ext: 'png', fmt: 'png', mime: 'image/png' })
  expect(shrinkPlan('image/gif')).toEqual({ ext: 'png', fmt: 'png', mime: 'image/png' })
})

test('parseShrink reads a shrink, joining wrapped base64', () => {
  expect(parseShrink('IN 1600 1000\nOUT 800 500\niVBOR\nw0KG\n')).toEqual({ w: 1600, h: 1000, nw: 800, nh: 500, base64: 'iVBORw0KG' })
})

test('parseShrink reads a skip', () => {
  expect(parseShrink('IN 400 300\nSKIP\n')).toEqual({ w: 400, h: 300 })
})

test('parseShrink throws on output it did not expect', () => {
  expect(() => parseShrink('')).toThrow('no size')
  expect(() => parseShrink('Traceback (most recent call last):')).toThrow('no size')
  expect(() => parseShrink('IN 1600 1000\nOUT x y\n')).toThrow('no new size')
  expect(() => parseShrink('IN 1600 1000\nOUT 800 500\n')).toThrow('no picture')
})

test('the scripts have no macOS-only flags outside the sips branch', () => {
  for (const script of [SHRINK, THUMB]) {
    const outside = script.replace(/ {2}sips\)[\s\S]*?;;/, '')
    expect(/sips -/.test(outside)).toBe(false)
    expect(outside.includes('base64 -i')).toBe(false)
    expect(outside.includes('base64 -D')).toBe(false)
  }
})
