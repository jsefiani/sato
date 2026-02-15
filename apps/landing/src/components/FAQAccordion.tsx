import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'

const items = [
  {
    question: 'What exactly is Sato?',
    answer:
      'Sato is your own personal AI assistant. Think of it like having a smart, always-available helper who remembers your preferences and gets better at helping you over time.',
  },
  {
    question: 'Is my data really private?',
    answer:
      'Yes. Your assistant runs on its own dedicated server — your conversations are completely isolated. No one else can access them, not even our team.',
  },
  {
    question: 'Do I need to be tech-savvy?',
    answer:
      'Not at all. If you can send a text message, you can use Sato. We handle all the technical stuff behind the scenes.',
  },
  {
    question: 'What can Sato help me with?',
    answer:
      "Pretty much anything you'd ask a personal assistant — managing your schedule, drafting messages, brainstorming ideas, answering questions, planning trips, and much more. The sky's the limit.",
  },
  {
    question: 'What happens after the trial?',
    answer:
      'After your 3-day trial, your plan automatically converts to $29/mo. You can cancel anytime from your dashboard — no surprise charges, ever.',
  },
  {
    question: 'Why is there a $1 trial fee?',
    answer:
      'The $1 trial fee helps us ensure quality service and keep the platform spam-free.',
  },
  {
    question: 'Can I use it on my phone?',
    answer:
      'Yes! Connect Sato to Telegram and chat from anywhere, just like messaging a friend.',
  },
]

export default function FAQAccordion() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="mx-auto max-w-2xl divide-y divide-border">
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between py-5 text-left"
          >
            <span className="text-base font-medium text-foreground">
              {item.question}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                open === i ? 'rotate-180' : ''
              }`}
            />
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}
