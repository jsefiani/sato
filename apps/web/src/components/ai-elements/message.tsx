import * as React from 'react'
import { cn } from '@/lib/utils'

type MessageFrom = 'user' | 'assistant' | 'system'

const MessageContext = React.createContext<{ from: MessageFrom }>({
  from: 'assistant',
})

type MessageProps = React.ComponentPropsWithoutRef<'div'> & {
  from?: MessageFrom
}

const Message = React.forwardRef<HTMLDivElement, MessageProps>(function Message(
  { className, from = 'assistant', ...props },
  ref,
) {
  return (
    <MessageContext.Provider value={{ from }}>
      <div
        ref={ref}
        data-slot="message"
        data-from={from}
        className={cn(
          'flex',
          from === 'user' ? 'justify-end' : 'justify-start',
          className,
        )}
        {...props}
      />
    </MessageContext.Provider>
  )
})

const MessageContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function MessageContent({ className, ...props }, ref) {
  const { from } = React.useContext(MessageContext)

  return (
    <div
      ref={ref}
      data-slot="message-content"
      className={cn(
        'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        from === 'user'
          ? 'bg-foreground text-primary-foreground'
          : 'bg-secondary/80 text-foreground/90',
        className,
      )}
      {...props}
    />
  )
})

const MessageAvatar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function MessageAvatar({ className, ...props }, ref) {
  const { from } = React.useContext(MessageContext)
  const label = from === 'user' ? 'You' : 'AI'

  return (
    <div
      ref={ref}
      data-slot="message-avatar"
      aria-hidden
      className={cn(
        'mr-2 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground',
        className,
      )}
      {...props}
    >
      {label}
    </div>
  )
})

export { Message, MessageAvatar, MessageContent }
