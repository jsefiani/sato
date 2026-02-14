import { Link } from '@tanstack/react-router'

import UserMenu from '../integrations/better-auth/header-user.tsx'

export default function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <Link to="/" className="text-lg font-semibold text-white tracking-tight">
        Sato
      </Link>
      <UserMenu />
    </header>
  )
}
