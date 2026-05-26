import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useRunLeadSearch } from '@/lib/queries/sourcing'

interface RunNowButtonProps {
  searchId: string
  searchName: string
  /** Compact = icon-only button used inside table rows. */
  compact?: boolean
  disabled?: boolean
}

export function RunNowButton({
  searchId,
  searchName,
  compact = false,
  disabled,
}: RunNowButtonProps) {
  const run = useRunLeadSearch()

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const res = await run.mutateAsync(searchId)
      toast.success(
        `"${searchName}" — added ${res.venues_added} venue${
          res.venues_added === 1 ? '' : 's'
        }, ${res.contacts_added} contact${
          res.contacts_added === 1 ? '' : 's'
        }`,
      )
    } catch {
      /* toast via mutation onError */
    }
  }

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={handleClick}
        disabled={disabled || run.isPending}
        aria-label={`Run ${searchName}`}
        title={`Run ${searchName} now`}
      >
        {run.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      className="h-8"
      onClick={handleClick}
      disabled={disabled || run.isPending}
    >
      {run.isPending ? (
        <>
          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          Running…
        </>
      ) : (
        <>
          <Play className="w-4 h-4 mr-1.5" />
          Run now
        </>
      )}
    </Button>
  )
}
