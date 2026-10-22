# Goals and OKRs API

An objective is called a **goal** in this API. A goal plan groups organization,
team, and individual goals for a dated period. Each goal contains measurable key
results. Check-ins record changes to those measurements.

## Setup

- Start the backend with `npm.cmd run dev`. The default API base is
  `http://localhost:5000/api`.
- MongoDB must support transactions: use MongoDB Atlas or a local replica set.
  A standalone MongoDB server can serve reads but cannot perform the transactional
  goal writes. This is the same requirement as reporting-hierarchy assignments.
- Set up the company with the existing organization API first. Teams, reporting
  relationships, and employee accounts use the existing organization/auth modules.
- Get a login token from `POST /api/auth/login`. Every endpoint below requires
  `Authorization: Bearer <token>` and JSON bodies use `Content-Type: application/json`.
- The server rechecks the current account status and role in MongoDB. Disabled
  accounts and activation tokens cannot use this module.

No additional environment variables or npm dependencies are needed. Collections
are `goalPlans`, `goals`, `keyResults`, and `goalCheckIns`; Mongoose manages them.
No existing employee records are migrated. As elsewhere in this single-company
backend, legacy employees with a null organization link belong to the company.

## Permissions

| Account | Read | Create/update |
| --- | --- | --- |
| HR/admin | All plans and goals in the company | Plans and all goals |
| Department manager | Organization goals, own team goals, goals in headed departments/led teams, and own/direct-report individual goals | Team goals in headed departments/led teams, and own/managed individual goals |
| Tech lead | Organization goals, own/led team goals, and own/managed individual goals | Led team goals and own/managed individual goals |
| Employee | Plans, organization goals, own team's goals, and own individual goals | Own individual goals and their key results/check-ins |

Managers and tech leads get access from actual `Department.headEmployeeId`,
`Team.teamLeadEmployeeId`, and `Employee.managerId` relationships. A role alone
does not grant access to unrelated teams. Department-head permissions require the
department-manager role. Team-lead permissions require tech-lead or
department-manager role. Inactive teams/departments do not grant management access.
Direct-report access is one reporting level, not recursive.

Non-HR/admin accounts must have a linked employee profile. Every goal owner must
be an existing employee in the company with an active linked user account.
Organization goals require HR/admin to manage them, even when someone else owns
the goal. Team goals require a team manager to manage them. Individual owners can
manage their own individual goals.

## Endpoints

Paths below are relative to `/api`.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/goal-plans` | Create a draft plan (HR/admin) |
| GET | `/goal-plans` | List plans |
| GET | `/goal-plans/:id` | Read a plan |
| PATCH | `/goal-plans/:id` | Edit a plan or change status (HR/admin) |
| POST | `/goals` | Create a draft goal |
| GET | `/goals` | List visible goals, key results, and calculated progress |
| GET | `/goals/:id` | Read a visible goal and its key results |
| PATCH | `/goals/:id` | Edit title/description or change status |
| GET | `/goals/:id/children` | List visible direct children |
| POST | `/goals/:id/key-results` | Add a key result |
| PATCH | `/key-results/:id` | Edit a key result definition |
| POST | `/key-results/:id/check-ins` | Record a progress measurement |
| GET | `/key-results/:id/check-ins` | List progress history, newest sequence first |

Creates return `201`; reads and updates return `200`. Every success contains
`success: true`. Single resources are under `plan`, `goal`, or `keyResult`.
Lists use `plans`, `goals`, or `checkIns`, with:

```json
{ "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
```

All lists accept `page` and `limit` (default 1/20, maximum limit 100).
Plan lists accept `status`. Goal lists accept `planId`, `level`, `status`,
`ownerEmployeeId`, `teamId`, and `parentGoalId`. Filters narrow the caller's
visibility; they never expand it. Children lists accept the same filters and
pagination, with the parent fixed by the path. Goal details and list items include
their own `keyResults`, calculated `progress`, and `isOverdue`.

## Walkthrough

Use the IDs returned by each response in the next request. IDs below in angle
brackets are placeholders. `ownerEmployeeId` is an employee ID, not a user ID.

### 1. Create a goal plan as HR/admin

`POST /api/goal-plans`

```json
{
  "name": "Q1 2027",
  "description": "First-quarter goals",
  "startDate": "2027-01-01",
  "endDate": "2027-03-31"
}
```

Dates must be valid `YYYY-MM-DD` calendar dates; end must not precede start.
Name is required (1–200 characters); description is optional (up to 2000).
Plans start as draft. Activate with:

`PATCH /api/goal-plans/<planId>`

```json
{ "status": "active" }
```

Plan lifecycle is `draft -> active -> closed -> archived`. Date changes are
allowed only in draft. Closed plans preserve history and can only be archived;
archived plans cannot change. Closing a plan freezes its goals and check-ins; it
does not mark unfinished goals as completed. Closing does not require every goal
to be finished. An HR/admin may edit a plan's name/description before closure.

### 2. Create an objective

`POST /api/goals`

```json
{
  "planId": "<planId>",
  "title": "Improve my ticket handling",
  "description": "Resolve customer issues efficiently",
  "level": "individual",
  "ownerEmployeeId": "<employeeId>",
  "parentGoalId": "<teamGoalId>"
}
```

Required: `planId`, `title` (1–200 characters), `level`, `ownerEmployeeId`.
Optional: description (up to 2000), `parentGoalId`, `teamId`.
Omit `parentGoalId` or use null for an independent goal.

- `organization` goals have no team and are created by HR/admin.
- `team` goals require an active `teamId`; the owner must belong to or lead it.
- `individual` goals derive their team from the owner employee. A supplied team
  must match that employee's team; teamless employees can have individual goals.
- Cascading allows organization -> team, organization -> individual, and team ->
  individual in that same team. Parent and child must use the same plan.
- Completed/cancelled parents cannot receive new child goals.
- Plan, owner, level, team, and parent links cannot be edited after creation.
  This keeps historical ownership and prevents circular relationships. Cancel an
  incorrectly assigned goal and create a replacement.

Goal dates inherit the plan dates. An unfinished goal becomes `isOverdue: true`
after the plan end date, interpreted as inclusive through the end of that UTC
calendar day. Date boundaries do not automatically activate or close a plan;
HR/admin controls its lifecycle.

### 3. Add measurable key results

`POST /api/goals/<goalId>/key-results`

```json
{
  "title": "Resolve 100 customer tickets",
  "type": "increase",
  "unit": "tickets",
  "startValue": 0,
  "targetValue": 100
}
```

Supported measurements:

| Type | Example | Validation |
| --- | --- | --- |
| `increase` | Tickets from 0 to 100 | Target must exceed start |
| `decrease` | Response hours from 48 to 24 | Target must be below start |
| `milestone` | Complete a training course | Start 0, target 1; filled automatically |

Title and type are required. Numeric metrics also require start and target.
Unit is optional, up to 40 characters. Measurements must be finite JSON numbers
between -1e12 and 1e12; numeric strings are rejected. Current value initially
equals the starting value.

Use `PATCH /api/key-results/<id>` with title, unit, type, startValue, or targetValue.
Before the first check-in, a definition change resets the current value to the
starting value. After the first check-in, type/start/target are locked to preserve
the meaning of past measurements; title/unit can still change. Milestone
definitions must use start 0 and target 1, including when changing metric type.
Never send `currentValue`, `progress`, or `checkInCount` to this endpoint.

### 4. Activate the goal

`PATCH /api/goals/<goalId>`

```json
{ "status": "active" }
```

The goal's plan must already be active. Goals can be prepared in a draft plan,
but check-ins require both plan and goal to be active.

### 5. Record progress

`POST /api/key-results/<keyResultId>/check-ins`

```json
{ "value": 50, "note": "Resolved 50 tickets so far" }
```

`value` is the new absolute measurement, not an increment. Notes are optional
(up to 2000 characters). Milestones accept only `0` or `1`. Numeric values may
exceed targets or regress for corrections; displayed progress stays within 0–100%.

Response shape:

```json
{
  "success": true,
  "checkIn": {
    "keyResultId": "<keyResultId>",
    "previousValue": 0,
    "value": 50,
    "note": "Resolved 50 tickets so far",
    "sequence": 1,
    "updatedBy": "<logged-in-userId>"
  },
  "keyResult": {
    "currentValue": 50,
    "progress": 50,
    "checkInCount": 1
  },
  "goalProgress": 50
}
```

Actual documents also include IDs, relationship fields, definitions, and timestamps.
The backend sets author, previous value, sequence, and time. Check-ins are
append-only through this API: corrections are new check-ins, not history edits.
Current measurement and history commit together in a transaction. All mutations
within a plan take a shared plan lock so closure and completion cannot race with
an in-flight check-in. Concurrent check-ins are sequenced in commit order.

### 6. Complete or cancel a goal

Goal lifecycle is `draft -> active -> completed`, with cancellation from draft
or active. To complete, send `{"status":"completed"}` to the goal PATCH endpoint.
Every key result must actually reach its target and at least one must exist.
Completing is explicit, not automatic when measurements reach 100%.

Completed/cancelled goals cannot receive edits, additional key results, or
check-ins. HR/admin or an authorized manager other than the owner can reopen one
with a separate `{"status":"active"}` request while the plan is active.
An owner cannot reopen their own completed/cancelled goal unless HR/admin.
Cancellation and plan archival preserve history; there are no delete endpoints.

## Progress calculation

For numeric metrics:

```text
((currentValue - startValue) / (targetValue - startValue)) * 100
```

The formula handles both increasing and decreasing targets. For 48 -> 24 hours,
36 hours is 50%. Displayed values are clamped to 0–100 and rounded to two decimal
places. Milestones are 0% or 100%. A goal's progress is the equally weighted mean
of its own key results; without results it is 0%. Completion checks actual target
achievement, so rounding a near-target value to 100% does not complete a goal.

Parent links express alignment. Child goal percentages do not feed into a
parent's percentage. This avoids counting work twice and lets each organization
objective have its own measurable business outcomes.

## Frontend request example

```js
const response = await fetch('http://localhost:5000/api/goals?planId=' + planId, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await response.json();
if (!response.ok) throw new Error(data.message || 'Unable to load goals');
// Render data.goals and data.pagination.
```

Use your current login token on each request. For POST/PATCH, add
`'Content-Type': 'application/json'` and `body: JSON.stringify(values)`.
Match the backend `FRONTEND_URL` to your frontend origin for CORS.

## Errors and verification

| Status | Meaning |
| --- | --- |
| 400 | Invalid fields, IDs, dates, targets, filters, or relationships |
| 401 | Missing/invalid token, activation token, disabled/missing account |
| 403 | Account lacks management access or needs a linked employee profile |
| 404 | Resource missing or goal outside the caller's visibility |
| 409 | Organization not set up, locked lifecycle state, or premature completion |
| 500 | Database/server failure; inspect backend logs |

Errors use the existing `message` response field. Unknown body fields are rejected,
including client-supplied organization IDs, author IDs, or calculated percentages.

Run `npm.cmd test`. Goal tests exercise the real services and local HTTP routes
with mocked database queries/transactions, including access, validation,
calculation, cascading, lifecycle, and check-in sequencing. They do not connect
to or modify the configured MongoDB database. Transaction rollback/concurrent
write behavior should also be verified against a dedicated replica-set test
database before deployment.

This version does not add approvals, weighted key results, automatic parent
rollups, reminders, attachments, or performance-review-cycle links. Goal plans
remain separate from review cycles; those can be linked when reviews are built.
