import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import ChatPanel from '@/components/chat/ChatPanel'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_authed/chat')({
  component: ChatPage,
})

function ChatPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-6 text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <div className="mb-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigate({ to: '/' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-light tracking-tight text-foreground">
            Chat with assistant
          </h1>
        </div>

        <ChatPanel />
      </div>
    </div>
  )
}
