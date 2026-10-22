# Employee activation emails

Invitations are sent to the onboarding payload's `companyEmail` (stored as
workEmail). `personalEmail` is not the invitation destination. The sending account
is SMTP_USER; this is separate from an HR/admin application's login account.
The same invitation flow handles employee, tech lead and other assigned roles.
After an employee is created, a separate notification is sent to every
non-disabled user whose role is employee, tech_lead, department_manager or hr. The new
employee is excluded from this fan-out because they already receive the
activation email.

Configure the ignored local `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-sending-account@gmail.com
SMTP_PASS=your-google-app-password
MAIL_FROM="Performance Platform <your-sending-account@gmail.com>"
```

For Gmail password-based SMTP, use an App Password where the Google account
supports it. Google requires 2-Step Verification for App Passwords. See
[Google's instructions](https://support.google.com/mail/answer/185833).
Use a sender address authorized for that SMTP account. Restart the backend after
editing `.env`. Do not commit passwords.

Run `npm run mail:verify` to test SMTP connection and authentication without sending
mail. This check does not prove a specific recipient's address is valid or that
their inbox will accept the message.

`POST /api/employees` returns status 201 after successful employee creation, with
`emailDelivery` and `onboardingNotifications` objects:

```json
{
  "message": "Employee created. Activation email accepted by the mail server",
  "employee": { "_id": "..." },
  "emailDelivery": { "status": "accepted", "recipient": "employee@example.com" },
  "onboardingNotifications": {
    "status": "accepted",
    "recipients": ["hr@example.com"],
    "failed": []
  }
}
```

Accepted means SMTP accepted the recipient, not confirmed inbox delivery. Check
the returned recipient, the recipient's Spam/Junk folder, and the sender's mailbox
for delivery failure notices. A valid SMTP login alone does not resolve these
delivery issues. Only the mail provider can confirm subsequent delivery.

`onboardingNotifications.status` is `accepted` when all matching recipients
were accepted, `partial` when at least one notification failed, and `failed`
when the recipient lookup or notification process could not be completed.

If SMTP fails or rejects the recipient after account creation, status remains 201
because the employee is already saved, but emailDelivery.status is failed and the
message clearly reports that the email could not be sent. Frontend must inspect
emailDelivery and show a warning, not a hardcoded email-success message. Do not
retry employee creation for that account: it already exists. A resend-invitation
endpoint is not implemented on this branch. Development responses still include
activationUrl, allowing manual handoff during development; production does not.

Missing SMTP credentials now fail with 503 before creating an employee. The
console-only link/OTP fallback was removed, so it cannot be mistaken for sending
an email. OTP email text states the actual two-minute validity period.

Tests mock SMTP and database calls: `npm test` does not email real recipients.
