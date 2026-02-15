import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export default function UserMenu() {
  const { data: session, isPending } = authClient.useSession()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (isPending) {
    return (
      <div className="h-8 w-8 rounded-full bg-foreground/6 animate-pulse" />
    )
  }

  if (!session?.user) return null

  const initials = session.user.name.charAt(0).toUpperCase() || 'U'

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-transparent py-1.5 pl-1.5 pr-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground/80"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/8">
            <span className="text-xs font-medium text-foreground/80">
              {initials}
            </span>
          </div>
        )}
        <span className="max-w-[120px] truncate">{session.user.name}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground/50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur-xl">
          <button
            onClick={async () => {
              await authClient.signOut()
              window.location.href = '/sign-in'
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/80"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
