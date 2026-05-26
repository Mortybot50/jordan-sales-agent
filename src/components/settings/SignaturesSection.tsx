/**
 * SignaturesSection — manage per-brand email signatures.
 *
 * Jordan sells across Purezza (premium hospitality) and Culligan / Zip (offices,
 * factories, healthcare). Each brand gets its own signature template; the
 * generate-draft and sequence-tick workers pick the right one based on the
 * deal's product brand (deals.product_id → products.brand). When there's no
 * deal, the worker falls back to Purezza.
 *
 * The `{{sending_mailbox_email}}` token is substituted at draft-time with the
 * actual sending inbox email — From / Reply-To / signature email line all
 * match (Jordan's Option B, 25/05/2026).
 */

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSignatures, useUpsertSignature } from '@/lib/queries/signatures'
import { useEmailAccounts } from '@/lib/queries/email-accounts'
import { BRAND_LABELS, type BrandKey } from '@/lib/schemas/signatures'

interface BrandEditorProps {
  brandKey: BrandKey
  initialText: string
  initialHtml: string
  previewMailbox: string | null
  onSave: (body_text: string, body_html: string) => Promise<void>
  saving: boolean
}

function BrandEditor({
  brandKey,
  initialText,
  initialHtml,
  previewMailbox,
  onSave,
  saving,
}: BrandEditorProps) {
  const [text, setText] = useState(initialText)
  const [html, setHtml] = useState(initialHtml)

  // Re-seed local state when the underlying row loads / changes underneath us.
  useEffect(() => {
    setText(initialText)
  }, [initialText])
  useEffect(() => {
    setHtml(initialHtml)
  }, [initialHtml])

  const previewText = (previewMailbox && text)
    ? text.replace(/\{\{sending_mailbox_email\}\}/g, previewMailbox)
    : text

  return (
    <div className="space-y-3 border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{BRAND_LABELS[brandKey]} signature</Label>
        <span className="text-xs text-muted-foreground">brand_key: {brandKey}</span>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`sig-text-${brandKey}`} className="text-xs text-muted-foreground">
          Plain text — used in every outbound email body
        </Label>
        <Textarea
          id={`sig-text-${brandKey}`}
          rows={10}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`sig-html-${brandKey}`} className="text-xs text-muted-foreground">
          HTML — reserved for future HTML-mode sends (optional)
        </Label>
        <Textarea
          id={`sig-html-${brandKey}`}
          rows={4}
          className="font-mono text-xs"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Preview {previewMailbox ? `(with ${previewMailbox})` : '(no active inbox yet)'}
        </Label>
        <pre className="text-xs whitespace-pre-wrap rounded border bg-muted/40 p-2 max-h-40 overflow-y-auto">
          {previewText || '(empty)'}
        </pre>
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => onSave(text, html)}
        disabled={saving || text.trim().length === 0}
      >
        {saving ? 'Saving…' : `Save ${BRAND_LABELS[brandKey]} signature`}
      </Button>
    </div>
  )
}

export function SignaturesSection() {
  const { user } = useAuth()
  const { data: signatures = [], isLoading } = useSignatures(user?.id)
  const { data: accounts = [] } = useEmailAccounts()
  const upsert = useUpsertSignature()

  const previewMailbox =
    accounts.find((a) => a.status === 'active')?.email_address ??
    accounts[0]?.email_address ??
    null

  const purezza = signatures.find((s) => s.brand_key === 'purezza')
  const culligan = signatures.find((s) => s.brand_key === 'culligan_zip')

  async function handleSave(brandKey: BrandKey, body_text: string, body_html: string) {
    if (!user) return
    await upsert.mutateAsync({
      user_id: user.id,
      org_id: user.org_id,
      brand_key: brandKey,
      body_text,
      body_html,
    })
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-xs text-muted-foreground">
        One signature per brand. The right one is picked automatically based on
        the deal's product (Purezza products → Purezza signature; Culligan / Zip
        products → Culligan Group signature). Use{' '}
        <code className="px-1 py-0.5 rounded bg-muted text-[11px]">{`{{sending_mailbox_email}}`}</code>{' '}
        for the inbox email — it's replaced at draft time.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading signatures…</p>
      ) : (
        <>
          <BrandEditor
            brandKey="purezza"
            initialText={purezza?.body_text ?? ''}
            initialHtml={purezza?.body_html ?? ''}
            previewMailbox={previewMailbox}
            onSave={(t, h) => handleSave('purezza', t, h)}
            saving={upsert.isPending}
          />
          <BrandEditor
            brandKey="culligan_zip"
            initialText={culligan?.body_text ?? ''}
            initialHtml={culligan?.body_html ?? ''}
            previewMailbox={previewMailbox}
            onSave={(t, h) => handleSave('culligan_zip', t, h)}
            saving={upsert.isPending}
          />
        </>
      )}
    </div>
  )
}
