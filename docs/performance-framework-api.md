# Performance Framework and Criteria APIs

Backend for the separate frontend page `/hr/performance-framework`.
All endpoints require a Bearer login token and the `hr` or `admin` role.
Organization setup must already be complete.

| Method and endpoint | Response |
| --- | --- |
| GET /api/performance-frameworks | `{ "frameworks": [...], "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 } }` |
| GET /api/performance-frameworks/summary | `{ "summary": { "total": 2, "draft": 1, "active": 1, "archived": 0 } }` |
| GET /api/performance-frameworks/:id | `{ "framework": { ... } }` |
| POST /api/performance-frameworks | Status 201, `{ "framework": { ... } }` |
| PATCH /api/performance-frameworks/:id | `{ "framework": { ... } }` |

## Create

```json
{
  "name": "Engineering Framework",
  "description": "Performance criteria for engineers",
  "applicableEmploymentTypeIds": [],
  "applicableJobRoles": ["Software Engineer"],
  "status": "draft"
}
```

Name is required (max 200 characters), description is optional (max 2000), and
status defaults to draft. Status values are `draft`, `active`, and `archived`.
Employment type IDs must identify existing active classifications in this company;
use `GET /api/employment-types?status=active` for the selector. Arrays may contain
at most 100 unique entries. Job roles are job-title labels, not authentication
roles or permission definitions. Both arrays default to empty, meaning no targeting
restrictions have been configured yet. Employee eligibility and review routing
are deferred; these arrays do not currently assign employees to reviews.

The backend supplies organizationId and createdBy (the authenticated User ID).
Clients must not send those fields, timestamps, counts, or ratingScale. Creation
also checks that the creator is an existing active HR/admin account.

Collection: `performanceFrameworks`. Organization, employment type, and creator
relationships use ObjectIds. Timestamps are automatic. Framework names are not
unique, allowing different configurations with the same display label; use `_id`
as identity. No frameworks are seeded automatically.

## List and display

List supports `search`, `status`, `employmentTypeId`, `page` (default 1), and
`limit` (default 20, maximum 100). Search matches name, description, or applicable
job titles as literal case-insensitive text. Follow pagination in the frontend.

Framework responses populate applicableEmploymentTypeIds with `_id`, name, code,
and isActive, and createdBy with `_id`, email, and role. Render employee-group
labels from these populated names. Send the IDs, rather than those objects, on
updates. applicableJobRoles remains an array of strings.

Responses include embedded competencies and kpis, computed competencyCount and
kpiCount (active items only), totalWeight, weightsValid, and ratingScale: null.
Old frameworks without arrays return empty arrays and zero counts. Show an unset
rating scale until the scoring module is implemented. Counts and scoring summary
are read-only; edit the individual criteria through their endpoints below.

## Edit and archive

PATCH accepts any non-empty subset of create fields. Send `{ "status": "archived" }`
to archive, or `{ "status": "active" }` to activate. Status changes are allowed
in either direction, but activation now requires active competency and KPI weights
to total 100%. This does not certify rating scales or templates are ready. No delete endpoint
is provided, preserving the parent record for future review templates/cycles.
Updating employment type selections validates them; a label/description-only edit
can preserve an existing selection whose employment type was later deactivated.

Organization Overview now returns the actual active framework count through
`GET /api/organization/summary`.

## Errors and verification

Service errors return `{ "success": false, "message": "..." }`.
Invalid fields, IDs, duplicates within arrays, unknown fields, or invalid applicable
classifications return 400; missing/invalid token returns 401; unauthorized roles
or unavailable creators return 403; missing frameworks return 404; missing company
setup returns 409. Authentication middleware uses `{ "message": "..." }`.

`npm test` checks validation, references, access control, listing, status changes,
and summaries using mocked database calls and local HTTP requests. Live MongoDB
verification and frontend integration remain necessary. Rating scales/weightages,
review templates, and review cycles are future milestones.

## Competencies and KPIs

Frontend page: `/hr/performance-framework/competencies`. Use the framework list
endpoint for the selector and the selected framework's ID in these paths.
Both tabs require the same HR/admin login token as Framework Overview.

| Endpoint | Purpose and response |
| --- | --- |
| GET /api/performance-frameworks/:id/competencies | `{ "frameworkId": "...", "competencies": [...], "scoring": { ... } }` |
| POST /api/performance-frameworks/:id/competencies | Status 201; `{ "competency": { ... }, "scoring": { ... } }` |
| PATCH /api/performance-frameworks/:id/competencies/:criterionId | `{ "competency": { ... }, "scoring": { ... } }` |
| GET /api/performance-frameworks/:id/kpis | `{ "frameworkId": "...", "kpis": [...], "scoring": { ... } }` |
| POST /api/performance-frameworks/:id/kpis | Status 201; `{ "kpi": { ... }, "scoring": { ... } }` |
| PATCH /api/performance-frameworks/:id/kpis/:criterionId | `{ "kpi": { ... }, "scoring": { ... } }` |

Competency create example:

```json
{
  "name": "Problem Solving",
  "description": "Identify and solve technical issues",
  "category": "technical",
  "weight": 30,
  "status": "active"
}
```

KPI create example:

```json
{
  "name": "Task Completion",
  "description": "Complete assigned tasks within the agreed SLA",
  "measurementUnit": "percentage",
  "targetValue": 90,
  "weight": 50,
  "targetPeriod": "Quarter 1",
  "status": "active"
}
```

Names and weights are required. Competencies require category (`technical` or
`behavioral`); KPIs require measurementUnit and targetValue. Units and optional
target periods are free-text labels, not a fixed review policy. targetValue must
be a finite number; zero and negative targets are permitted for metrics whose
units support them. Weight must be a finite number between 0 and 100 inclusive.
Send JSON numbers, not strings. Description is optional. Status defaults to active
and accepts active/inactive. Names, units and periods have a 200-character limit;
description has a 2000-character limit. Unknown fields are rejected.

Both GET endpoints accept `search` (literal case-insensitive name/description)
and `status=active|inactive`. They return all matching items, with at most 100
stored items per type, including inactive items. The scoring summary always
describes the whole framework, regardless of filters. KPI has no competency
category field; display its measurement unit and target instead.

Criteria are embedded in performanceFrameworks, with stable subdocument `_id`,
createdAt, and updatedAt. PATCH accepts any non-empty subset of create fields.
Send `{ "status": "inactive" }` to deactivate; no delete endpoint is provided.
The parent framework's generic PATCH does not accept competencies/kpis arrays.
No separate competencies or kpis collection is created.

## Scoring and edit safety

For this MVP, all active competencies and active KPIs share one 100% budget.
Inactive criteria are excluded. Example: two competencies weighted 30% and 20%,
plus a KPI weighted 50%, give totalWeight: 100 and weightsValid: true. At least
one active criterion is required. Fractional percentages are supported, with a
0.000001 percentage-point tolerance for floating-point arithmetic.

Draft frameworks may have incomplete or excessive totals while being configured.
New frameworks must start as draft (or archived); creating active without criteria
is rejected. Add criteria, inspect the scoring summary, then PATCH the framework
to active. Activation returns 400 unless weights are valid. Changes to an active
framework must preserve valid weights, including adds, edits and deactivations.
To rebalance multiple weights, change the framework to draft, make edits, and
activate again. Archived criteria are read-only until the framework returns to
draft. Existing active frameworks without valid criteria must be moved to draft
and completed; they are not automatically rewritten in the database.

Every framework or criterion edit compares the document version and increments
it atomically. A concurrent edit or activation returns 409 rather than silently
overwriting data or approving stale weights. Reload before retrying. This uses
single-document atomic updates and does not require multi-document transactions.
Use these APIs for writes; manually editing MongoDB bypasses these business rules.

Criteria validation and scoring failures return 400. Missing parent frameworks or
criteria return 404, and archived edits or concurrent-write conflicts return 409.
The test suite includes API authorization, stable IDs, search, deactivation,
combined totals, activation, and simulated concurrent changes. Verify embedded
validation and concurrent writes against a test MongoDB database before deployment.
