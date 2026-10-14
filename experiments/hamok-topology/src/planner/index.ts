export interface DirectedEdge {
  readonly from: string
  readonly to: string
  readonly cost: number
}

export interface PlanningGraph {
  readonly members: readonly string[]
  readonly edges: readonly DirectedEdge[]
}

export interface SourceTree {
  source: string
  parents: Array<{ member: string; upstream: string }>
}

export type TopologyPlan =
  | { mode: 'optimized'; trees: SourceTree[] }
  | { mode: 'direct'; reason: 'unreachable'; trees: SourceTree[] }

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Unconstrained shortest-path experiment, not a capacity or media-latency model.
 * IDs use code-unit order (not locale order). Dijkstra settles by (cost, ID);
 * equal-cost candidates prefer the smaller upstream ID until settlement, after
 * which parents are frozen. Every parent was settled before its child, so even
 * zero-cost cycles cannot create parent cycles.
 *
 * Invalid inputs and unsafe relaxation sums throw. A sum is checked for every
 * edge to an unsettled target, even if it would not improve the current route.
 * If any source is incomplete, the entire result is a direct intention: these
 * parents request direct delivery and do NOT assert that missing edges exist.
 * Inputs are neither mutated nor augmented with synthetic available edges.
 */
export function planTopology(graph: PlanningGraph): TopologyPlan {
  const members = [...graph.members].sort(compareIds)
  const memberSet = new Set<string>()
  const adjacency = new Map<string, DirectedEdge[]>()

  for (const member of members) {
    if (typeof member !== 'string' || member.length === 0) {
      throw new Error('Member IDs must be nonempty strings')
    }
    if (memberSet.has(member)) {
      throw new Error(`Duplicate member: ${member}`)
    }
    memberSet.add(member)
    adjacency.set(member, [])
  }

  const destinations = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (!memberSet.has(edge.from) || !memberSet.has(edge.to)) {
      throw new Error('Edge endpoints must be known members')
    }
    if (edge.from === edge.to) {
      throw new Error(`Self edge: ${edge.from}`)
    }
    if (!Number.isSafeInteger(edge.cost) || edge.cost < 0) {
      throw new Error('Edge costs must be nonnegative safe integers')
    }
    const seen = destinations.get(edge.from) ?? new Set<string>()
    if (seen.has(edge.to)) {
      throw new Error(`Duplicate edge: ${edge.from} -> ${edge.to}`)
    }
    seen.add(edge.to)
    destinations.set(edge.from, seen)
    adjacency.get(edge.from)?.push(edge)
  }
  for (const edges of adjacency.values()) {
    edges.sort((left, right) => compareIds(left.to, right.to))
  }

  let complete = true
  const trees = members.map((source): SourceTree => {
    const distances = new Map<string, number>([[source, 0]])
    const parents = new Map<string, string>()
    const settled = new Set<string>()

    // Linear minimum selection keeps this small baseline dependency-free.
    while (true) {
      let current: string | undefined
      let minimum = Infinity
      for (const member of members) {
        const distance = distances.get(member) ?? Infinity
        if (!settled.has(member) && distance < minimum) {
          current = member
          minimum = distance
        }
      }
      if (current === undefined) break
      settled.add(current)

      for (const edge of adjacency.get(current) ?? []) {
        if (settled.has(edge.to)) continue
        if (minimum > Number.MAX_SAFE_INTEGER - edge.cost) {
          throw new Error(`Path cost overflow: ${source}: ${current} -> ${edge.to}`)
        }
        const candidate = minimum + edge.cost
        const previous = distances.get(edge.to) ?? Infinity
        const upstream = parents.get(edge.to)
        if (
          candidate < previous ||
          (candidate === previous &&
            (upstream === undefined || compareIds(current, upstream) < 0))
        ) {
          distances.set(edge.to, candidate)
          parents.set(edge.to, current)
        }
      }
    }

    if (settled.size !== members.length) complete = false
    return {
      source,
      parents: [...parents]
        .sort(([left], [right]) => compareIds(left, right))
        .map(([member, upstream]) => ({ member, upstream })),
    }
  })

  if (complete) return { mode: 'optimized', trees }
  return {
    mode: 'direct',
    reason: 'unreachable',
    trees: members.map((source) => ({
      source,
      parents: members
        .filter((member) => member !== source)
        .map((member) => ({ member, upstream: source })),
    })),
  }
}
