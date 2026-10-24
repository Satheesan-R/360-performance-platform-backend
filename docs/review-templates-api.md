# Review Templates

Backend for the separate frontend page `/hr/performance-framework/templates`.
Use the existing company setup, frameworks, criteria, and scoring configuration.
All endpoints require `Authorization: Bearer <token>` and the HR/admin role.

| Method and path | Response |
| --- | --- |
| GET /api/review-templates | `{ "templates": [...], "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 } }` |
| POST /api/review-templates | Status 201; `{ "template": { ... } }` |
| GET /api/review-templates/:id | `{ "template": { ... } }` |
| PATCH /api/review-templates/:id | `{ "template": { ... } }` |
| GET /api/review-templates/:id/preview | `{ "preview": { ... } }` |
| POST /api/review-templates/:id/preview | `{ "preview": { ... } }` |
| POST /api/review-templates/:id/snapshots | Status 201; `{ "snapshot": { ... } }` |
| GET /api/review-templates/:id/snapshots/:snapshotId | `{ "snapshot": { ... } }` |

## Create and edit

The current HR-only configuration stage defines review templates for department
managers. The intended later hierarchy is HR framework configuration → department
manager forms for tech leads → tech lead forms for employees. Those later authoring
levels are not enabled by this change. HR/admin routes remain protected as before.

New templates support these additional fields:

```json
{
  "reviewType": "annual",
  "departmentIds": ["<department id>"],
  "targetRole": "department_manager"
}
```

reviewType accepts annual, probation or internship (default annual on new records).
targetRole currently accepts only department_manager and defaults to it on new
records. It identifies the intended review subject's access role, not a job title
and not the person creating the template. HR/admin are still the authors.
departmentIds must reference existing active departments in this organization;
an empty array means no department restriction. Use GET /api/departments with an
active status filter for the selector. This is reusable targeting configuration,
not assignment of a particular manager or creation of a review cycle.

Selected departments are validated on creation, targeting changes and activation.
Draft/proposed-targeting previews report invalid selections through validation.
Metadata-only edits and unchanged pinned previews preserve prior configuration.
List supports departmentId (explicit selection) and reviewType filters and
populates departmentIds with name/code/status. Preview and template snapshots
include all three fields. Existing records and saved snapshots are not migrated
or rewritten; old records without the fields show null reviewType/targetRole in
preview until HR configures them. No manager/tech-lead write permission is added.

Example create body; replace placeholder IDs with real IDs from the selected framework:

```json
{
  "name": "Annual Performance Review",
  "description": "Questions and criteria for the annual review",
  "frameworkId": "<framework id>",
  "employmentTypeIds": [],
  "evidenceRequired": false,
  "sections": [
    {
      "title": "Technical Skills",
      "competencyIds": ["<technical competency id>"],
      "kpiIds": [],
      "required": true,
      "allowComments": true,
      "commentsRequired": false,
      "evidenceRequired": true
    },
    {
      "title": "Evaluation Results",
      "competencyIds": ["<behavioral competency id>"],
      "kpiIds": ["<KPI id>"],
      "required": true
    },
    {
      "title": "Employee Comments",
      "questions": [
        {
          "prompt": "What were your main achievements?",
          "required": true
        }
      ],
      "allowComments": true,
      "commentsRequired": false
    }
  ],
  "status": "draft"
}
```

The `reviewTemplates` collection stores these fields plus organizationId,
createdBy, timestamps, frameworkVersion, frameworkSnapshot and the version key.
The server supplies organizationId and createdBy from company setup and login.
Creation requires an existing active HR/admin account. Unknown write fields,
including client-supplied snapshot/version/creator fields, are rejected. Template
names are display labels, not unique keys. No templates are seeded automatically.

Name and frameworkId are required. Description is optional. Status defaults to
draft and accepts draft, active, archived. Name and section titles are limited
to 200 characters, description and question prompts to 2000. Each template may
contain at most 50 sections and 200 questions total (20 per section), plus the
backend's overall 20 KB JSON request limit. Each reference array allows at most
100 unique IDs. A competency/KPI can appear in only one section.

The framework must belong to this company. Selected criteria must be active,
embedded items from that framework. Employment types must exist, be active and
belong to the company. When the framework restricts employment types, the template
selection must be a subset. An empty template employmentTypeIds array inherits
the framework targeting; if both are empty, no type restriction is configured.
Employee eligibility and review routing are not executed by this module.

For selectors, use `GET /api/performance-frameworks`, its competencies/kpis
endpoints, and `GET /api/employment-types?status=active`. Follow pagination on
framework and employment-type lists. Do not send populated objects as IDs.

PATCH accepts any non-empty subset of create fields. Supplying sections replaces
the whole section array; send all sections to retain. Preserve `_id` on existing
sections and questions to retain identity, and omit it for new ones. IDs must
belong to this template and question IDs must belong to their section. Create
does not accept client-assigned section/question IDs. Criteria arrays reference
existing framework subdocument IDs, not standalone collection records.

## Comments, questions, and evidence

Questions are free-text prompts with a boolean required flag. A question's prompt
is required even in a draft. Sections default to required: false,
allowComments: true, commentsRequired: false and evidenceRequired: false.
commentsRequired cannot be true when allowComments is false. All booleans must
be JSON booleans. The template-level evidenceRequired also defaults to false.
Preview combines global and section evidence settings with OR: global true
makes evidence required in every section.

Section required indicates that the section must be completed. Required questions
and comments constrain answers within a completed section; an optional section
may be skipped by the future response module. Evidence settings are captured as
configuration only. Actual answer validation, file upload, evidence storage,
review submission, and workflow execution are not implemented here. They must
enforce these flags when review responses are built.

## Activation and framework versions

Drafts may have no sections or an incomplete selection. To activate, send
`{ "status": "active" }`. The framework must be active and scoring-ready,
at least one section must exist, and every section must provide criteria,
questions, or a comment field. All positively weighted effective framework
criteria must be included across the sections. This prevents omitting a scored
criterion while still applying the framework's original 100% scoring formula.
Zero-effective-weight criteria may be omitted. For a different scoring subset,
configure a separate framework rather than implicitly reweighting a template.

Activation copies the framework configuration into frameworkSnapshot and records
its shared frameworkVersion (__v). Active templates resolve criteria and ratings
against this frozen copy. Later changes to the live framework, including renames,
deactivation, or archiving, do not change that template's scoring preview.

Active templates can change names, prompts, comments/evidence requirements and
section organization, provided the pinned criteria still satisfy readiness.
Changing frameworkId requires the resulting template to be draft. Returning a
template to draft clears its pinned framework; drafts use the current live
framework. Reactivate to adopt a newer framework version. Archiving preserves
the pinned framework, and reactivating an archived template retains that version
unless it was first returned to draft. Archived section edits require draft.
No delete endpoint is provided.

Employment type selections are checked on creation, selection changes, framework
changes and activation. Metadata-only edits can preserve previously selected
types that were subsequently deactivated. Existing active templates remain
configuration records; future cycles must separately check eligible employees.

## Lists and preview

List accepts `search` (literal case-insensitive name/description), `status`,
`frameworkId`, `employmentTypeId`, `page` (default 1), and `limit` (default 20,
max 100). employmentTypeId filters explicit selections, not inherited targeting.
List populates frameworkId with `_id`, name and status, and employmentTypeIds
with `_id`, name, code and isActive. It omits the potentially large frameworkSnapshot.
Detail, create and edit responses use raw reference IDs; use detail to load the
edit form. List framework labels describe the live record; frozen names/labels
are available in preview.

GET preview resolves the saved template. POST accepts `{}` or proposed template
fields to preview merged changes without saving. Section replacement/ID rules
match PATCH. The frontend renders the returned preview; the backend does not
create HTML or a PDF.

Preview contains template name/description/status, frameworkId/frameworkName,
frameworkVersion, usesFrozenFramework, employmentTypeIds,
effectiveEmploymentTypeIds, ratingScale, validation (`ready`, `message`),
criteriaWeights and sections. Each section includes resolved competencies/kpis,
questions, comments flags and effective evidenceRequired. Missing criterion
references are returned with `{ "_id": "...", "missing": true }`. Incomplete
drafts return validation.ready: false rather than silently dropping criteria.
Readiness also checks current employment-type targeting for drafts and proposed
framework/type selection changes, including types inherited from the framework.
Unchanged active or archived previews preserve their pinned targeting without
rechecking current classification activity; proposing a targeting change checks
the current active classifications, matching the Save validation rules.
criteriaWeights is empty unless the template is ready. There are no submitted
answers, ratings, employee data or uploaded files in this preview.

## Published-cycle snapshots

POST snapshots accepts no body or `{}` and requires an active template with a
valid pinned framework. It copies the template's prompts, sections, targeting,
evidence settings and full pinned framework into `reviewTemplateSnapshots`, with
templateId, organizationId, sourceVersion, createdBy and createdAt. Fields are
immutable in the schema and there are no snapshot edit/delete APIs.

One snapshot is stored per template version via a unique index. Repeated creation
for the same version returns the existing snapshot. Live edits increment the
template's shared __v and cannot modify old snapshots. Framework snapshots and
template snapshots are separate contracts; the template snapshot includes the
exact framework configuration it uses, including scoringFormulaVersion.

HR-only draft cycle creation and admin template approval are available through
the [review-cycle API](review-cycles-api.md). Active status alone is insufficient:
the template must also be admin-approved. Review-cycle publication remains a
future module. It must persist a template
snapshot ID and use that snapshot's prompts, evidence rules and scoring data for
the whole cycle. Simply referencing the live template is insufficient. No cycles
or review responses are migrated by the template endpoints. Draft cycle records
are created through the separate review-cycle API.

## Errors and verification

Validation failures return 400; invalid/missing authentication returns 401;
unauthorized roles or unavailable creators return 403; missing templates,
frameworks or snapshots return 404. Missing company setup, archived section edits,
non-active snapshot creation and concurrent write conflicts return 409.
Errors use `{ "success": false, "message": "..." }` for service operations;
authentication middleware uses `{ "message": "..." }`.

Updates compare the template version and increment it atomically. Concurrent
changes return 409; reload before retrying. This is single-document concurrency
control. Activation captures a consistent framework document read at validation
time; it does not lock the live framework against later changes, because scoring
is pinned in the template. API writes preserve the version contract; direct
MongoDB edits can bypass business rules.

Run `npm test`. Tests cover nested validation, model casting, relationships,
activation, pinned scoring, preview, snapshots, access control and simulated
concurrency with mocked database operations. Live MongoDB index, query, concurrency
and frontend verification remain necessary before deployment.
