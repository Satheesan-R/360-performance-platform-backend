# Security and Login

Password changes use `PATCH /api/settings/password` with `currentPassword` and
`newPassword`. Current-password verification, a different new password, a minimum
of eight characters, and bcrypt's maximum of 72 UTF-8 bytes are enforced by the
server. The frontend also requires matching confirmation. The local strength
estimate is guidance and never sends password text to an external service.

Successful responses include:

```json
{
  "success": true,
  "message": "Password changed. All sessions have ended. Please sign in again.",
  "requiresLogin": true,
  "notification": { "status": "accepted" }
}
```

The password hash, change time, and increment of `User.sessionVersion` commit in
one conditional write. Every authenticated API request checks the active account,
role, and current session version in MongoDB. Existing tokens without a version
are treated as version zero for compatibility. Password changes revoke all tokens,
including the caller's. A fresh login issues the current version; no schema
migration is required. Setup tokens cannot authorize normal API requests.

The frontend clears its sign-in and returns to Login with a success notice.
`passwordChangedAt` is displayed on Security and Login after the next login.
Deployment requires backend and frontend together because the response now ends
the calling session. Each authenticated request adds an indexed account lookup.

SMTP security alerts are mandatory attempts independent of optional notification
preferences. `accepted` means SMTP accepted the recipient, not inbox delivery.
`unavailable` means SMTP credentials are absent; `failed` means delivery could
not be confirmed. A five-second email deadline prevents an unresponsive SMTP
server from holding the password response indefinitely. Mail failures do not
roll back the password change or invite a retry. No durable email retry queue is
implemented. Tests mock SMTP and do not send real mail.

Individual session controls, login history, and MFA remain future phases.
