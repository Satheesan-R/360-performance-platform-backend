# Settings page API connection

The existing settings endpoints manage the logged-in user's profile and password.
They are available to every active account role. The frontend sends the JWT from
`POST /api/auth/login` in `Authorization: Bearer <token>` on every request.
No user ID is supplied: the server selects the account from the token.

## Start the backend

Set `FRONTEND_URL` in the backend `.env` to the exact frontend origin, including
the port. For example, use `http://localhost:5173` for a frontend running there,
or `http://localhost:3000` for a frontend running there. Restart after changing it.
The backend defaults to port `5000`; use your configured `PORT` if different.

```powershell
npm.cmd run dev
```

Wait for both `MongoDB connected` and `Backend server running on port 5000`.
The HTTP server does not start until MongoDB connects. Resolve any MongoDB
connection timeout before trying these endpoints from the frontend.

## Endpoints

Base URL: `http://localhost:5000/api`.

| Method | Path | Settings page action | JSON body |
| --- | --- | --- | --- |
| GET | `/settings/profile` | Load account and employee details | None |
| PATCH | `/settings/profile` | Save contact details | `{"phone":"+94771234567","address":"Colombo, Sri Lanka"}` |
| PATCH | `/settings/password` | Change password | `{"currentPassword":"old-password","newPassword":"new-password-123"}` |

All three return HTTP `200` on success.

### Profile response

```json
{
  "success": true,
  "profile": {
    "id": "507f1f77bcf86cd799439011",
    "email": "employee@example.com",
    "role": "employee",
    "lastLoginAt": null,
    "employee": {
      "_id": "507f1f77bcf86cd799439012",
      "employeeNumber": "EMP001",
      "firstName": "Example",
      "lastName": "Employee",
      "workEmail": "employee@example.com",
      "phone": "+94771234567",
      "address": "Colombo, Sri Lanka",
      "jobTitle": "Software Engineer",
      "department": "Engineering",
      "officeLocation": "Colombo"
    }
  }
}
```

Optional employee fields may be absent. `employee` can be `null` when the account
has no linked employee record. Render missing values as empty strings and disable
contact editing for an unlinked account. `lastLoginAt` is a date string when set.

Profile updates return the same shape, plus `"message": "Profile updated"`.
Only `phone` and `address` are editable here; names, email, role, and employment
details are read-only. Send either or both editable fields, not the entire profile.
Both must be strings; surrounding whitespace is trimmed. Empty strings clear the
fields. A nonempty phone must match `^[0-9+\-\s()]{7,20}$`; the address has a
300-character limit after trimming.

Password changes return:

```json
{ "success": true, "message": "Password changed successfully" }
```

`currentPassword` must match the current password. `newPassword` must be 8-72
characters and different from the current password. If your form has a confirm
password input, compare it with the new password in the frontend and send only
the two fields shown above. Clear password inputs after success.

## Reusable frontend connection

Copy [settings-api.mjs](../examples/settings-api.mjs) into your frontend's
API/services directory. It uses browser `fetch` and requires no extra packages.
Provide a function that reads the current token from your existing login state.

```js
import { createSettingsApi } from './settings-api.mjs';

const settingsApi = createSettingsApi({
  baseUrl: 'http://localhost:5000/api',
  getToken: () => authState.token, // Replace with your app's current login state.
});

// When the settings page opens:
try {
  const profile = await settingsApi.getProfile();
  const values = {
    email: profile.email,
    firstName: profile.employee?.firstName ?? '',
    lastName: profile.employee?.lastName ?? '',
    phone: profile.employee?.phone ?? '',
    address: profile.employee?.address ?? '',
  };
  // Set your form state to values.
} catch (error) {
  // Display error.message. For error.status === 401, return to login.
}

// In the contact form's submit handler:
async function saveContactDetails(phone, address) {
  const profile = await settingsApi.updateProfile({ phone, address });
  // Update your displayed profile and show a success message.
  return profile;
}

// In the password form's submit handler:
async function savePassword(currentPassword, newPassword, confirmPassword) {
  if (newPassword !== confirmPassword) {
    throw new Error('Passwords do not match');
  }
  return settingsApi.changePassword({ currentPassword, newPassword });
}
```

Call submit functions inside `try/catch` to display server validation messages.
Disable the relevant submit button while its request is pending. The client reads
the token before every call, so login changes are picked up without recreating it.

## Errors and connection troubleshooting

| Status or symptom | Meaning / frontend action |
| --- | --- |
| `400` | Invalid contact fields, incorrect current password, or invalid new password. Show the response `message`. |
| `401` | Missing/expired token or unavailable account. Return to login. |
| `404` on profile save | No employee profile is linked to this account. |
| `500` | Server/database failure. Show a retry message and inspect backend logs. |
| Browser CORS error | Set backend `FRONTEND_URL` to the frontend's exact origin and restart. |
| Connection refused / failed to fetch | Check that the backend started, MongoDB connected, and the API URL and port are correct. |

Errors include a `message`; service errors also include `success: false`.
Authentication middleware responses may contain only `message`.

Notification preferences, theme persistence, and avatar uploads do not currently
have settings endpoints. Company settings use the separate
[organization API](organization-api.md), which requires an HR or admin account.
