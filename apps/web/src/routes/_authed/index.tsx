import { createFileRoute } from '@tanstack/react-router'
import Dashboard from '@/components/dashboard/Dashboard'
import DevVpsLogsWidget from '@/components/dev/DevVpsLogsWidget'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  return (
    <>
      <Dashboard />
      {import.meta.env.DEV ? <DevVpsLogsWidget /> : null}
    </>
  )
}
