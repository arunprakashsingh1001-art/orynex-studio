# WhatsApp Content Approval Workflow — Setup & Security Plan

**Status: NOT CONNECTED / NOT SENDING MESSAGES / NOT PUBLISHING AUTOMATICALLY**

## Current user setup
- User currently uses regular WhatsApp.
- Approval recipient number was supplied by the owner in the setup conversation. Keep it out of source code and public repository files.
- No WhatsApp OTP, API token, app secret, or access credential has been supplied or should be committed.

## Important platform limitation
Regular WhatsApp is not an official automation API for this workflow. Do not automate WhatsApp Web with browser scripts, unofficial libraries, QR/session scraping, or personal-account bots. Those approaches can expose the account and may violate platform terms.

Use the official WhatsApp Business Platform (Cloud API), or a reputable provider that uses it, after the owner completes Meta Business setup. This may require a business-capable phone number, a Meta developer app, WhatsApp Business Account, approved sender, and message templates for business-initiated messages. Verify current eligibility and setup requirements in Meta's official documentation before choosing whether to migrate/use a separate number.

## Proposed workflow
1. Content generator creates a draft package: content ID, caption, platform, proposed publish time, asset preview/link, destination, and factual-claims/rights checklist.
2. Store it as `pending_approval`. It is not publishable at this state.
3. Send an approval request only after API setup is explicitly authorized. Use a WhatsApp-approved template where required and include a secure review URL. Keep sensitive assets behind authentication.
4. Owner reviews the full preview and chooses **Approve**, **Request changes**, or **Reject** on an authenticated review page. Do not treat delivery/read receipts or an ordinary WhatsApp reply as approval.
5. Approval endpoint verifies authentication, authorization, CSRF/origin protections where applicable, content ID, current state, expiry, and a one-time approval token. Record who approved, what version, and when.
6. State transition: `pending_approval → approved`. Edits to copy or media after approval reset state to `pending_approval`.
7. Publishing is a separate integration and a separate explicit gate. Default state remains `approved_not_published`; do not publish until the owner separately enables a publishing integration and policy.
8. Log delivery status, approval, revisions, publish result, and errors without logging credentials or unnecessary personal data.

## Security requirements
- Never store the recipient's personal phone number in public source code, client-side bundles, logs, or this repository. Configure it as a protected server-side environment variable after consent.
- Keep Cloud API token, app secret, webhook verify token, and any provider credentials in server-side secrets only (e.g. approved Supabase/Vercel environment variables). Never expose them to browser code or Git.
- Use a dedicated webhook endpoint with Meta signature verification (where supported), webhook verification handshake, strict request validation, rate limiting, replay protection, and idempotency.
- Restrict approval to an owner allowlist and authenticated review session. Do not rely on caller-supplied phone number or content ID alone.
- Use short-lived, cryptographically random, single-use approval tokens stored hashed server-side; bind each token to a specific content version and action. Expire them. Prefer an authenticated review page over approve/reject URLs that can be accidentally activated by link scanners.
- Use least-privilege access; rotate/revoke credentials if exposed.
- Do not include private project details or customer data in notification text. Send a minimal summary and a protected review link.
- Follow WhatsApp opt-in/template rules and applicable privacy/marketing laws. Approval notifications are operational messages; do not repurpose them for marketing.
- Default fail-closed: if API, webhook, identity, version, or audit checks fail, do not approve or publish.

## Suggested status model
`draft`, `pending_approval`, `changes_requested`, `rejected`, `approved_not_published`, `publishing`, `published`, `publish_failed`, `expired`.

Only an authenticated owner action may move an item to `approved_not_published`. No automated model, notification delivery receipt, or ordinary incoming message can approve content.

## Approval message template (draft; do not send until configured and authorized)
**Orynex Studio — content review requested**
- Item: {{content_title}}
- Platform: {{platform}}
- Proposed publish time: {{scheduled_time_with_timezone}}
- Draft caption: {{short_caption_preview}}
- Preview: {{authenticated_review_url}}

Please open the secure review page to approve, request changes, or reject. Nothing will publish until approved and publishing is separately enabled.

## Setup checklist
- [ ] Owner decides whether to use a dedicated business number or an eligible number for WhatsApp Business Platform.
- [ ] Owner creates/configures Meta Business Portfolio, WhatsApp Business Account, and Meta developer app as required.
- [ ] Verify business/phone-number eligibility and display name in Meta's current onboarding flow.
- [ ] Configure approved recipient as a server-side secret/config value; do not commit it.
- [ ] Configure access token, app secret, and webhook verification secret in server-side secrets.
- [ ] Implement webhook signature verification and authenticated approval UI.
- [ ] Create/submit notification template if required and wait for approval.
- [ ] Test in a development/test environment with a non-production content item.
- [ ] Verify unauthenticated, wrong-recipient, expired, replayed, edited-content, duplicate-webhook, and provider-failure cases all fail closed.
- [ ] Owner explicitly authorizes a first real notification.
- [ ] Publishing integration remains disabled until separately authorized.

## Current implementation state
This document is preparation only. It does not create Meta credentials, configure a real phone number, deploy an endpoint, send messages, or publish content. Do not represent the workflow as connected until an end-to-end test has passed with the owner's explicit authorization.
