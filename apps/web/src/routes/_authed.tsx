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
    <>
      <Header />
      <Outlet />
    </>
  )
}
