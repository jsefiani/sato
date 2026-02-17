import { Link } from '@tanstack/react-router'

import UserMenu from '../integrations/better-auth/header-user.tsx'
import Logo from './Logo'

export default function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
      <Link to="/" className="flex items-center">
        <Logo />
      </Link>
      <UserMenu />
    </header>
  )
}
