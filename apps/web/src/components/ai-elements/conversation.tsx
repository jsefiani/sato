import * as React from 'react'
import { cn } from '@/lib/utils'

const Conversation = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function Conversation({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="conversation"
      className={cn(
        'flex flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-border/70 bg-card/30 p-4',
        className,
      )}
      {...props}
    />
  )
})

export { Conversation }
