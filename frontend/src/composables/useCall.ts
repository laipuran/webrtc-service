import { ref } from 'vue'

import { Peer } from '../lib/peer'
import { SignalingClient } from '../lib/signaling'
import { isPolite, selectDepartedMembers, selectNewMembers } from '../lib/mesh'
import type { ServerMessage, Signal } from '../protocol'

export type CallStatus = 'idle' | 'connecting' | 'joined' | 'error'

export type PeerTile = {
  memberId: string
  username: string
  stream: MediaStream | null
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const MAX_MEMBERS = 4

export function useCall(signalingUrl: string) {
  const status = ref<CallStatus>('idle')
  const errorMessage = ref<string | null>(null)
  const selfId = ref<string | null>(null)
  const selfUsername = ref('')
  const tiles = ref<PeerTile[]>([])
  const localStream = ref<MediaStream | null>(null)
  const muted = ref(false)

  const peers = new Map<string, Peer>()
  let signaling: SignalingClient | null = null

  function upsertTile(memberId: string, patch: Partial<PeerTile>): void {
    const existing = tiles.value.find((tile) => tile.memberId === memberId)
    if (existing) {
      Object.assign(existing, patch)
      tiles.value = [...tiles.value]
      return
    }
    tiles.value = [
      ...tiles.value,
      { memberId, username: '', stream: null, ...patch },
    ]
  }

  function removeTile(memberId: string): void {
    tiles.value = tiles.value.filter((tile) => tile.memberId !== memberId)
  }

  function sendSignal(to: string, signal: Signal): void {
    try {
      signaling?.send({ type: 'Signal', to, signal })
    } catch (error) {
      console.error('Failed to send signal', error)
    }
  }

  function removePeer(memberId: string): void {
    const peer = peers.get(memberId)
    if (peer) {
      peer.close()
      peers.delete(memberId)
    }
    removeTile(memberId)
  }

  function ensurePeer(self: string, memberId: string, username: string): Peer {
    const existing = peers.get(memberId)
    if (existing) {
      return existing
    }

    const peer = new Peer(
      memberId,
      isPolite(self, memberId),
      { iceServers: ICE_SERVERS },
      {
        onSignal: (signal) => sendSignal(memberId, signal),
        onStream: (stream) => upsertTile(memberId, { stream }),
        onClosed: () => removePeer(memberId),
      },
    )

    if (localStream.value) {
      peer.addLocalStream(localStream.value)
    }

    peers.set(memberId, peer)
    upsertTile(memberId, { username })
    return peer
  }

  async function handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'Joined':
        selfId.value = message.member_id
        status.value = 'joined'
        return

      case 'Roster': {
        const self = selfId.value
        if (!self) {
          return
        }
        if (message.members.length > MAX_MEMBERS) {
          errorMessage.value = `Room is full (max ${MAX_MEMBERS})`
          leave()
          status.value = 'error'
          return
        }
        for (const member of message.members) {
          if (member.member_id !== self) {
            upsertTile(member.member_id, { username: member.username })
          }
        }
        for (const member of selectNewMembers(
          [...peers.keys()],
          message.members,
          self,
        )) {
          ensurePeer(self, member.member_id, member.username)
        }
        for (const id of selectDepartedMembers(
          [...peers.keys()],
          message.members,
        )) {
          removePeer(id)
        }
        return
      }

      case 'MemberLeft':
        removePeer(message.member_id)
        return

      case 'Error':
        errorMessage.value = message.message
        return

      case 'Signal': {
        const self = selfId.value
        if (!self) {
          return
        }
        const peer = ensurePeer(self, message.from, '')
        await peer.handleSignal(message.signal)
        return
      }
    }
  }

  function cleanup(): void {
    for (const peer of peers.values()) {
      peer.close()
    }
    peers.clear()
    selfUsername.value = ''
    tiles.value = []
    signaling?.close()
    signaling = null
    localStream.value?.getTracks().forEach((track) => track.stop())
    localStream.value = null
    muted.value = false
  }

  async function join(
    roomId: string,
    auth: string,
    username: string,
  ): Promise<void> {
    status.value = 'connecting'
    errorMessage.value = null
    selfUsername.value = username

    try {
      localStream.value = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      signaling = new SignalingClient(signalingUrl, {
        onMessage: (message) => {
          void handleMessage(message)
        },
        onClose: () => {
          if (status.value === 'joined') {
            cleanup()
            selfId.value = null
            errorMessage.value = 'Disconnected from server'
            status.value = 'error'
          }
        },
        onError: (error) => {
          console.error('Signaling error', error)
        },
      })

      await signaling.connect()
      signaling.send({ type: 'Join', room_id: roomId, auth, username })
    } catch (error) {
      status.value = 'error'
      errorMessage.value =
        error instanceof Error ? error.message : String(error)
      cleanup()
    }
  }

  function leave(): void {
    try {
      signaling?.send({ type: 'Leave' })
    } catch {
      // The socket may already be closed.
    }
    cleanup()
    selfId.value = null
    status.value = 'idle'
  }

  function toggleMute(): void {
    muted.value = !muted.value
    localStream.value?.getAudioTracks().forEach((track) => {
      track.enabled = !muted.value
    })
  }

  return {
    status,
    errorMessage,
    selfId,
    selfUsername,
    tiles,
    localStream,
    muted,
    join,
    leave,
    toggleMute,
  }
}
