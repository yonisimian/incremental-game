import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** A per-worker game server instance bound to its own ephemeral port. */
export interface GameServer {
  /** Health + tree origin, e.g. `http://127.0.0.1:PORT/`. */
  readonly httpUrl: string
  /** WebSocket endpoint, e.g. `ws://127.0.0.1:PORT/ws`. */
  readonly wsUrl: string
  close(): Promise<void>
}

/** Reserve a free TCP port from the OS, then release it for the server to bind. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => {
        resolvePort(port)
      })
    })
  })
}

async function waitForHealth(httpUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(httpUrl)
      if (res.ok) return
      lastError = new Error(`status ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`server health timed out at ${httpUrl}: ${String(lastError)}`)
}

async function launch(port: number): Promise<GameServer> {
  const httpUrl = `http://127.0.0.1:${port}/`
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  const proc: ChildProcess = spawn('node', ['server/dist/main.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  const exited = new Promise<void>((resolveExit) => {
    proc.once('exit', () => {
      resolveExit()
    })
  })

  try {
    await waitForHealth(httpUrl, 20_000)
  } catch (error) {
    proc.kill('SIGKILL')
    throw new Error(`server failed to become healthy at ${httpUrl}\nstderr:\n${stderr}`, {
      cause: error,
    })
  }

  return {
    httpUrl,
    wsUrl,
    async close() {
      if (proc.exitCode !== null || proc.signalCode !== null) return
      proc.kill('SIGTERM')
      const hardKill = setTimeout(() => proc.kill('SIGKILL'), 5_000)
      await exited
      clearTimeout(hardKill)
    },
  }
}

/**
 * Boot an isolated game server on an OS-assigned port. Retries a few times to
 * absorb the rare port race between reserving a free port and the server
 * binding it (parallel workers reserve ports independently).
 */
export async function startServer(): Promise<GameServer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await launch(await freePort())
    } catch (error) {
      lastError = error
    }
  }
  throw new Error('failed to start game server after retries', { cause: lastError })
}
