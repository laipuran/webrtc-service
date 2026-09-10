export type MemberSummary = {
  member_id: string
  username: string
}

export type Signal =
  | { type: 'Offer'; sdp: string }
  | { type: 'Answer'; sdp: string }
  | { type: 'IceCandidate'; candidate: string }

export type ClientMessage =
  | { type: 'Join'; room_id: string; auth: string; username: string }
  | { type: 'Leave' }
  | { type: 'Signal'; to: string; signal: Signal }

export type ServerMessage =
  | { type: 'Joined'; member_id: string; room_id: string }
  | { type: 'Roster'; members: MemberSummary[] }
  | { type: 'MemberLeft'; member_id: string }
  | { type: 'Error'; message: string }
  | { type: 'Signal'; from: string; signal: Signal }

// Keyed by the union's own discriminants, so a new ServerMessage variant is a
// compile error here until it is listed.
const SERVER_MESSAGE_TYPES: Record<ServerMessage['type'], true> = {
  Joined: true,
  Roster: true,
  MemberLeft: true,
  Error: true,
  Signal: true,
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message)
}

export function parseServerMessage(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw)

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid server message: ${raw}`)
  }

  const type = (parsed as { type?: unknown }).type
  if (typeof type !== 'string' || !(type in SERVER_MESSAGE_TYPES)) {
    throw new Error(`Invalid server message: ${raw}`)
  }

  return parsed as ServerMessage
}
