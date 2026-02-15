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
    title: 'Chat via Telegram',
    description: 'Message your assistant just like texting a friend.',
  },
]

export default function WelcomeStep() {
  const { userName, userImage, handleWelcomeContinue, skipInitialAnimation } =
    useOnboardingContext()
  const firstName = userName.split(' ')[0]

  return (
    <motion.div
      variants={containerVariants}
      initial={skipInitialAnimation ? false : 'hidden'}
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
            <Card className="flex-row items-start gap-4 p-4">
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
