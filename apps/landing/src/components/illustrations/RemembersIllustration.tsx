import { motion } from 'motion/react'

const memories = [
  { label: '☕ Oat milk latte', x: '8%', y: '8%', delay: 0.1 },
  { label: '🎸 Learning guitar', x: '42%', y: '2%', delay: 0.25 },
  { label: "Mom's bday: Mar 12", x: '22%', y: '28%', delay: 0.4 },
]

export default function RemembersIllustration() {
  return (
    <div className="flex h-full w-full flex-col px-6 pt-4">
      {/* Memory tags */}
      <div className="relative h-20 w-full">
        {memories.map((mem) => (
          <motion.span
            key={mem.label}
            className="absolute rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-foreground shadow-sm"
            style={{ left: mem.x, top: mem.y }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: mem.delay }}
          >
            {mem.label}
          </motion.span>
        ))}
      </div>

      {/* Recall exchange */}
      <div className="flex flex-col gap-2.5">
        <motion.div
          className="self-end rounded-2xl rounded-br-sm bg-[#d5dff0] px-3.5 py-2 text-xs text-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.7 }}
        >
          Order my usual coffee
        </motion.div>

        <motion.div
          className="self-start rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-xs text-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 1.1 }}
        >
          Oat milk latte from Blue Bottle, right? ☕
        </motion.div>
      </div>
    </div>
  )
}
