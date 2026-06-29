import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  escapeHtml,
  textToHtml,
  substituteMailbox,
  unsubFooterText,
  unsubFooterHtml,
  assembleHtmlBody,
} from '../supabase/functions/_shared/email-html.ts'

test('escapeHtml escapes all five entities', () => {
  assert.equal(escapeHtml(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;')
})

test('textToHtml wraps each blank-line block in a paragraph', () => {
  assert.equal(textToHtml('Hello'), '<p>Hello</p>')
  assert.equal(textToHtml('Para one\n\nPara two'), '<p>Para one</p>\n<p>Para two</p>')
})

test('textToHtml turns single newlines into <br/> within a paragraph', () => {
  assert.equal(textToHtml('Line one\nLine two'), '<p>Line one<br/>Line two</p>')
})

test('textToHtml escapes HTML so user text cannot inject markup', () => {
  assert.equal(textToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
})

test('substituteMailbox replaces every token occurrence', () => {
  assert.equal(
    substituteMailbox('a {{sending_mailbox_email}} b {{sending_mailbox_email}}', 'jm@x.com'),
    'a jm@x.com b jm@x.com',
  )
})

test('substituteMailbox treats null/undefined as empty string', () => {
  assert.equal(substituteMailbox('x {{sending_mailbox_email}} y', null), 'x  y')
  assert.equal(substituteMailbox('x {{sending_mailbox_email}} y', undefined), 'x  y')
})

test('unsubFooterText matches the canonical plain-text footer', () => {
  assert.equal(
    unsubFooterText('https://e/u?t=1'),
    '\n\n---\nThis email was sent by Jordan Marziale (Premium Water AU). To unsubscribe, click here: https://e/u?t=1',
  )
})

test('unsubFooterHtml &-escapes the href query params', () => {
  const html = unsubFooterHtml('https://e/u?c=1&s=2&t=3')
  assert.ok(html.includes('href="https://e/u?c=1&amp;s=2&amp;t=3"'))
  assert.ok(html.includes('click here'))
})

test('assembleHtmlBody joins body + signature + footer with newlines', () => {
  const out = assembleHtmlBody('Hi there', '<p>SIG</p>', '<p>FOOT</p>')
  assert.equal(out, '<p>Hi there</p>\n<p>SIG</p>\n<p>FOOT</p>')
})

test('assembleHtmlBody skips null sections cleanly', () => {
  assert.equal(assembleHtmlBody('Hi', null, null), '<p>Hi</p>')
  assert.equal(assembleHtmlBody('Hi', '<p>SIG</p>', null), '<p>Hi</p>\n<p>SIG</p>')
})
