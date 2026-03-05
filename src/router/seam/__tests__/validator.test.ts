/* src/router/seam/__tests__/validator.test.ts */

import { describe, expect, it } from 'vitest'
import type { RouteNode } from '../src/types.js'
import { validateRouteTree } from '../src/validator.js'

function makeNode(partial: Partial<RouteNode> & Pick<RouteNode, 'segment'>): RouteNode {
  return {
    dirPath: partial.dirPath ?? '/test',
    segment: partial.segment,
    pageFile: partial.pageFile ?? null,
    dataFile: partial.dataFile ?? null,
    layoutFile: partial.layoutFile ?? null,
    layoutDataFile: partial.layoutDataFile ?? null,
    errorFile: partial.errorFile ?? null,
    loadingFile: partial.loadingFile ?? null,
    notFoundFile: partial.notFoundFile ?? null,
    children: partial.children ?? [],
  }
}

describe('validateRouteTree', () => {
  it('returns empty for valid tree', () => {
    const tree = [
      makeNode({
        segment: { type: 'static', value: '' },
        pageFile: '/pages/page.tsx',
        children: [
          makeNode({
            segment: { type: 'static', value: 'about' },
            pageFile: '/pages/about/page.tsx',
          }),
        ],
      }),
    ]
    expect(validateRouteTree(tree)).toEqual([])
  })

  it('detects duplicate paths from groups', () => {
    const tree = [
      makeNode({
        segment: { type: 'static', value: '' },
        children: [
          makeNode({
            segment: { type: 'group', name: 'marketing' },
            dirPath: '/pages/(marketing)',
            children: [
              makeNode({
                segment: { type: 'static', value: 'about' },
                pageFile: '/pages/(marketing)/about/page.tsx',
              }),
            ],
          }),
          makeNode({
            segment: { type: 'group', name: 'info' },
            dirPath: '/pages/(info)',
            children: [
              makeNode({
                segment: { type: 'static', value: 'about' },
                pageFile: '/pages/(info)/about/page.tsx',
              }),
            ],
          }),
        ],
      }),
    ]
    const errors = validateRouteTree(tree)
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('duplicate-path')
  })

  it('detects ambiguous dynamic segments', () => {
    const tree = [
      makeNode({
        segment: { type: 'static', value: '' },
        children: [
          makeNode({
            segment: { type: 'param', name: 'id' },
            dirPath: '/pages/[id]',
            pageFile: '/pages/[id]/page.tsx',
          }),
          makeNode({
            segment: { type: 'param', name: 'slug' },
            dirPath: '/pages/[slug]',
            pageFile: '/pages/[slug]/page.tsx',
          }),
        ],
      }),
    ]
    const errors = validateRouteTree(tree)
    const ambiguous = errors.filter((e) => e.type === 'ambiguous-dynamic')
    expect(ambiguous).toHaveLength(1)
  })

  it('detects catch-all conflict with param', () => {
    const tree = [
      makeNode({
        segment: { type: 'static', value: '' },
        children: [
          makeNode({
            segment: { type: 'catch-all', name: 'all' },
            dirPath: '/pages/[...all]',
            pageFile: '/pages/[...all]/page.tsx',
          }),
          makeNode({
            segment: { type: 'param', name: 'id' },
            dirPath: '/pages/[id]',
            pageFile: '/pages/[id]/page.tsx',
          }),
        ],
      }),
    ]
    const errors = validateRouteTree(tree)
    const conflict = errors.filter((e) => e.type === 'catch-all-conflict')
    expect(conflict).toHaveLength(1)
  })
})
