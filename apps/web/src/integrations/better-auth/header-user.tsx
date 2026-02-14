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
      <div className="h-8 w-8 rounded-full bg-white/[0.06] animate-pulse" />
    )
  }

  if (!session?.user) return null

  const initials = session.user.name.charAt(0).toUpperCase() || 'U'

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-transparent py-1.5 pl-1.5 pr-3 text-sm text-zinc-400 transition-colors hover:border-white/[0.06] hover:text-zinc-200"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08]">
            <span className="text-xs font-medium text-zinc-300">
              {initials}
            </span>
          </div>
        )}
        <span className="max-w-[120px] truncate">{session.user.name}</span>
        <ChevronDown
          size={14}
          className={`text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-48 overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-900/80 p-1 shadow-2xl backdrop-blur-xl">
          <button
            onClick={async () => {
              await authClient.signOut()
              window.location.href = '/sign-in'
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
