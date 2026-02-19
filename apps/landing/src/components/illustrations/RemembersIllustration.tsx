import { motion } from 'motion/react'
import SatoAvatar from '@/components/SatoAvatar'

export default function RemembersIllustration() {
  return (
    <div className="relative flex h-72 w-full flex-col items-center justify-center px-6">
      {/* Chat exchange */}
      <div className="flex w-full max-w-xs flex-col gap-2.5">
        {/* User message */}
        <motion.div
          className="flex items-end gap-2 self-end"
          initial={{ opacity: 0.9, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="rounded-2xl rounded-br-sm bg-[#d5dff0] px-3.5 py-2 text-xs text-foreground">
            I'm stressed about tomorrow
          </div>
          <img
            src="/illustration-user-photo.jpg"
            alt=""
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        </motion.div>

        {/* Sato response */}
        <motion.div
          className="flex items-end gap-2 self-start"
          initial={{ opacity: 0.9, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <SatoAvatar size="md" />
          <div className="rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-xs text-foreground">
            The pitch to Sequoia? You crushed your last one — you've got this 💪
          </div>
        </motion.div>
      </div>
    </div>
  )
}
