import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangle, FileQuestion, Home, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
            <Icon className="h-7 w-7 text-muted-foreground" />
          </div>

          <p className="mb-1 text-sm font-medium text-muted-foreground/80">
            {status}
          </p>
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            {title}
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>

          <div className="flex items-center justify-center gap-3">
            {showRetry && (
              <Button variant="outline" onClick={() => router.invalidate()}>
                <RefreshCw />
                Try again
              </Button>
            )}
            <Button render={<Link to="/" />}>
              <Home />
              Go home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
