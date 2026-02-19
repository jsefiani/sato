import { motion } from 'motion/react'
import { Bell, CalendarDays, Pen, Search } from 'lucide-react'
import SatoAvatar from '@/components/SatoAvatar'

const cards = [
  {
    Icon: CalendarDays,
    label: 'Week auto-planned',
    position: 'left-0 top-2 -rotate-2',
    delay: 0.2,
  },
  {
    Icon: Pen,
    label: 'Follow-up drafted',
    position: 'right-0 top-8 rotate-1',
    delay: 0.35,
  },
  {
    Icon: Bell,
    label: 'Reminder scheduled',
    position: 'left-4 bottom-5 -rotate-1',
    delay: 0.5,
  },
  {
    Icon: Search,
    label: 'Options researched',
    position: 'right-2 bottom-2 rotate-2',
    delay: 0.65,
  },
]

export default function SmartIllustration() {
  return (
    <div className="flex h-72 w-full items-center justify-center">
      <div className="relative h-56 w-full max-w-[20rem]">
        {/* Central Sato badge */}
        <motion.div
          className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-brand-light px-3.5 py-1.5"
          initial={{ opacity: 0.92, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <SatoAvatar size="sm" />
          <span className="text-xs font-semibold text-brand">Sato</span>
          <motion.div
            className="absolute inset-0 rounded-full bg-brand-glow"
            animate={{ scale: [1, 1.22, 1], opacity: [0.22, 0, 0.22] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {/* Floating capability cards */}
        {cards.map(({ Icon, label, position, delay }) => (
          <motion.div
            key={label}
            className={`absolute ${position} flex items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-[0_5px_14px_-12px_rgba(15,23,42,0.45)] backdrop-blur-sm`}
            initial={{ opacity: 0.9, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-light">
              <Icon className="h-3 w-3 text-brand" />
            </div>
            <span className="text-xs font-medium text-foreground whitespace-nowrap">
              {label}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
