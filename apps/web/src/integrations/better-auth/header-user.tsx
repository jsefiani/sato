import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/lib/auth-client'

export default function UserMenu() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="h-8 w-8 rounded-full bg-foreground/6 animate-pulse" />
    )
  }

  if (!session?.user) return null

  const initials = session.user.name.charAt(0).toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3 text-sm text-muted-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none">
        <Avatar className="size-7">
          <AvatarImage src={session.user.image ?? undefined} alt="" />
          <AvatarFallback className="text-xs font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-[120px] truncate">{session.user.name}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut()
            window.location.href = '/sign-in'
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
