import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'

const badges = [
  { label: 'Planning', angle: -60 },
  { label: 'Writing', angle: -20 },
  { label: 'Research', angle: 20 },
  { label: 'Analysis', angle: 60 },
  { label: 'Creative', angle: 100 },
]

export default function SmartIllustration() {
  const radius = 80

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative">
        <motion.div
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Sparkles className="h-7 w-7 text-brand" />
          <motion.div
            className="absolute inset-0 rounded-2xl bg-brand-glow"
            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {badges.map((badge, i) => {
          const rad = (badge.angle * Math.PI) / 180
          const x = Math.cos(rad) * radius
          const y = Math.sin(rad) * radius
          return (
            <motion.div
              key={badge.label}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm"
              style={{ x, y }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
            >
              {badge.label}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
