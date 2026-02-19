import { motion } from 'motion/react'
import { ArrowLeft, Battery, CheckCheck, Signal, Wifi } from 'lucide-react'
import type { CSSProperties } from 'react'
import SatoAvatar from '@/components/SatoAvatar'

const tail = '0.375rem'
const r = '0.95rem'

const receivedTailStyle: CSSProperties = {
  borderLeft: `${tail} solid transparent`,
  borderRadius: `calc(${r} + ${tail}) ${r} ${r} 0`,
  mask: `radial-gradient(100% 100% at 0 0,#0000 98%,#000 102%) 0 100%/${tail} ${tail} no-repeat,linear-gradient(#000 0 0) padding-box`,
  WebkitMask: `radial-gradient(100% 100% at 0 0,#0000 98%,#000 102%) 0 100%/${tail} ${tail} no-repeat,linear-gradient(#000 0 0) padding-box`,
}

const sentTailStyle: CSSProperties = {
  borderRight: `${tail} solid transparent`,
  borderRadius: `${r} calc(${r} + ${tail}) 0 ${r}`,
  mask: `radial-gradient(100% 100% at 100% 0,#0000 98%,#000 102%) 100% 100%/${tail} ${tail} no-repeat,linear-gradient(#000 0 0) padding-box`,
  WebkitMask: `radial-gradient(100% 100% at 100% 0,#0000 98%,#000 102%) 100% 100%/${tail} ${tail} no-repeat,linear-gradient(#000 0 0) padding-box`,
}

export default function TelegramIllustration() {
  return (
    <div className="relative flex h-full w-full items-start justify-center overflow-hidden px-1 pt-3">
      <motion.div
        className="relative w-[15.25rem] max-w-[calc(100%-0.25rem)] shrink-0"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div
          className="rounded-[2.4rem] bg-white/[0.2] p-2.5 shadow-[0_38px_95px_-60px_rgba(15,23,42,0.9)]"
          style={{ transform: 'rotateY(-2deg) rotateX(0.5deg)' }}
        >
          <div className="relative overflow-hidden rounded-[1.9rem] border border-border/40 bg-background">
            <div className="absolute left-1/2 top-2 z-20 h-4 w-20 -translate-x-1/2 rounded-full bg-foreground" />
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[6.6rem]"
              style={{
                background:
                  'radial-gradient(circle at 20% 20%, hsl(199 84% 81% / 0.62) 0%, transparent 60%), radial-gradient(circle at 78% 25%, hsl(251 85% 86% / 0.58) 0%, transparent 62%)',
              }}
            />

            <div className="relative z-10 flex items-center justify-between px-5 pb-1.5 pt-3.5 text-[10px] font-semibold text-foreground">
              <span>11:45</span>
              <div className="flex items-center gap-1">
                <Signal className="h-3 w-3" />
                <Wifi className="h-3 w-3" />
                <Battery className="h-3 w-3" />
              </div>
            </div>

            <div className="relative z-10 flex items-center justify-between px-3 pb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-background/70 backdrop-blur-sm">
                <ArrowLeft className="h-3.5 w-3.5 text-foreground" />
              </div>
              <div className="relative min-w-[7.6rem] rounded-full border border-white/50 bg-white/16 px-5 py-1 text-center shadow-[0_12px_28px_-24px_rgba(15,23,42,0.92)] backdrop-blur-lg backdrop-saturate-150">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(130deg,rgba(255,255,255,0.56),rgba(255,255,255,0.08)_44%,rgba(255,255,255,0.34))]"
                />
                <p className="relative text-[10px] font-semibold leading-none text-foreground/95">
                  Sato
                </p>
                <p className="relative mt-0.5 text-[9px] leading-none text-brand/95">
                  online
                </p>
              </div>
              <SatoAvatar size="lg" className="border border-background/70" />
            </div>

            <div
              className="relative flex h-[14.5rem] flex-col gap-1.5 overflow-hidden px-2.5 py-2"
              style={{
                background:
                  'linear-gradient(130deg, hsl(201 78% 79%) 0%, hsl(253 72% 86%) 100%)',
              }}
            >
              <div
                className="absolute inset-0 opacity-35"
                style={{
                  backgroundImage:
                    'radial-gradient(hsl(220 32% 65% / 0.2) 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              />

              <div
                className="relative z-10 w-[88%] bg-background/95 px-2.5 py-1.5 text-[9px] leading-tight text-foreground shadow-[0_8px_24px_-22px_rgba(15,23,42,0.85)]"
                style={receivedTailStyle}
              >
                Morning. I checked traffic and your calendar. Leave at 8:40 for
                your 9:30 standup.
                <span className="ml-1 text-[8px] text-muted-foreground">
                  11:42
                </span>
              </div>

              <div
                className="relative z-10 ml-auto w-[78%] bg-foreground/90 px-2.5 py-1.5 text-[9px] leading-tight text-background shadow-[0_8px_24px_-22px_rgba(15,23,42,0.75)]"
                style={sentTailStyle}
              >
                Move lunch to 1:30 and remind me to call Amir.
                <span className="ml-1 text-[8px] text-background/55">
                  11:43
                </span>
              </div>

              <div
                className="relative z-10 w-[92%] bg-background/95 px-2.5 py-1.5 text-[9px] leading-tight text-foreground shadow-[0_8px_24px_-22px_rgba(15,23,42,0.85)]"
                style={receivedTailStyle}
              >
                Done. Lunch is at 1:30 PM and I&apos;ll remind you at 12:45.
                <span className="ml-1 text-[8px] text-muted-foreground">
                  11:43
                </span>
              </div>

              <div
                className="relative z-10 ml-auto w-[46%] bg-foreground/90 px-2.5 py-1.5 text-[9px] leading-tight text-background shadow-[0_8px_24px_-22px_rgba(15,23,42,0.75)]"
                style={sentTailStyle}
              >
                Perfect, thanks.
                <span className="ml-1 inline-flex items-center gap-0.5 text-[8px] text-background/55">
                  11:44
                  <CheckCheck className="h-2.5 w-2.5 text-background/70" />
                </span>
              </div>

              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/55 to-transparent" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
