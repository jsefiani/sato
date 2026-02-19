import { useEffect, useState } from 'react'
import { captureSilk } from '@/lib/capture-silk'

const sizeClasses = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const

export default function SatoAvatar({
  size = 'md',
  visible = true,
  status,
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg'
  visible?: boolean
  status?: 'online'
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    captureSilk()
      .then((url) => {
        if (!cancelled && url) setSrc(url)
      })
      .catch(() => {
        // Keep the avatar fallback background if texture generation fails.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${sizeClasses[size]} ${!visible ? 'invisible' : ''} ${className}`.trim()}
    >
      <div className="absolute inset-0 bg-brand-light" />
      <div className="absolute inset-0 bg-gradient-to-br from-brand/20 via-transparent to-brand/10" />
      {src && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
      )}
      {src && (
        <div
          className="absolute inset-0 bg-brand-light"
          style={{ opacity: 0.22 }}
        />
      )}

      {/* Online status dot */}
      {status === 'online' && (
        <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-[1.5px] border-background bg-[#22c55e]" />
      )}
    </div>
  )
}
