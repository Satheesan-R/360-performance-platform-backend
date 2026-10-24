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

The cycle stores templateSnapshotId and templateVersion, copying approved prompts,
evidence rules, targeting and pinned framework scoring. Approval/version are checked
again after snapshot capture. If the template changed, creation fails with 409.
Later template edits cannot change saved snapshot values. Future execution must
use the snapshot rather than live configuration.

There is no cycle publishing, scheduling, notification, reviewer assignment,
response submission, score persistence or cycle editing in this stage. Creating
a draft does not start reviews or send email. There are no participant-facing
cycle endpoints yet.

## Read cycles

- GET /api/review-cycles?page=1&limit=20 — HR/admin; cycles plus pagination.
- GET /api/review-cycles/:id — HR/admin; `{ "cycle": { ... } }`.

The MongoDB collection is reviewCycles. No existing data is migrated. Invalid
fields, dates or selections return 400; missing login 401; wrong roles 403;
missing records 404; unapproved templates or concurrent revisions 409.

Tests use mocked models and local HTTP requests. Verify persistence, snapshot
indexes and concurrent approval/edit behavior against a test Atlas database.
