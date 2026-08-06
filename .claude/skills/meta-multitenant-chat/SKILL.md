---
name: meta-multitenant-chat
description: Implement multi-tenant WhatsApp + Messenger + Instagram chat for a SaaS app on Supabase — one Meta App/System User ("Tech Provider") serves every tenant's own number/page, with a single webhook that resolves which tenant each message belongs to, a unified inbox table, and an AI auto-responder with human handoff. Use this skill whenever the user wants to connect their multi-tenant app to WhatsApp Business API, Messenger, or Instagram DMs; asks about Meta Embedded Signup, Meta Tech Provider status, Meta Business Portfolio verification for messaging; wants a "unified inbox" or "bandeja de chats" across channels; or is porting/replicating a Meta chat integration from one product to another. Trigger even if they only mention one channel (e.g. "just WhatsApp for now") — the same architecture applies. Do NOT use for single-tenant/single-business Meta integrations (one app, one number, no per-tenant resolution needed) or for Meta Ads/marketing API work.
---

# Meta multi-tenant chat (WhatsApp + Messenger + Instagram)

## Why this exists

Meta's default assumption is "one Meta App = one business." A multi-tenant SaaS
(many client businesses, each with their own WhatsApp number / Facebook Page /
Instagram account) can't create a Meta App per client — the fix is to act as a
**Tech Provider**: one Meta App + one permanent System User token operate on
behalf of every tenant's own channel account, and a single webhook resolves
*which tenant* each inbound message belongs to.

This pattern was extracted from a working production implementation (LANA, a
multi-tenant CRM), generalized so it drops into any Supabase-backed app. Read
this file fully before writing code — the reference files hold the copy-paste
templates, but the *why* here is what keeps you from reinventing (or
misconfiguring) the tenant-resolution logic, which is the one part that's easy
to get subtly wrong.

Core idea, in one sentence: **you never store a token per tenant — you store
only the Meta-assigned ID of their connected account (`phone_number_id`,
`page_id`, `instagram_id`), and the webhook uses that ID to look up the
tenant.**

## Before writing any code: understand the target repo

This is a *pattern*, not a drop-in library — adapt names to match the host
project's conventions instead of introducing a parallel naming scheme.

1. Find how the project identifies a tenant today (a `tenant_id` column? a
   `workspace_id`? an `organization_id`?) and use that same column name in
   every new table.
2. Find how the project talks to Supabase (Edge Functions in `supabase/functions/`?
   a different backend entirely?) and how it deploys them (CLI, MCP, CI).
3. Check whether an AI responder already exists elsewhere in the project (a
   chatbot, an assistant) — reuse its client/prompt-building code instead of
   inventing a second one. The webhook only needs to *call* something that
   returns a reply; it shouldn't own the AI logic.
4. Check for an existing "inbox" or "conversations" UI — if one exists for a
   single channel already, extend it rather than building a parallel one.

If any of this is unclear, ask the user rather than guessing table names.

## Implementation checklist

Work through these in order — each depends on the previous one being real,
not stubbed.

### 1. Meta-side setup (the user does this, in the Meta dashboard — you can't automate it, but you can walk them through it)

1. Create a Meta App (type "Business") inside their Business Manager, or confirm one already exists that should be reused.
2. Add the WhatsApp, Messenger, and/or Instagram products to that App (whichever channels are in scope).
3. **Settings → Basic**: copy the **App Secret** — needed to verify webhook signatures.
4. **Business Settings → System Users**: create a System User, assign it the products above, generate a **permanent token** with `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_messaging`, `instagram_manage_messages` (only the ones actually needed).
5. Configure **Embedded Signup** for WhatsApp (and the equivalent Facebook Login flow for Pages/Instagram) — this is what lets a *client* connect their own number/page without giving you their password. Going to production with real external clients (not just the developer's own test numbers) typically requires Meta business verification + App Review of the advanced permissions above — flag this to the user early, it's not something you can skip by writing better code.
6. Have them pick a `VERIFY_TOKEN` string (anything) for the webhook handshake.

Everything below is what actually gets built in the repo.

### 2. Database schema

Read `references/schema.sql` and adapt it to the project's real tenant column
name and any existing tables it should join against. Four tables:
`meta_conexiones` (per-tenant channel IDs), `conversaciones` (one row per
tenant+channel+customer — the inbox), `mensajes` (raw message history),
`mensajes_procesados` (dedupe). Don't skip `replica identity full` on
`conversaciones` — without it, Realtime's `payload.old` only contains the
primary key, silently breaking any "did this actually change" comparison
downstream (this is a real bug class, not theoretical — it's the kind of
thing that causes duplicate/false notifications later and is easy to miss in
testing because it only shows up on *updates*, not inserts).

### 3. Webhook Edge Function

Read `references/webhook.ts` — a complete, working Deno/Supabase Edge
Function implementing: the GET handshake, HMAC-SHA256 signature validation,
tenant resolution by `phone_number_id`/`page_id`/`instagram_id`, dedupe,
saving messages, calling an AI responder (stubbed — wire it to whatever the
project already uses), sending the reply back through the *tenant's own*
channel ID, and human-handoff (`necesita_asesor`/`pausado`) flags.

Adapt the stubbed `generarRespuestaIA` to call the project's real AI
provider. Everything else is close to copy-paste, but re-read it rather than
pasting blind — table/column names must match what you set up in step 2.

An unknown/unconnected `external_id` must be silently ignored (return 200,
do nothing) — never error. A stray webhook for someone else's number hitting
your endpoint is normal, not a bug.

### 4. Embedded Signup (frontend)

Read `references/frontend.md` for the FB SDK snippet and the shape of the
backend endpoint that exchanges the signup `code` for real channel IDs. That
code exchange **must** happen server-side (it needs the App Secret) — never
do it in the browser.

### 5. Inbox UI

Read `references/frontend.md` for the Supabase Realtime subscription pattern
that keeps an inbox list live-updating. If the project already has a list UI
for something else (tickets, orders), match its existing patterns for
filtering/badges/assignment rather than inventing new ones — consistency
inside the host app matters more than matching this reference verbatim.

## Common mistakes to avoid

- **Storing a token per tenant.** You don't need one — the System User token
  is shared across every tenant. If you find yourself asking a client for an
  API key, you've misunderstood the model.
- **Skipping signature validation "for now."** It's a few lines; there's no
  good reason to defer it, and a webhook without it is a free message-spoofing
  endpoint.
- **Resolving the tenant from anything the end customer can control** (their
  name, a code they type). Always resolve from the Meta-assigned account ID
  in the payload, which only exists because *the tenant* connected that
  account — never trust client-supplied identifiers for tenant resolution.
- **Forgetting `replica identity full`** and then being confused why "only
  notify on new messages" logic fires on unrelated row updates too.
- **Answering with a fixed/default channel ID** instead of the one from the
  inbound payload — this is what makes replies go out from the wrong tenant's
  number.

## Reference files

- `references/schema.sql` — full SQL schema + RLS + Realtime publication.
- `references/webhook.ts` — full Edge Function source.
- `references/frontend.md` — Embedded Signup snippet, code-exchange endpoint shape, Realtime inbox subscription, pause/resume snippet.
