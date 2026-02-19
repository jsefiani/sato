import { motion } from 'motion/react'
import { Shield } from 'lucide-react'
import PixelBlast from '@/react-bits/PixelBlast'

export default function PrivateIllustration() {
  return (
    <div className="relative h-full w-full">
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, hsl(220 70% 45% / 0.14) 0%, transparent 60%), linear-gradient(160deg, hsl(220 70% 45% / 0.08) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 z-1 opacity-80"
        style={{
          WebkitMaskImage:
            'radial-gradient(ellipse at 50% 46%, transparent 0%, transparent 22%, black 42%, black 100%)',
          maskImage:
            'radial-gradient(ellipse at 50% 46%, transparent 0%, transparent 22%, black 42%, black 100%)',
        }}
      >
        <PixelBlast
          color="#1e5dd8"
          pixelSize={3}
          patternDensity={1.55}
          patternScale={1.45}
          speed={0.28}
          edgeFade={0.08}
          centerFade={0}
          enableRipples={false}
        />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-3">
        <div className="relative">
          <motion.div
            className="absolute inset-0 rounded-full border border-brand/20"
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: [1, 1.8, 1.8], opacity: [0.4, 0, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border border-brand/15"
            initial={{ scale: 1, opacity: 0.3 }}
            animate={{ scale: [1, 2.4, 2.4], opacity: [0.3, 0, 0] }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeOut',
              delay: 0.4,
            }}
          />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
            <Shield className="h-7 w-7 text-brand" />
          </div>
        </div>
        <motion.span
          className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
          initial={{ opacity: 0.9, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          Always private
        </motion.span>
      </div>
    </div>
  )
}
