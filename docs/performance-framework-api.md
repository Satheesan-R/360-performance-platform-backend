# Performance Framework Overview

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

Responses also contain competencyCount: 0, kpiCount: 0, and ratingScale: null.
There is no attached competency, KPI, or scoring configuration yet. The next
milestones will replace these initial counts with computed values and connect
the rating scale. Show an unset rating scale in the frontend rather than inventing
a default. Counts and rating scale are read-only in this milestone.

## Edit and archive

PATCH accepts any non-empty subset of create fields. Send `{ "status": "archived" }`
to archive, or `{ "status": "active" }` to activate. This MVP permits status changes
in either direction; an active status currently marks administrative intent and
does not certify that scoring or review templates are ready. No delete endpoint
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
verification and frontend integration remain necessary. Competencies/KPIs,
rating scales/weightages, review templates, and review cycles are future milestones.
