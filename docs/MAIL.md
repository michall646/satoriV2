# Email transport

Satori sends transactional mail through one of four providers. The default is a
non-delivering console provider; configure a real transport before relying on
password-reset links or announcement mail.

## Configuration

| Variable | Meaning |
|----------|---------|
| `SATORI_MAIL_PROVIDER` | `console` (default), `webhook`, `resend`, `sendgrid` |
| `SATORI_MAIL_FROM` | Sender address, required for HTTP providers |
| `SATORI_MAIL_API_KEY` | API key for Resend or SendGrid |
| `SATORI_MAIL_WEBHOOK` | HTTPS endpoint for the generic webhook provider |
| `SATORI_WEB_BASE_URL` | Public web origin used in links (default `http://localhost:3000`) |
| `SATORI_MAIL_ALLOW_CONSOLE` | `1` makes the console provider count as configured (dev only) |
| `SATORI_DEV_RESET_TOKEN` | `1` returns reset tokens in the API response (tests/dev only) |

The webhook receives:

```json
{
  "from": "Satori <no-reply@example.edu>",
  "to": "student@example.edu",
  "subject": "[Satori] Feedback — Algorithms",
  "text": "…",
  "html": "…"
}
```

The endpoint must return a 2xx status. Non-2xx, timeouts (5 s), and transport
errors are reported as `{ ok: false, error }`; they never throw into the request
handler.

## What sends mail

- **Password reset** — `POST /api/auth/forgot` mails `${SATORI_WEB_BASE_URL}/reset?token=…`
  when a real provider is configured. The response stays generic for unknown
  accounts. With the console provider the token is logged to stderr; with
  `SATORI_DEV_RESET_TOKEN=1` it is also returned as `devToken`.
- **Announcements** — `POST /api/contests/:id/news` with `email: true` mails
  contest members who have an address and `notificationPrefs.email !== false`.
  The author is skipped, the recipient list is capped at 200, and the response
  reports `emailed`, `emailErrors`, and `emailSkipped`. The web composer keeps
  the email checkbox hidden until delivery reporting is surfaced.
- **Grade feedback** — `POST /api/contests/:id/grade/feedback` mirrors the
  in-app feedback notification by email when a transport is configured.
  `emailSkipped` is returned when it is not.

## Not implemented

- SMTP (use the webhook provider with a small relay).
- Retry queue / scheduled delivery. A failed send is reported, not retried.
- Email verification and welcome mail.
- Watch/submit email events (in-app only).
