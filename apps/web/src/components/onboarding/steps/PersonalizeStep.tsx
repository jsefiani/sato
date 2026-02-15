import { useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, Sparkles } from 'lucide-react'
import { containerVariants, itemVariants } from '../onboarding-animations'
import { useOnboardingContext } from '../onboarding-context'
import type { PersonalizationData } from '../onboarding-utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const COMMUNICATION_STYLES = [
  { value: 'casual', label: 'Casual', description: 'Friendly and relaxed' },
  {
    value: 'professional',
    label: 'Professional',
    description: 'Polished and formal',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Warm but to the point',
  },
]

const USE_CASES = [
  { value: 'personal', label: 'Personal tasks' },
  { value: 'work', label: 'Work productivity' },
  { value: 'learning', label: 'Learning' },
  { value: 'creative', label: 'Creative projects' },
]

export default function PersonalizeStep() {
  const { handlePersonalizeContinue, personalizeSaving, skipInitialAnimation } =
    useOnboardingContext()

  const [assistantName, setAssistantName] = useState('Sato')
  const [communicationStyle, setCommunicationStyle] = useState('balanced')
  const [primaryUseCase, setPrimaryUseCase] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')

  const canSubmit = assistantName.trim() && communicationStyle && primaryUseCase

  const handleSubmit = () => {
    if (!canSubmit) return
    const data: PersonalizationData = {
      assistantName: assistantName.trim(),
      communicationStyle,
      primaryUseCase,
      additionalContext: additionalContext.trim(),
    }
    handlePersonalizeContinue(data)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial={skipInitialAnimation ? false : 'hidden'}
      animate="show"
      className="flex flex-col items-center text-center"
    >
      <motion.div
        variants={itemVariants}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/4"
      >
        <Sparkles className="h-7 w-7 text-foreground/80" />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-6 text-3xl font-light tracking-tight text-foreground"
      >
        Make it yours
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground"
      >
        A few quick questions so your assistant feels right from the start.
      </motion.p>

      <motion.div
        variants={itemVariants}
        className="mt-8 w-full max-w-sm space-y-5 text-left"
      >
        <div className="space-y-2">
          <label
            htmlFor="assistant-name"
            className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
          >
            Assistant name
          </label>
          <Input
            id="assistant-name"
            value={assistantName}
            onChange={(e) => setAssistantName(e.target.value)}
            placeholder="Sato"
            maxLength={50}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Communication style
          </label>
          <div className="grid grid-cols-3 gap-2">
            {COMMUNICATION_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => setCommunicationStyle(style.value)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  communicationStyle === style.value
                    ? 'border-foreground/30 bg-foreground/4'
                    : 'border-border hover:border-foreground/15'
                }`}
              >
                <p className="text-sm font-medium text-foreground/80">
                  {style.label}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {style.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Primary use case
          </label>
          <div className="grid grid-cols-2 gap-2">
            {USE_CASES.map((uc) => (
              <Card
                key={uc.value}
                className={`cursor-pointer p-3 transition-colors ${
                  primaryUseCase === uc.value
                    ? 'border-foreground/30 bg-foreground/4'
                    : 'hover:border-foreground/15'
                }`}
                onClick={() => setPrimaryUseCase(uc.value)}
              >
                <CardContent className="p-0">
                  <p className="text-sm font-medium text-foreground/80">
                    {uc.label}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="additional-context"
            className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
          >
            Anything else?{' '}
            <span className="text-muted-foreground/60">(optional)</span>
          </label>
          <textarea
            id="additional-context"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="E.g. I prefer concise answers, I work in marketing..."
            maxLength={500}
            rows={3}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 resize-none rounded-md border bg-transparent px-2.5 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-3"
          />
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="mt-8 w-full max-w-sm">
        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={!canSubmit || personalizeSaving}
        >
          {personalizeSaving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </span>
          ) : (
            'Continue'
          )}
        </Button>
      </motion.div>
    </motion.div>
  )
}
