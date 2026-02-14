import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import { runVpsSshCommand } from '@/lib/vps-ssh'

export const Route = createFileRoute('/api/vps/logs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'vps-status',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              tailscaleIp: vpsInstance.tailscaleIp,
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

          if (!instance.tailscaleIp) {
            return Response.json(
              { error: 'VPS SSH is not ready yet' },
              { status: 409 },
            )
          }

          const sshHost = instance.tailscaleIp
          const [bootstrapLog, cloudInitStatus, cloudInitOutput] =
            await Promise.allSettled([
              runVpsSshCommand(
                sshHost,
                'cat /var/log/sato-openclaw-bootstrap.log 2>/dev/null || echo "Log file not found"',
                { timeoutMs: 20_000 },
              ),
              runVpsSshCommand(
                sshHost,
                'cloud-init status --long 2>/dev/null || echo "cloud-init not available"',
                { timeoutMs: 20_000 },
              ),
              runVpsSshCommand(
                sshHost,
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
          return safeApiResponse(error)
        }
      },
    },
  },
})
