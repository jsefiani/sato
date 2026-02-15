import { motion } from 'motion/react'
import { Send } from 'lucide-react'

export default function TelegramIllustration() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <motion.div
        className="w-36 overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2AABEE]">
            <Send className="h-2.5 w-2.5 text-white" />
          </div>
          <span className="text-[10px] font-semibold text-foreground">
            Sato
          </span>
        </div>

        {/* Chat body */}
        <div className="flex flex-col gap-1.5 p-2">
          <div className="self-start rounded-lg bg-secondary/70 px-2 py-1">
            <span className="text-[9px] text-foreground">
              Hey! How can I help?
            </span>
          </div>
          <div className="self-end rounded-lg bg-[#d5dff0] px-2 py-1">
            <span className="text-[9px] text-foreground">Set a reminder</span>
          </div>
          <div className="self-start rounded-lg bg-secondary/70 px-2 py-1">
            <span className="text-[9px] text-foreground">Sure, when?</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
