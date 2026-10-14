import { describe, expect, it } from 'vitest'

import type { DirectedEdge, PlanningGraph, TopologyPlan } from './index'
import { planTopology } from './index'

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function shuffle<T>(values: readonly T[], next: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const value = result[i]!
    result[i] = result[j]!
    result[j] = value
  }
  return result
}

// Independent all-pairs oracle: costs here are deliberately small and safe.
function shortestCosts(graph: PlanningGraph): Map<string, Map<string, number>> {
  const distances = new Map(
    graph.members.map((source) => [
      source,
      new Map(graph.members.map((target) => [target, source === target ? 0 : Infinity])),
    ]),
  )
  for (const edge of graph.edges) distances.get(edge.from)!.set(edge.to, edge.cost)
  for (const via of graph.members) {
    for (const source of graph.members) {
      for (const target of graph.members) {
        const row = distances.get(source)!
        row.set(
          target,
          Math.min(row.get(target)!, row.get(via)! + distances.get(via)!.get(target)!),
        )
      }
    }
  }
  return distances
}

function expectCompleteTrees(graph: PlanningGraph, plan: TopologyPlan): void {
  const members = [...graph.members].sort()
  expect(plan.trees.map((tree) => tree.source)).toEqual(members)
  const distances = shortestCosts(graph)
  for (const tree of plan.trees) {
    expect(tree.parents.map((parent) => parent.member)).toEqual(
      members.filter((member) => member !== tree.source),
    )
    const parents = new Map(tree.parents.map(({ member, upstream }) => [member, upstream]))
    for (const target of members.filter((member) => member !== tree.source)) {
      let current = target
      let cost = 0
      const visited = new Set<string>()
      while (current !== tree.source) {
        expect(visited.has(current)).toBe(false)
        visited.add(current)
        const upstream = parents.get(current)!
        expect(members).toContain(upstream)
        expect(upstream).not.toBe(current)
        if (plan.mode === 'optimized') {
          const edge = graph.edges.find((edge) => edge.from === upstream && edge.to === current)
          expect(edge).toBeDefined()
          cost += edge!.cost
        } else {
          expect(upstream).toBe(tree.source)
        }
        current = upstream
      }
      if (plan.mode === 'optimized') {
        expect(cost).toBe(distances.get(tree.source)!.get(target))
      }
    }
  }
}

describe('planTopology', () => {
  it('plans every source on a sparse directional cycle without inventing reverse edges', () => {
    const graph = {
      members: ['c', 'a', 'b'],
      edges: [
        { from: 'a', to: 'b', cost: 2 },
        { from: 'b', to: 'c', cost: 3 },
        { from: 'c', to: 'a', cost: 4 },
      ],
    }
    const plan = planTopology(graph)
    expect(plan).toEqual({
      mode: 'optimized',
      trees: [
        { source: 'a', parents: [{ member: 'b', upstream: 'a' }, { member: 'c', upstream: 'b' }] },
        { source: 'b', parents: [{ member: 'a', upstream: 'c' }, { member: 'c', upstream: 'b' }] },
        { source: 'c', parents: [{ member: 'a', upstream: 'c' }, { member: 'b', upstream: 'a' }] },
      ],
    })
    expectCompleteTrees(graph, plan)
  })

  it('uses stable equal-cost parents and freezes them before zero-cost cycles can form', () => {
    const members = ['z', 'b', 'a', 'c']
    const edges = members.flatMap((from) =>
      members.filter((to) => to !== from).map((to) => ({ from, to, cost: 0 })),
    )
    const graph = { members, edges }
    const plan = planTopology(graph)
    expect(plan.mode).toBe('optimized')
    expect(plan.trees.find((tree) => tree.source === 'z')).toEqual({
      source: 'z',
      parents: [
        { member: 'a', upstream: 'z' },
        { member: 'b', upstream: 'a' },
        { member: 'c', upstream: 'a' },
      ],
    })
    expectCompleteTrees(graph, plan)
    for (let seed = 1; seed <= 50; seed++) {
      const next = random(seed)
      expect(planTopology({ members: shuffle(members, next), edges: shuffle(edges, next) })).toEqual(plan)
    }
  })

  it('prefers the smaller upstream on an equal-cost route before target settlement', () => {
    const graph = {
      members: ['z', 'b', 'a', 'c'],
      edges: [
        { from: 'z', to: 'b', cost: 1 },
        { from: 'z', to: 'a', cost: 2 },
        { from: 'b', to: 'c', cost: 2 },
        { from: 'a', to: 'c', cost: 1 },
        { from: 'c', to: 'z', cost: 1 },
      ],
    }
    const plan = planTopology(graph)
    expect(plan.mode).toBe('optimized')
    expect(plan.trees.find((tree) => tree.source === 'z')?.parents).toContainEqual({
      member: 'c', upstream: 'a',
    })
    expectCompleteTrees(graph, plan)
  })

  it('replaces every source tree with a complete direct intention when any source is unreachable', () => {
    const graph = {
      members: ['c', 'b', 'a'],
      edges: [{ from: 'a', to: 'b', cost: 1 }, { from: 'b', to: 'c', cost: 1 }],
    }
    const plan = planTopology(graph)
    expect(plan.mode).toBe('direct')
    expect(plan).toMatchObject({ reason: 'unreachable' })
    expect(plan.trees[0]?.parents).toContainEqual({ member: 'c', upstream: 'a' })
    expect(graph.edges).not.toContainEqual({ from: 'a', to: 'c', cost: 1 })
    expectCompleteTrees(graph, plan)
    expectCompleteTrees({ members: graph.members, edges: [] }, planTopology({ members: graph.members, edges: [] }))
  })

  it('handles empty and singleton member sets without self parents', () => {
    expect(planTopology({ members: [], edges: [] })).toEqual({ mode: 'optimized', trees: [] })
    expect(planTopology({ members: ['a'], edges: [] })).toEqual({
      mode: 'optimized', trees: [{ source: 'a', parents: [] }],
    })
  })

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid cost %s',
    (cost) => {
      expect(() => planTopology({ members: ['a', 'b'], edges: [{ from: 'a', to: 'b', cost }] }))
        .toThrow('nonnegative safe integers')
    },
  )

  it('rejects duplicate or empty members, unknown endpoints, self edges and duplicate directed edges', () => {
    expect(() => planTopology({ members: ['a', 'a'], edges: [] })).toThrow('Duplicate member')
    expect(() => planTopology({ members: [''], edges: [] })).toThrow('nonempty strings')
    for (const edge of [{ from: 'a', to: 'x', cost: 0 }, { from: 'x', to: 'a', cost: 0 }]) {
      expect(() => planTopology({ members: ['a'], edges: [edge] })).toThrow('known members')
    }
    expect(() => planTopology({ members: ['a'], edges: [{ from: 'a', to: 'a', cost: 0 }] })).toThrow('Self edge')
    for (const secondCost of [0, 1]) {
      expect(() => planTopology({
        members: ['a', 'b'],
        edges: [{ from: 'a', to: 'b', cost: 0 }, { from: 'a', to: 'b', cost: secondCost }],
      })).toThrow('Duplicate edge')
    }
  })

  it.each([0, 1])('accepts a safe boundary sum with final edge cost %s', (finalCost) => {
    const graph = {
      members: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b', cost: Number.MAX_SAFE_INTEGER - finalCost },
        { from: 'b', to: 'c', cost: finalCost },
        { from: 'c', to: 'a', cost: 0 },
      ],
    }
    const plan = planTopology(graph)
    expect(plan.mode).toBe('optimized')
    expectCompleteTrees(graph, plan)
  })

  it('rejects overflow instead of rounding or turning it into an unreachable fallback', () => {
    expect(() => planTopology({
      members: ['a', 'b', 'c', 'isolated'],
      edges: [
        { from: 'a', to: 'b', cost: Number.MAX_SAFE_INTEGER },
        { from: 'b', to: 'c', cost: 1 },
      ],
    })).toThrow('Path cost overflow')
    // The unsafe candidate need not be an improvement to be rejected.
    expect(() => planTopology({
      members: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b', cost: 1 },
        { from: 'a', to: 'c', cost: 2 },
        { from: 'b', to: 'c', cost: Number.MAX_SAFE_INTEGER },
      ],
    })).toThrow('Path cost overflow')
  })

  it('matches independent shortest costs and complete acyclic trees across seeded graph shuffles', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const next = random(seed)
      const members = Array.from({ length: 2 + seed % 6 }, (_, index) => `m${index}`)
      const edges: DirectedEdge[] = []
      for (const from of members) {
        for (const to of members) {
          if (from !== to && next() < 0.55) edges.push({ from, to, cost: Math.floor(next() * 6) })
        }
      }
      const graph = { members, edges }
      const before = JSON.stringify(graph)
      const plan = planTopology(graph)
      const distances = shortestCosts(graph)
      const reachable = [...distances.values()].every((row) => [...row.values()].every(Number.isFinite))
      expect(plan.mode).toBe(reachable ? 'optimized' : 'direct')
      expectCompleteTrees(graph, plan)
      for (let trial = 0; trial < 5; trial++) {
        expect(planTopology({ members: shuffle(members, next), edges: shuffle(edges, next) })).toEqual(plan)
      }
      expect(JSON.stringify(graph)).toBe(before)
    }
  })

  it('does not rely on object property names for member identity or mutate frozen input', () => {
    const members = Object.freeze(['__proto__', 'constructor', 'toString'])
    const edges = Object.freeze(members.flatMap((from) =>
      members.filter((to) => to !== from).map((to) => Object.freeze({ from, to, cost: 1 })),
    ))
    const graph = Object.freeze({ members, edges })
    const plan = planTopology(graph)
    expect(plan.mode).toBe('optimized')
    expectCompleteTrees(graph, plan)
  })
})
