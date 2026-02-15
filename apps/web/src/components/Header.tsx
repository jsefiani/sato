import { Link } from '@tanstack/react-router'

import UserMenu from '../integrations/better-auth/header-user.tsx'

export default function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <Link
        to="/"
        className="text-lg font-semibold text-foreground tracking-tight flex items-center gap-1"
      >
        <span className="rounded-full size-4 bg-[#000000c7]"></span> Sato
      </Link>
      <UserMenu />
    </header>
  )
}
