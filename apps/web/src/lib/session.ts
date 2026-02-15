import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '@/lib/auth'

export async function requireSession() {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })

  if (!session) {
    throw new Error('Unauthorized')
  }

  return session
}

export async function requireAdminSession() {
  const session = await requireSession()

  if (session.user.role !== 'admin') {
    throw new Error('Forbidden')
  }

  return session
}
