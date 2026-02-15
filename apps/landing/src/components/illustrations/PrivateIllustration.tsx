import { motion } from 'motion/react'
import { Shield } from 'lucide-react'

export default function PrivateIllustration() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="relative">
        <motion.div
          className="absolute inset-0 rounded-full border border-brand/20"
          initial={{ scale: 1, opacity: 0.4 }}
          animate={{ scale: [1, 1.8, 1.8], opacity: [0.4, 0, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border border-brand/15"
          initial={{ scale: 1, opacity: 0.3 }}
          animate={{ scale: [1, 2.4, 2.4], opacity: [0.3, 0, 0] }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: 'easeOut',
            delay: 0.4,
          }}
        />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
          <Shield className="h-7 w-7 text-brand" />
        </div>
      </div>
      <motion.span
        className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        End-to-end encrypted
      </motion.span>
    </div>
  )
}
