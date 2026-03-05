/* src/router/seam/__tests__/conventions.test.ts */

import { describe, expect, it } from 'vitest'
import { parseSegment, segmentToUrlPart } from '../src/conventions.js'

describe('parseSegment', () => {
  it('parses static segment', () => {
    expect(parseSegment('about')).toEqual({ type: 'static', value: 'about' })
  })

  it('parses param segment', () => {
    expect(parseSegment('[id]')).toEqual({ type: 'param', name: 'id' })
  })

  it('parses optional-param segment', () => {
    expect(parseSegment('[[id]]')).toEqual({
      type: 'optional-param',
      name: 'id',
    })
  })

  it('parses catch-all segment', () => {
    expect(parseSegment('[...slug]')).toEqual({
      type: 'catch-all',
      name: 'slug',
    })
  })

  it('parses optional-catch-all segment', () => {
    expect(parseSegment('[[...slug]]')).toEqual({
      type: 'optional-catch-all',
      name: 'slug',
    })
  })

  it('parses group segment', () => {
    expect(parseSegment('(marketing)')).toEqual({
      type: 'group',
      name: 'marketing',
    })
  })

  it('throws on unbalanced brackets', () => {
    expect(() => parseSegment('[id')).toThrow('unbalanced brackets')
  })

  it('throws on unbalanced parentheses', () => {
    expect(() => parseSegment('(marketing')).toThrow('unbalanced parentheses')
  })
})

describe('segmentToUrlPart', () => {
  it('group returns empty string', () => {
    expect(segmentToUrlPart({ type: 'group', name: 'auth' })).toBe('')
  })

  it('static returns /value', () => {
    expect(segmentToUrlPart({ type: 'static', value: 'about' })).toBe('/about')
  })

  it('empty static returns empty string', () => {
    expect(segmentToUrlPart({ type: 'static', value: '' })).toBe('')
  })

  it('param returns /:name', () => {
    expect(segmentToUrlPart({ type: 'param', name: 'id' })).toBe('/:id')
  })

  it('optional-param returns /:name?', () => {
    expect(segmentToUrlPart({ type: 'optional-param', name: 'id' })).toBe('/:id?')
  })

  it('catch-all returns /*name', () => {
    expect(segmentToUrlPart({ type: 'catch-all', name: 'slug' })).toBe('/*slug')
  })

  it('optional-catch-all returns /*name?', () => {
    expect(segmentToUrlPart({ type: 'optional-catch-all', name: 'slug' })).toBe('/*slug?')
  })
})
