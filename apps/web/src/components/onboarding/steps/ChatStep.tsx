import { motion } from 'motion/react'
import { useOnboardingContext } from '../onboarding-context'
import ChatPanel from '@/components/chat/ChatPanel'
import { Button } from '@/components/ui/button'

export default function ChatStep() {
  const { onNavigate } = useOnboardingContext()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex h-[min(600px,70vh)] flex-col"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-foreground">
            Try it out
          </h1>
          <p className="mt-1 text-sm text-muted-foreground/80">
            Your assistant is ready. Send a message to get started.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate(null)}>
          Go to dashboard
        </Button>
      </div>

      <ChatPanel />
    </motion.div>
  )
}
