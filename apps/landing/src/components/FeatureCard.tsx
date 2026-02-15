import RemembersIllustration from './illustrations/RemembersIllustration'
import SmartIllustration from './illustrations/SmartIllustration'
import PrivateIllustration from './illustrations/PrivateIllustration'
import NaturalIllustration from './illustrations/NaturalIllustration'
import TelegramIllustration from './illustrations/TelegramIllustration'
import SpotlightCard from '@/react-bits/SpotlightCard'

const illustrations: Partial<Record<string, React.FC>> = {
  remembers: RemembersIllustration,
  smart: SmartIllustration,
  private: PrivateIllustration,
  natural: NaturalIllustration,
  telegram: TelegramIllustration,
}

const wideVariants = new Set(['remembers', 'smart'])

export default function FeatureCard({
  title,
  description,
  variant,
  className = '',
}: {
  title: string
  description: string
  variant: string
  className?: string
}) {
  const Illustration = illustrations[variant]
  const isWide = wideVariants.has(variant)

  return (
    <SpotlightCard
      className={className}
      spotlightColor="rgba(66, 133, 244, 0.08)"
    >
      <div className="relative z-10">
        <div
          className={`overflow-hidden rounded-t-3xl bg-gradient-to-br from-brand-light/50 to-transparent ${isWide ? 'h-72' : 'h-48'}`}
        >
          {Illustration && <Illustration />}
        </div>
        <div className="px-6 pb-6 pt-4">
          <h3 className="mb-2 text-lg font-bold text-foreground">{title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </SpotlightCard>
  )
}
