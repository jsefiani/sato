import net from 'node:net'

export async function isTcpPortReachable(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (result: boolean) => {
      if (settled) {
        return
      }

      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))

    socket.connect(port, host)
  })
}
