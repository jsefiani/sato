import { motion } from 'motion/react'
import StarBorder from './StarBorder'

export default function HeroContent() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="flex flex-col items-center text-center"
    >
      <StarBorder color="hsl(220 70% 45%)" speed="8s" className="mb-6">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Meet your new AI assistant
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-3 text-brand"
          >
            <path d="M12 1L14.5 9.5L23 12L14.5 14.5L12 23L9.5 14.5L1 12L9.5 9.5L12 1Z" />
          </svg>
        </span>
      </StarBorder>

      <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
        Get your time <span className="italic text-brand">back.</span>
      </h1>

      <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
        Sato is your personal AI assistant that remembers your preferences,
        helps manage your day, and gets smarter the more you use it — all
        completely private.
      </p>

      <div className="mt-8">
        <a
          href={import.meta.env.PUBLIC_APP_URL || 'https://app.asksato.ai'}
          className="inline-flex rounded-full bg-primary px-8 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try Sato
        </a>
      </div>
    </motion.div>
  )
}
