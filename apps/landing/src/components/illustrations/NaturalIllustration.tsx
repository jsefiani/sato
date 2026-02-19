import { motion } from 'motion/react'
import SatoAvatar from '@/components/SatoAvatar'

export default function NaturalIllustration() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2.5 px-4">
      {/* User message — casual, vague, like texting a friend */}
      <motion.div
        className="flex items-end gap-2 self-end"
        initial={{ opacity: 0.9, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="rounded-2xl rounded-br-sm bg-[#d5dff0] px-3.5 py-2 text-xs text-foreground">
          that recipe from last week was so good
        </div>
        <img
          src="/illustration-user-photo-1.jpg"
          alt=""
          className="h-6 w-6 shrink-0 rounded-full object-cover"
        />
      </motion.div>

      {/* Sato response — understands the vague reference perfectly */}
      <motion.div
        className="flex items-end gap-2 self-start"
        initial={{ opacity: 0.9, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        <SatoAvatar size="md" />
        <div className="rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-xs text-foreground">
          The Thai basil chicken? Want me to add it to your favorites? 🍜
        </div>
      </motion.div>

      {/* Typing indicator */}
      <motion.div
        className="flex items-end gap-2 self-start"
        initial={{ opacity: 0.9 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0, duration: 0.3 }}
      >
        <SatoAvatar size="md" />
        <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
              animate={{ y: [0, -3, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}
