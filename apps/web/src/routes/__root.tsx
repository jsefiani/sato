import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import ErrorPage from '@/components/ErrorPage'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Sato - Your personal AI assistant',
      },
    ],
    links: [
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
})

function RootComponent() {
  return <Outlet />
}

function RootErrorComponent() {
  return (
    <RootDocument>
      <ErrorPage
        status={500}
        title="Something went wrong"
        description="An unexpected error occurred. Please try again or return to the home page."
      />
    </RootDocument>
  )
}

function RootNotFound() {
  return (
    <ErrorPage
      status={404}
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
      showRetry={false}
    />
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
