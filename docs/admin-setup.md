# Create the first admin login

Run this command from the backend repository against the intended MongoDB database.
It creates an active user with the admin role and a bcrypt password hash. It does
not create a Gmail mailbox, send email, create an employee record, or replace an
existing account. Use an existing Gmail or company email as the login identifier
and choose a separate application password, not the Gmail account password.

1. Ensure the ignored local `.env` has MONGODB_URI and JWT_SECRET configured.
2. Temporarily add your real email and a unique password:

   ```env
   ADMIN_EMAIL=your-existing-email@gmail.com
   ADMIN_PASSWORD=replace-with-a-unique-password
   ```

3. Run `npm run create:admin`.
4. On success, remove ADMIN_PASSWORD (and optionally ADMIN_EMAIL) from `.env`.
   Do not commit or share these credentials.
5. Start the backend and log in through the existing frontend login form, or use
   `POST /api/auth/login` with a JSON body containing email and password. The login
   response includes a token, role admin, and redirectTo `/admin/dashboard`.
   That dashboard must exist in the separate frontend repository.

Passwords must contain at least 12 characters and no more than 72 UTF-8 bytes
(the bcrypt limit). Password whitespace is preserved; email is trimmed/lowercased.
The command never prints the password or hash. Environment variables supplied in
the current process take precedence over `.env`, following existing dotenv setup.

If the address already exists, the command stops without changing its role,
password or status. Use a different address or an explicit account-management
process; rerunning setup does not reset passwords or promote existing employees.
The MongoDB unique email index also prevents concurrent duplicate creation.

`npm test` verifies hashing, validation and duplicate handling with mocked database
operations. A real admin is created only when you run the command with your local
credentials and database connection. There is no public admin-registration API.
