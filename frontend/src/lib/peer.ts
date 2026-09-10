import type { Signal } from '../protocol'

export type PeerHandlers = {
  onSignal: (signal: Signal) => void
  onStream: (stream: MediaStream) => void
  onClosed: () => void
}

/**
 * One RTCPeerConnection speaking the server's `Signal` wire format.
 *
 * Implements the W3C perfect-negotiation pattern so that two peers may
 * start negotiating at the same time without glare.
 */
export class Peer {
  readonly id: string

  private readonly connection: RTCPeerConnection
  private readonly polite: boolean
  private readonly handlers: PeerHandlers
  private makingOffer = false
  private ignoreOffer = false

  constructor(
    id: string,
    polite: boolean,
    config: RTCConfiguration,
    handlers: PeerHandlers,
  ) {
    this.id = id
    this.polite = polite
    this.handlers = handlers
    this.connection = new RTCPeerConnection(config)

    this.connection.addEventListener('negotiationneeded', () => {
      void this.negotiate()
    })

    this.connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.handlers.onSignal({
          type: 'IceCandidate',
          candidate: JSON.stringify(event.candidate.toJSON()),
        })
      }
    })

    this.connection.addEventListener('track', (event) => {
      const stream = event.streams[0]
      if (stream) {
        this.handlers.onStream(stream)
      }
    })

    this.connection.addEventListener('connectionstatechange', () => {
      const state = this.connection.connectionState
      if (state === 'failed' || state === 'closed') {
        this.handlers.onClosed()
      }
    })
  }

  addLocalStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.connection.addTrack(track, stream)
    }
  }

  async handleSignal(signal: Signal): Promise<void> {
    switch (signal.type) {
      case 'Offer':
        await this.handleDescription({ type: 'offer', sdp: signal.sdp })
        return
      case 'Answer':
        await this.handleDescription({ type: 'answer', sdp: signal.sdp })
        return
      case 'IceCandidate':
        await this.handleCandidate(signal.candidate)
        return
    }
  }

  close(): void {
    this.connection.close()
  }

  private async negotiate(): Promise<void> {
    try {
      this.makingOffer = true
      await this.applyLocalDescription()
    } finally {
      this.makingOffer = false
    }
  }

  private async applyLocalDescription(): Promise<void> {
    await this.connection.setLocalDescription()
    this.sendLocalDescription()
  }

  private sendLocalDescription(): void {
    const description = this.connection.localDescription
    if (!description) {
      return
    }
    if (description.type === 'offer') {
      this.handlers.onSignal({ type: 'Offer', sdp: description.sdp })
    } else if (description.type === 'answer') {
      this.handlers.onSignal({ type: 'Answer', sdp: description.sdp })
    }
  }

  private async handleDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    const offerCollision =
      description.type === 'offer' &&
      (this.makingOffer || this.connection.signalingState !== 'stable')

    this.ignoreOffer = !this.polite && offerCollision
    if (this.ignoreOffer) {
      return
    }

    await this.connection.setRemoteDescription(description)
    if (description.type === 'offer') {
      await this.applyLocalDescription()
    }
  }

  private async handleCandidate(candidate: string): Promise<void> {
    try {
      await this.connection.addIceCandidate(
        JSON.parse(candidate) as RTCIceCandidateInit,
      )
    } catch (error) {
      if (!this.ignoreOffer) {
        throw error
      }
    }
  }
}
