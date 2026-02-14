import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangle, FileQuestion, Home, RefreshCw } from 'lucide-react'

interface ErrorPageProps {
  status: number
  title: string
  description: string
  showRetry?: boolean
}

export default function ErrorPage({
  status,
  title,
  description,
  showRetry = true,
}: ErrorPageProps) {
  const router = useRouter()
  const Icon = status === 404 ? FileQuestion : AlertTriangle

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
          <Icon className="h-7 w-7 text-zinc-400" />
        </div>

        <p className="mb-1 text-sm font-medium text-zinc-500">{status}</p>
        <h1 className="mb-2 text-xl font-semibold text-zinc-100">{title}</h1>
        <p className="mb-8 text-sm leading-relaxed text-zinc-400">
          {description}
        </p>

        <div className="flex items-center justify-center gap-3">
          {showRetry && (
            <button
              type="button"
              onClick={() => router.invalidate()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          )}
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200"
          >
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
