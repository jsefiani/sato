import * as React from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PromptInput = React.forwardRef<
  HTMLFormElement,
  React.ComponentPropsWithoutRef<'form'>
>(function PromptInput({ className, ...props }, ref) {
  return (
    <form
      ref={ref}
      data-slot="prompt-input"
      className={cn(
        'mt-3 rounded-2xl border border-border/70 bg-card/30 p-2',
        className,
      )}
      {...props}
    />
  )
})

const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<'textarea'>
>(function PromptInputTextarea({ className, onKeyDown, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="prompt-input-textarea"
      rows={1}
      className={cn(
        'h-10 min-h-10 w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }
        onKeyDown?.(event)
      }}
      {...props}
    />
  )
})

const PromptInputToolbar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function PromptInputToolbar({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="prompt-input-toolbar"
      className={cn('flex items-center justify-end', className)}
      {...props}
    />
  )
})

const PromptInputSubmit = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<typeof Button>, 'type'>
>(function PromptInputSubmit({ className, children, ...props }, ref) {
  return (
    <Button
      ref={ref}
      data-slot="prompt-input-submit"
      type="submit"
      size="icon-sm"
      className={cn('rounded-xl', className)}
      {...props}
    >
      {children ?? <ArrowUp />}
    </Button>
  )
})

export {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
}
