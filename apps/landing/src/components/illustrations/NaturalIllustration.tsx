import { motion } from 'motion/react'

export default function NaturalIllustration() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-4">
      <motion.div
        className="self-end rounded-2xl rounded-br-sm bg-[#d5dff0] px-3.5 py-2 text-xs text-foreground"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        Can you plan a weekend trip?
      </motion.div>

      <motion.div
        className="self-start rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-xs text-foreground"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
      >
        Sure! Where are you thinking?
      </motion.div>

      <motion.div
        className="flex items-center gap-1 self-start rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.3 }}
      >
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
      </motion.div>
    </div>
  )
}
