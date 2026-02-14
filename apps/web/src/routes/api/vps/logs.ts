import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { requireSession } from '@/lib/session'
import { runVpsSshCommand } from '@/lib/vps-ssh'

export const Route = createFileRoute('/api/vps/logs')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const session = await requireSession()

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              status: vpsInstance.status,
            })
            .from(vpsInstance)
            .where(eq(vpsInstance.userId, session.user.id))
            .limit(1)
          const instance = rows.at(0)

          if (!instance) {
            return Response.json(
              { error: 'No VPS instance found' },
              { status: 404 },
            )
          }

          if (!instance.ipv4Address) {
            return Response.json(
              { error: 'VPS has no IP address yet' },
              { status: 409 },
            )
          }

          const [bootstrapLog, cloudInitStatus, cloudInitOutput] =
            await Promise.allSettled([
              runVpsSshCommand(
                instance.ipv4Address,
                'cat /var/log/sato-openclaw-bootstrap.log 2>/dev/null || echo "Log file not found"',
                { timeoutMs: 20_000 },
              ),
              runVpsSshCommand(
                instance.ipv4Address,
                'cloud-init status --long 2>/dev/null || echo "cloud-init not available"',
                { timeoutMs: 20_000 },
              ),
              runVpsSshCommand(
                instance.ipv4Address,
                'tail -c 24000 /var/log/cloud-init-output.log 2>/dev/null || echo "cloud-init-output.log not found"',
                { timeoutMs: 20_000 },
              ),
            ])

          return Response.json({
            bootstrapLog:
              bootstrapLog.status === 'fulfilled'
                ? bootstrapLog.value
                : (bootstrapLog.reason?.message ?? 'Failed to fetch'),
            cloudInitStatus:
              cloudInitStatus.status === 'fulfilled'
                ? cloudInitStatus.value
                : (cloudInitStatus.reason?.message ?? 'Failed to fetch'),
            cloudInitOutput:
              cloudInitOutput.status === 'fulfilled'
                ? cloudInitOutput.value
                : (cloudInitOutput.reason?.message ?? 'Failed to fetch'),
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          if (message === 'Unauthorized') {
            return Response.json({ error: message }, { status: 401 })
          }
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
