# Account support workflow

## Reused features

Uses the existing Personal Settings account/profile, JWT/session revocation
middleware, active-account validation, single-company organization membership
rules, shared settings fields/icons/theme, and Nodemailer transporter. No prior
helpdesk, notification event bus, or general audit service was present. The new
support module follows the existing models/services/controllers/routes structure.
Platform roles, employee records, and organization assignments are never changed
by ticket actions.

## UI

Settings → Account → **Get Account Support** opens an inline, responsive workflow
with New request and My requests. Staff also see Support queue. Admins see Support
access, where an existing active account can be granted or revoked queue access
by email. An ordinary employee can therefore act as an IT support officer through
an explicit support membership without introducing an `it` login role.

Requester name/email come from the authenticated profile. Forms provide category,
subject, description, server-derived queue, validation, credential warnings,
loading/error/empty states and backend-confirmed success. Tickets provide details,
replies, activity/resolution history and eligible reopening. Staff can select an
authorized officer, set priority and perform valid status transitions. React
renders user content as plain text; HTML is not interpreted.

## API (all endpoints require authentication)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/support/context` | Permitted queues, categories/routing, admin capability |
| POST | `/api/support/tickets` | Create or replay an idempotent request |
| GET | `/api/support/tickets?scope=mine&page=1` | Own requests, 20 per page |
| GET | `/api/support/tickets?scope=queue&queue=IT&page=1` | Permitted queue, or all permitted queues without queue parameter |
| GET | `/api/support/tickets/:id` | Authorized details, conversation and audit history |
| POST | `/api/support/tickets/:id/messages` | Add `{text}`; requester response resumes WAITING_FOR_USER |
| PATCH | `/api/support/tickets/:id/assignment` | Support-only `{assigneeId, priority}`; null unassigns |
| PATCH | `/api/support/tickets/:id/status` | Support-only `{status, note}` |
| POST | `/api/support/tickets/:id/reopen` | Owner-only `{note}` within seven days of resolution |
| GET | `/api/support/officers?queue=IT` | Active, scoped queue officers for assignment |
| PUT | `/api/support/memberships` | Admin-only `{email, queues: ["IT"], active: true}` |

Creation accepts only `category`, `subject`, `description`, and a client-generated
16–80 character `requestId`. The ID is an idempotency key, not the ticket ID.
Ticket number, requester, organization, queue, timestamps, status, assignee and
priority are controlled by the server. Replaying the same key and content returns
the existing ticket without another email. Different content with the same key
is rejected. Identical content with a different key is suppressed within a
ten-minute time bucket. Keep MongoDB's unique indexes enabled; deploy required
indexes before serving writes when production auto-indexing is disabled.

## Models and audit

- `SupportTicket`: ticket fields, revision, bounded conversation, immutable
  application-level history, and last notification outcome. Unique ticket number,
  duplicate fingerprint, and organization/requester/idempotency indexes.
- `SupportMembership`: organization/user queue grants and administrator grant
  history. Built-in HR/admin access remains role-based.
- `SupportRate`: shared MongoDB rate counters with a TTL expiry index. Limits
  persist across processes and restarts: 5 creations and 30 mutations per user
  per 15-minute bucket; 20 membership updates. TTL deletion timing does not reset
  the current bucket.

Each ticket mutation uses revision-based compare-and-swap and atomically appends
its audit entry and message/status change. Concurrent stale mutations return 409.
History includes actor, timestamp, transition, resolution note and assignment.
Tickets are bounded to 200 messages/300 events to avoid unlimited document growth.
Membership audit retains the most recent 100 grant changes.

## Authorization and routing

Requesters access only their own organization-scoped requests. HR accesses HR
Support; admins access HR and IT; named active memberships grant only their listed
queues. Explicitly foreign organization membership is rejected using existing
single-company rules. Legacy employees without organization links belong to the
single company, as in the existing platform. Tickets outside the permitted scope
return 404. Support actions cannot be performed on one's own ticket.

Assignments must target active officers with access to the same queue and
organization; a ticket cannot be assigned to its requester. Escalation, resolution
and closure require support access and a note. Closing requires a resolved ticket.
Only the owner can reopen RESOLVED within seven days; CLOSED is terminal.

Default routing: LOGIN_PASSWORD, ACCESS_PERMISSIONS, MFA_SECURITY and OTHER_ACCOUNT
→ IT; PROFILE_INFORMATION → HR. Optional backend environment variables
`SUPPORT_DEFAULT_QUEUE` and `SUPPORT_PROFILE_QUEUE` accept IT or HR. The context API
supplies the resulting routes to the UI. Access/permission requests are for
investigation; role changes still require normal HR authorization.

Valid transitions:

```text
OPEN → IN_PROGRESS | ESCALATED | RESOLVED
IN_PROGRESS → WAITING_FOR_USER | ESCALATED | RESOLVED
WAITING_FOR_USER → IN_PROGRESS | ESCALATED | RESOLVED
ESCALATED → IN_PROGRESS | WAITING_FOR_USER | RESOLVED
REOPENED → IN_PROGRESS | ESCALATED | RESOLVED
RESOLVED → CLOSED | REOPENED (owner, within seven days)
CLOSED → terminal
```

## Notifications and credential handling

Existing SMTP is reused. New tickets and requester replies notify the correct
queue's active admins, HR where applicable, and explicit members (up to 50 queue
recipients). Support replies/status updates notify the requester. Emails contain
only the ticket number and a generic event, not descriptions or conversation.
Recipient addresses use BCC. No secret account fields are included in DTOs.
Forms warn against submitting credentials; the server rejects common credential
assignment formats, bearer/JWT tokens and private-key blocks. This detection is
not a guarantee that arbitrary prose contains no secrets; users must redact them.

Without SMTP or queue recipients, tickets still save and the API/UI clearly
reports that automatic notification is unavailable. SMTP failure never rolls back
or recreates a ticket; replayed creation never resends. SMTP acceptance is not
inbox delivery. Mail attempts have a three-second SMTP deadline. No background
retry/outbox, external helpdesk integration, or attachment upload is implemented.
Replies/status changes are revision-protected but do not have separate network
retry idempotency keys; refresh before retrying an uncertain operation.

## Manual verification

1. Restart the backend and frontend with these changes. Ensure MongoDB is connected,
   the company is configured, and model indexes are created. No replica set or
   transaction support is required for support's single-document writes.
2. Sign in as an employee, open Settings → Account → Get Account Support, submit
   a 5–160 character subject and 20–5,000 character description. Verify the real
   SUP number appears in My requests; refresh to confirm persistence.
3. Try another employee's ticket ID: access must be denied. Missing authentication
   must return 401. Try injecting requester/status/queue into creation: 400.
4. Sign in as HR: profile tickets appear in HR Support. HR cannot access IT tickets
   without a grant. Sign in as admin: grant an active IT officer account IT access
   in Support access, then sign in as that officer to manage the IT queue.
5. Assign a ticket, move it to IN_PROGRESS and WAITING_FOR_USER, and reply as the
   requester. Verify the status resumes IN_PROGRESS and messages/history persist.
6. Resolve with a note; verify the requester can reopen within seven days. Close
   after resolution; verify reopening is blocked. Confirm audit history displays
   the sequence without changing the employee's role or official records.
7. Disable SMTP in a development setup and submit once. Confirm a saved ticket and
   notification warning, then retry the same requestId: only one ticket exists.
8. Check the layout on a small screen, keyboard focus, field validation, loading,
   empty/error states, and the support button's Back to account behavior.

Automated verification: `node --test test/support.test.js` and `npm test` in the
backend; `node --test tests/account-support.test.mjs`, personal-settings tests,
TypeScript and targeted ESLint in the frontend. Database/SMTP calls are mocked in
automated tests. No production workflow uses sample data, browser-only tickets,
or simulated success. Live MongoDB/SMTP and browser interaction require the manual
checks above.
