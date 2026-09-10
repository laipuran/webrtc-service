import type { MemberSummary } from '../protocol'

/**
 * Deterministic perfect-negotiation role for a pair of peers.
 *
 * Both sides compute this from the same two ids, so exactly one side is
 * polite (backs off on an offer collision) and the other is impolite.
 */
export function isPolite(selfId: string, peerId: string): boolean {
  return selfId < peerId
}

/** Roster members we have no connection to yet, excluding ourselves. */
export function selectNewMembers(
  knownIds: readonly string[],
  roster: readonly MemberSummary[],
  selfId: string,
): MemberSummary[] {
  const known = new Set(knownIds)
  return roster.filter(
    (member) => member.member_id !== selfId && !known.has(member.member_id),
  )
}

/** Known peers who are no longer present in the roster. */
export function selectDepartedMembers(
  knownIds: readonly string[],
  roster: readonly MemberSummary[],
): string[] {
  const present = new Set(roster.map((member) => member.member_id))
  return knownIds.filter((id) => !present.has(id))
}
