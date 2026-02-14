import { Outlet, createFileRoute } from '@tanstack/react-router'
import { authMiddleware } from '@/lib/middleware'
import Header from '@/components/Header'

export const Route = createFileRoute('/_authed')({
  component: AuthedLayout,
  server: {
    middleware: [authMiddleware],
  },
})

function AuthedLayout() {
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
