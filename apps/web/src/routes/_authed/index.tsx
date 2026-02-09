import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  const { data: session } = authClient.useSession()

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-2">
        <h1 className="text-3xl font-bold text-white">Home</h1>
        {session?.user && (
          <p className="text-gray-400">{session.user.email}</p>
        )}
      </div>
    </div>
  )
}
