import { randomBytes } from 'node:crypto'
import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from '@tanstack/react-start/server'
import { createServerEntry } from '@tanstack/react-start/server-entry'

const handler = defineHandlerCallback(
  async ({ request, router, responseHeaders }) => {
    const nonce = randomBytes(16).toString('base64')

    router.update({ ssr: { nonce } })

    responseHeaders.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://js.stripe.com`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https://lh3.googleusercontent.com",
        'frame-src https://js.stripe.com https://accounts.google.com',
        "connect-src 'self' https://api.stripe.com https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    )

    return defaultStreamHandler({ request, router, responseHeaders })
  },
)

export default createServerEntry({
  fetch: createStartHandler(handler),
})
