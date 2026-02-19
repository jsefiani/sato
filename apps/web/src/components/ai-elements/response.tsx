import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

type ResponseProps = React.ComponentPropsWithoutRef<'div'> & {
  children: string
}

function Response({ children, className, ...props }: ResponseProps) {
  return (
    <div
      data-slot="response"
      className={cn(
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-card/80 [&_pre]:p-2 [&_code]:rounded [&_code]:bg-card/90 [&_code]:px-1 [&_code]:py-0.5 [&_a]:underline [&_a:hover]:opacity-80',
        className,
      )}
      {...props}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export { Response }
