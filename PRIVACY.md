# Privacy Policy (Draft)

**This is a draft written to accurately describe what this specific app
does — not legal advice.** If you're operating in a jurisdiction with
specific requirements (GDPR, CCPA, etc.), have a lawyer review this before
you rely on it. Replace the bracketed placeholders before publishing.

_Last updated: [DATE]_

## 1. Who we are

Afroica AI is operated by [YOUR NAME / BUSINESS NAME]. Contact:
[YOUR CONTACT EMAIL].

## 2. What we collect

| Data | When | Why |
|---|---|---|
| Email address | Sign-up | Account identity, login, password-reset emails |
| Password | Sign-up | Stored only as a bcrypt hash — we never see or store your plain password |
| Daily message count | Every message you send | Enforcing the free tier's daily limit |
| Subscription status (plan, renewal date, Stripe customer/subscription ID) | Pro checkout | Knowing whether you're Pro, managing billing |
| IP address | Every request | Used only in-memory, briefly, to rate-limit login/signup attempts against abuse — **not stored in the database or logged long-term** |

## 3. What we deliberately do NOT collect

- **Free-tier chat content.** The free tier runs entirely in your browser
  (WebLLM/WebGPU). Your messages and the model's responses never leave
  your device — they're not sent to our backend at all.
- **Pro-tier chat content.** Pro messages are streamed through our backend
  to Anthropic's API to generate a response, but the message text and
  response are not saved anywhere on our side — no database table stores
  conversation content.
- We don't run analytics or tracking scripts.

## 4. Third parties we share data with

- **Anthropic** (Pro tier only): the text of messages you send while on
  Pro is sent to Anthropic's API to generate a response, subject to
  [Anthropic's own privacy policy](https://www.anthropic.com/privacy).
  Anthropic is not sent anything from the free tier.
- **Stripe**: handles all payment processing for Pro subscriptions. We
  never see or store your card details — only the subscription status and
  IDs Stripe gives us back.
- **Resend** (only if a reset email is actually sent): delivers
  password-reset emails. Receives your email address and the reset link,
  nothing else.

We don't sell your data, and don't share it with anyone else.

## 5. How long we keep data

- Account data (email, password hash, subscription status) is kept until
  you delete your account.
- Daily usage counts are kept to enforce the free-tier limit; they contain
  no message content, just per-day counts.
- Password-reset tokens expire after 1 hour and are single-use regardless.

## 6. Deleting your data

You can permanently delete your account from Settings at any time. This:
- Cancels any active Pro subscription with Stripe.
- Deletes your usage-history records.
- Deletes your account record (email, password hash).

This is immediate and cannot be undone. [Note: if you enable admin
impersonation-log retention beyond what's needed for abuse investigation,
document that retention period here — currently impersonation log rows are
deleted along with the user's other records.]

## 7. Admin access

A single operator (admin) account can view aggregate usage/business
metrics and individual account histories (join date, plan, daily message
counts over time) for support and abuse-prevention purposes — never chat
content, since it isn't stored. The admin can also access any account
directly ("impersonation") for support purposes; every use of this is
logged with a timestamp of who was impersonated and when.

## 8. Security

- Passwords are hashed with bcrypt, never stored or logged in plain text.
- Sessions use signed tokens (JWT) that expire automatically.
- The admin dashboard uses a completely separate credential and signing
  key from user accounts.

No system is perfectly secure; if you believe there's been a data breach
affecting your account, contact [YOUR CONTACT EMAIL].

## 9. Children's privacy

The Service isn't directed at children under 13, and we don't knowingly
collect data from them.

## 10. Changes to this policy

We may update this policy. Material changes will be noted here with an
updated date.

## 11. Contact

Questions about this policy or your data: [YOUR CONTACT EMAIL].
