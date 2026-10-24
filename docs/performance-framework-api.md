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
kpiCount (active items only), totalWeight, weightsValid, saved ratingScale (null
before configuration), and scoringValidation (`ready` and `message`). Old frameworks
without arrays return empty arrays and zero counts. Counts and scoring summary
are read-only; use the criteria and scoring endpoints to configure the framework.

## Edit and archive

PATCH accepts any non-empty subset of create fields. Send `{ "status": "archived" }`
to archive, or `{ "status": "active" }` to activate. Status changes are allowed
in either direction, but activation now requires active competency and KPI weights
to total 100%, plus a valid rating scale, category weights, reviewer weights and
enabled reviewers. This does not certify that review templates are ready. No delete endpoint
is provided, preserving the parent record for future review templates/cycles.
Updating employment type selections validates them; a label/description-only edit
can preserve an existing selection whose employment type was later deactivated.
Activating a draft or archived framework rechecks the resulting employment-type
selection, even when the PATCH body contains only status. Replace inactive or
missing selections (or clear targeting with an empty array) before activation.

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
verification and frontend integration remain necessary. Review Templates are
available through the [template API](review-templates-api.md). Review cycles remain
a future milestone.

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
is rejected. Add criteria and scoring settings, inspect scoringValidation, then
PATCH the framework to active. Activation returns 400 unless scoring is ready. Changes to an active
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

## Rating scales and weightages

Frontend page: `/hr/performance-framework/scoring`. Select a framework, then use:

| Method and path | Response |
| --- | --- |
| GET /api/performance-frameworks/:id/scoring | `{ "scoring": { "frameworkId": "...", "version": 1, "ratingScale": { ... }, "categoryWeights": { ... }, "reviewerWeights": { ... }, "enabledReviewers": [...], "validation": { "ready": true, "message": null } } }` |
| PATCH /api/performance-frameworks/:id/scoring | Same shape as GET |
| POST /api/performance-frameworks/:id/scoring/preview | `{ "preview": { "frameworkId": "...", "version": 1, "criteria": [...], "totalEffectiveWeight": 100, "ratingScale": { ... }, "reviewerWeights": { ... }, "enabledReviewers": [...], "sample": null } }` |

Settings live within `performanceFrameworks`. Example save body (labels and
percentages are editable, not a universal default):

```json
{
  "ratingScale": {
    "min": 1,
    "max": 5,
    "levels": [
      { "value": 1, "label": "Needs Improvement" },
      { "value": 2, "label": "Developing" },
      { "value": 3, "label": "Meets Expectations" },
      { "value": 4, "label": "Exceeds Expectations" },
      { "value": 5, "label": "Outstanding" }
    ]
  },
  "categoryWeights": { "technical": 60, "behavioral": 40 },
  "reviewerWeights": { "self": 20, "peer": 20, "manager": 60 },
  "enabledReviewers": ["self", "peer", "manager"]
}
```

PATCH accepts one or more of these four settings. A supplied nested block replaces
that whole block. Null settings and unknown fields are rejected. Omitted blocks
are preserved. Framework create/edit endpoints do not accept scoring settings;
use the dedicated endpoint. Each supplied weights block must contain all its
keys, finite JSON numbers in [0, 100], totaling 100%. Drafts may have missing blocks,
but supplied blocks must be internally valid. GET reports incomplete configuration
as validation.ready: false rather than inventing defaults.

Scales are exactly 1–3, 1–4, or 1–5, with min 1 and one uniquely valued level for
every integer through max. Labels must be non-empty text up to 200 characters.
Levels are sorted by value. The API does not hard-code their meanings.

Enabled reviewers must be a non-empty unique subset of self, peer, tech_lead, manager.
Every enabled reviewer needs positive weight; disabled reviewers need zero weight.
To disable peer review, save both blocks together, for example:

```json
{
  "enabledReviewers": ["self", "manager"],
  "reviewerWeights": { "self": 20, "peer": 0, "manager": 80 }
}
```

There is no automatic redistribution. Archived scoring cannot be edited until the
framework is returned to draft. Active scoring edits must leave all settings and
criteria valid. Existing active frameworks without scoring should be returned to
draft and configured; they are not automatically changed in MongoDB.

### Team Lead Review

Use `tech_lead` as the Team Lead reviewer key in enabledReviewers, reviewerWeights
and preview reviewerRatings. The existing scoring endpoint is unchanged. Example:

```json
{
  "enabledReviewers": ["self", "tech_lead", "manager"],
  "reviewerWeights": { "self": 20, "peer": 0, "tech_lead": 30, "manager": 50 }
}
```

All four reviewer weights share the same 100% budget. Team Lead needs a positive
weight when enabled and zero when disabled. Send the complete reviewerWeights
block when changing the split. Older requests and snapshots that omit tech_lead
treat it as zero; existing saved snapshots are not rewritten and reviewer types
are not automatically enabled. Newly saved weight blocks include tech_lead.

Frontend should label this field Team Lead Review and submit the tech_lead key.
Preview expects its ratings only when enabled, using the same criterion-ID map
as other reviewers. Reviewer assignment/workflow execution is still a future
module; this change configures the weight, not which employee submits the review.

### How the weights interact

The Page 8 criterion weights retain one combined 100% budget. Let C be the sum of
active competency weights; the remaining share belongs to KPIs. Category weights
divide C between technical and behavioral competencies. Individual competency
weights determine their relative shares within their category:

```text
effective competency weight = C × category weight / 100
                              × item weight / category's active item-weight total
effective KPI weight = KPI's configured weight
reviewer score = sum(rating × effective criterion weight / 100)
final score = sum(reviewer score × reviewer weight / 100)
normalized percentage = (final score − scale min) / (scale max − scale min) × 100
```

Only active criteria participate. If a category has positive category weight and
C > 0, it must contain a positive-weight active competency. A zero-weight category
contributes nothing. For KPI-only frameworks, category settings are retained but
unused. Category and reviewer weights are separate layers and are not added to
the criterion-weight total. With technical item weights 30, behavioral 20, KPI 50,
and category weights 60/40, effective weights remain 30/20/50. Changing categories
to 80/20 makes effective weights 40/10/50. This explicit policy is scoring formula
version 1; changing it later requires a new formula version.

KPI targets/units are criteria metadata. This API does not convert target achievement
to a rating or execute reviews; the supplied reviewer ratings already use the
selected ordinal scale. No intermediate rounding is applied. The minimum scale
rating maps to 0%, the maximum to 100%; this is not rating/max normalization.

### Preview before saving

POST `{}` to preview saved configuration. POST `{ "configuration": { ... } }`
to preview proposed scoring blocks without saving them. The merged configuration
and existing criteria must be ready. Preview returns each criterion's ID, name,
type, original weight and effectiveWeight.

Optionally add reviewerRatings keyed by reviewer and then by criterion ID:

```json
{
  "reviewerRatings": {
    "self": { "<technicalId>": 4, "<behavioralId>": 3, "<kpiId>": 5 },
    "peer": { "<technicalId>": 4, "<behavioralId>": 3, "<kpiId>": 5 },
    "manager": { "<technicalId>": 4, "<behavioralId>": 3, "<kpiId>": 5 }
  }
}
```

Provide all enabled reviewers and all positive-effective-weight criteria. Unknown,
inactive or disabled IDs/roles and ratings outside the integer scale are rejected.
With effective weights 30/20/50, this sample returns score 4.3 and normalizedPercent
82.5, plus each reviewer's score. Frontend may format display decimals. Preview
never saves settings or review results.

## Published-cycle snapshots

| Method and path | Response |
| --- | --- |
| POST /api/performance-frameworks/:id/snapshots | Status 201; `{ "snapshot": { ... } }` |
| GET /api/performance-frameworks/:id/snapshots/:snapshotId | `{ "snapshot": { ... } }` |

POST accepts no body or `{}`. The framework must be active and scoring-ready.
The server captures the current configuration; request overrides are rejected.
Snapshots are stored in `performanceFrameworkSnapshots`, separately from editable
settings, with organizationId, frameworkId, sourceVersion, configuration, createdBy,
and createdAt. Configuration copies criteria (including targets, weights, labels,
statuses), rating scale, category/reviewer settings, targeting information, and
scoringFormulaVersion: 1. It contains detached values, not live document lookups.
The sourceVersion is the parent framework's shared __v, which increments on each
framework, criterion, or scoring edit. Repeating POST for the same source version
returns the existing snapshot, with a unique index preventing duplicate versions.
The API has no snapshot update or delete routes, and snapshot fields are immutable
in the model. Editing the live framework cannot alter a saved snapshot.

Review-cycle publication is not implemented yet. When built, it must store the
snapshot `_id` (and sourceVersion) on the published cycle and calculate scores from
snapshot.configuration using its scoringFormulaVersion, never from the live
framework. Reuse an existing snapshot ID when publishing the same configuration
version. Existing cycles are not migrated or protected automatically by this
endpoint alone. The [Review Templates API](review-templates-api.md) now pins a
framework configuration on activation and supplies template snapshots. Cycle
publication must integrate those snapshots; this module supplies the framework
snapshot contract.

All scoring/snapshot routes require HR/admin authentication and scope the parent
framework to the single company. Invalid config/sample ratings return 400, missing
records return 404, and archived edits, non-active snapshots or concurrent saves
return 409. Scoring saves participate in the same version check as criteria and
activation. Tests use mocked database operations; verify MongoDB validation,
snapshot indexes and concurrency against a test database before deployment.
