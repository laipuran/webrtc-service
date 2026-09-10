import {
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../protocol'

export type SignalingHandlers = {
  onMessage: (message: ServerMessage) => void
  onClose?: () => void
  onError?: (error: unknown) => void
}

export class SignalingClient {
  private readonly url: string
  private readonly handlers: SignalingHandlers
  private socket: WebSocket | null = null

  constructor(url: string, handlers: SignalingHandlers) {
    this.url = url
    this.handlers = handlers
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)

      socket.addEventListener('open', () => {
        this.socket = socket
        resolve()
      })

      socket.addEventListener('message', (event) => {
        try {
          this.handlers.onMessage(parseServerMessage(String(event.data)))
        } catch (error) {
          this.handlers.onError?.(error)
        }
      })

      socket.addEventListener('close', () => {
        if (this.socket === socket) {
          this.socket = null
        }
        this.handlers.onClose?.()
      })

      socket.addEventListener('error', (event) => {
        if (this.socket !== socket) {
          reject(new Error('Signaling socket failed to connect'))
          return
        }
        this.handlers.onError?.(event)
      })
    })
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling socket is not open')
    }
    this.socket.send(encodeClientMessage(message))
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}
