import type { NitroErrorHandler } from 'nitro/types'

function renderPage({
  status,
  title,
  description,
}: {
  status: number
  title: string
  description: string
}) {
  const icon =
    status === 404
      ? // file-question icon
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17h.01"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/></svg>'
      : // alert-triangle icon
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'

  // home icon
  const homeIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} - Sato</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: #09090b; /* zinc-950 */
      color: #a1a1aa; /* zinc-400 */
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 28rem;
      background: #18181b; /* zinc-900 */
      border: 1px solid #27272a; /* zinc-800 */
      border-radius: 0.75rem;
      padding: 2rem;
      text-align: center;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,.3);
    }
    .icon-wrap {
      width: 3.5rem;
      height: 3.5rem;
      margin: 0 auto 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: #27272a; /* zinc-800 */
      color: #a1a1aa; /* zinc-400 */
    }
    .status {
      font-size: 0.875rem;
      font-weight: 500;
      color: #71717a; /* zinc-500 */
      margin-bottom: 0.25rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #f4f4f5; /* zinc-100 */
      margin-bottom: 0.5rem;
    }
    .desc {
      font-size: 0.875rem;
      line-height: 1.625;
      margin-bottom: 2rem;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 0.5rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
      font-family: inherit;
      transition: background 0.15s;
    }
    .btn-home {
      background: #fff;
      color: #18181b;
    }
    .btn-home:hover { background: #e4e4e7; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">${icon}</div>
    <p class="status">${status}</p>
    <h1>${title}</h1>
    <p class="desc">${description}</p>
    <div class="actions">
      <a href="/" class="btn btn-home">${homeIcon} Go home</a>
    </div>
  </div>
</body>
</html>`
}

const errorHandler: NitroErrorHandler = async (
  error,
  event,
  { defaultHandler },
) => {
  try {
    const reqUrl = event.req.url
    const isApiRoute =
      reqUrl.startsWith('/api/') ||
      (() => {
        try {
          return new URL(reqUrl).pathname.startsWith('/api/')
        } catch {
          return reqUrl.includes('/api/')
        }
      })()

    if (isApiRoute) {
      const res = await defaultHandler(error, event)
      return new Response(
        typeof res.body === 'string'
          ? res.body
          : JSON.stringify(res.body, null, 2),
        res,
      )
    }

    const status = error.status || 500
    const is404 = status === 404

    return new Response(
      renderPage({
        status,
        title: is404 ? 'Page not found' : 'Something went wrong',
        description: is404
          ? "The page you're looking for doesn't exist or has been moved."
          : 'An unexpected error occurred. Please try again or return to the home page.',
      }),
      {
        status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'cache-control': 'no-cache',
        },
      },
    )
  } catch {
    return new Response(
      '<!DOCTYPE html><html><head><title>Error - Sato</title></head><body style="background:#09090b;color:#a1a1aa;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui"><div style="text-align:center"><h1 style="color:#f4f4f5;margin-bottom:.5rem">Something went wrong</h1><p>An unexpected error occurred.</p><br><a href="/" style="color:#f4f4f5">Go home</a></div></body></html>',
      { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }
}

export default errorHandler
