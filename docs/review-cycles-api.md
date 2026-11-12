# Admin approval and HR department-manager cycles

This stage implements HR-created draft review cycles for department managers only.
Department-manager forms for tech leads and tech-lead forms for employees remain
for later stages. All endpoints require a Bearer login token.

## Template approval

1. HR configures framework/scoring and creates a department_manager template.
2. HR activates the validated template using the existing PATCH endpoint.
3. HR calls POST /api/review-templates/:id/submit-approval with `{}` or an optional
   `{ "comment": "Ready for approval" }`.
4. Admin reviews GET /api/review-templates?approvalStatus=pending and the preview.
5. Admin calls POST /api/review-templates/:id/approve or /:id/reject with an optional
   comment. Only an active, approved template can be used in a cycle.

Submission checks an active HR account. Approval/rejection checks an active admin
account and rejects self-approval. Every template edit clears approval, including
metadata changes, so HR must resubmit the saved revision. Version checks prevent
approving a concurrently changed template. Old active templates are not approved
automatically. Active means configuration-ready, not approved/published for use.

Approval states are not_submitted, pending, approved and rejected. Generic writes
cannot supply approval fields. Preview includes approvalStatus and
availableForReviewCycles. Current template authoring permissions remain HR/admin;
only HR submits and only admin approves. Only HR creates cycles.

## Create a cycle

POST /api/review-cycles — HR only, returns status 201 and `{ "cycle": { ... } }`.

```json
{
  "name": "Department Managers Annual Review",
  "templateId": "<approved template ID>",
  "departmentIds": ["<department ID>"],
  "employeeIds": ["<department manager employee ID>"],
  "startDate": "2026-11-01",
  "endDate": "2026-12-01"
}
```

Name, templateId, employeeIds and dates are required. ID arrays allow at most 500
unique MongoDB IDs; employeeIds cannot be empty. Use employee IDs, not user IDs.
The existing GET /api/employees supplies a candidate selector; offer only employees
with an active department_manager user account. The backend independently checks
the role/status, company, departments, employment types and framework job titles.

Department selections must be active and remain within template restrictions.
Omitted or empty departmentIds inherit template targeting; an empty template
selection is unrestricted by department. Legacy null employee organization links
follow the existing single-company convention; explicit foreign links are rejected.
Dates accept YYYY-MM-DD (UTC midnight) or ISO timestamps with a timezone; endDate
must be after startDate. The server sets targetRole department_manager, status draft,
and createdBy. Clients cannot supply those fields, approval or snapshot overrides.

Drafts reference the live template. templateSnapshotId and templateVersion are
nullable and are not captured during draft creation or editing. Publication is a
future endpoint and must revalidate eligibility and approval, then atomically pin
the template/framework snapshots before changing status. Execution must use those
snapshots. Draft creation does not start reviews or send notifications.

## Reopen and edit a draft

GET /api/review-cycles/:id returns all editable fields and __v. HR can then call
PATCH /api/review-cycles/:id with the returned __v as version and one or more
editable fields. Arrays replace the previous selection in full.

```json
{
  "version": 0,
  "name": "Updated Annual Review",
  "employeeIds": ["<department manager employee ID>"],
  "endDate": "2026-12-15"
}
```

Editable fields: name, templateId, departmentIds, employeeIds, startDate, endDate.
The same validation as creation applies to the complete resulting draft, including
unchanged selections. Changing template may require replacing departments and
employees in the same request. Empty departmentIds inherit the new template's
targeting. Only active HR can edit. Non-drafts, stale versions and simultaneous
writes return 409; invalid or missing version returns 400. The response is
`{ "cycle": { ... } }` with an incremented __v. Reload after a conflict.

The database model stores organizationId, name, templateId, targetRole,
departmentIds, employeeIds, startDate, endDate, status, createdBy, timestamps and
__v, with nullable templateSnapshotId/templateVersion reserved for publication.
Legacy draft snapshots are cleared on the next successful edit. Existing snapshots
are retained in their own collection. No data migration is required.

Reviewer assignments, publication, deadlines separate from the review period,
submission, scoring, normalisation and development plans are later milestones.
Current templates support department managers only; widening participants to other
roles requires extending template authoring and validation first. Existing employee
listing includes department, team and employment type for client-side selection;
the cycle API persists explicit employee IDs and validates eligibility server-side.

## Read cycles

- GET /api/review-cycles?page=1&limit=20 — HR/admin; cycles plus pagination.
- GET /api/review-cycles/:id — HR/admin; `{ "cycle": { ... } }`.

The MongoDB collection is reviewCycles. No existing data is migrated. Invalid
fields, dates or selections return 400; missing login 401; wrong roles 403;
missing records 404; unapproved templates or concurrent revisions 409.

Tests use mocked models and local HTTP requests. Verify persistence, snapshot
indexes and concurrent approval/edit behavior against a test Atlas database.
