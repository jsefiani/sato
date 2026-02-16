import { useRef } from 'react'
import { motion } from 'motion/react'
import { MessageCircle, Shield, Zap } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const features = [
  {
    icon: Shield,
    title: 'Completely private',
    description: 'Your own AI on a dedicated server — no one else has access.',
  },
  {
    icon: Zap,
    title: 'Always on',
    description: 'Available 24/7, whenever you need it.',
  },
  {
    icon: MessageCircle,
    title: 'Chat directly',
    description: 'Start chatting with your assistant right away.',
  },
]

function WelcomeSkeleton() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="size-20 animate-pulse rounded-full bg-foreground/6" />
      <div className="mt-7 h-10 w-56 animate-pulse rounded-lg bg-foreground/6" />
      <div className="mt-3 h-12 w-72 animate-pulse rounded-lg bg-foreground/6" />

      <div className="mt-10 grid w-full max-w-sm gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-4 rounded-xl border border-border p-4"
          >
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-foreground/6" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-28 animate-pulse rounded bg-foreground/6" />
              <div className="h-4 w-full animate-pulse rounded bg-foreground/6" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 h-10 w-full max-w-sm animate-pulse rounded-lg bg-foreground/6" />
    </div>
  )
}

export default function WelcomeStep() {
  const {
    sessionPending,
    userName,
    userImage,
    handleWelcomeContinue,
    skipInitialAnimation,
  } = useOnboardingContext()
  const showedSkeleton = useRef(sessionPending)
  const firstName = userName.split(' ')[0]

  if (sessionPending) return <WelcomeSkeleton />

  const skipAnimation = skipInitialAnimation || showedSkeleton.current

  return (
    <motion.div
      variants={containerVariants}
      initial={skipAnimation ? false : 'hidden'}
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div variants={itemVariants}>
        <Avatar className="size-20">
          <AvatarImage src={userImage ?? undefined} alt="" />
          <AvatarFallback className="text-3xl font-light">
            {firstName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-7 text-4xl font-light tracking-tight text-foreground"
      >
        Welcome, {firstName}
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground"
      >
        Sato gives you a personal AI assistant on its own private and secure
        server. Let's get yours set up.
      </motion.p>

      <motion.div
        variants={itemVariants}
        className="mt-10 grid w-full max-w-sm gap-3"
      >
        {features.map((feature) => (
          <motion.div key={feature.title} variants={itemVariants}>
            <Card className="flex-row items-start gap-4 bg-transparent p-4 text-left">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/4">
                <feature.icon className="h-[18px] w-[18px] text-foreground/80" />
              </div>
              <CardContent className="flex flex-col gap-1 p-0">
                <p className="text-sm font-medium text-foreground/80">
                  {feature.title}
                </p>
                <p className="text-sm text-muted-foreground/80">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={itemVariants} className="mt-10 w-full max-w-sm">
        <Button className="w-full" onClick={handleWelcomeContinue}>
          Create my assistant
        </Button>
      </motion.div>
    </motion.div>
  )
}
