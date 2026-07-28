import type { Page, WebSocket } from '@playwright/test'

interface ObservedFrame {
  readonly direction: 'sent' | 'received'
  readonly timestamp: number
  readonly value: unknown
}

export class WireObserver {
  private readonly frames: ObservedFrame[] = []

  constructor(page: Page) {
    page.on('websocket', (socket) => {
      this.observe(socket)
    })
  }

  received(type: string): unknown[] {
    return this.ofType('received', type)
  }

  sent(type: string): unknown[] {
    return this.ofType('sent', type)
  }

  private ofType(direction: ObservedFrame['direction'], type: string): unknown[] {
    return this.frames
      .filter((frame) => frame.direction === direction)
      .map((frame) => frame.value)
      .filter(
        (value): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null && 'type' in value,
      )
      .filter((value) => value.type === type)
  }

  private observe(socket: WebSocket): void {
    socket.on('framesent', ({ payload }) => {
      this.record('sent', payload)
    })
    socket.on('framereceived', ({ payload }) => {
      this.record('received', payload)
    })
  }

  private record(direction: ObservedFrame['direction'], payload: string | Buffer): void {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8')
    let value: unknown = text
    try {
      value = JSON.parse(text) as unknown
    } catch {
      // Non-JSON frames are retained as bounded strings for diagnostics.
    }
    this.frames.push({ direction, timestamp: Date.now(), value })
    if (this.frames.length > 500) this.frames.splice(0, this.frames.length - 500)
  }
}
