# Organization management

This backend manages one company. All endpoints below require a login token in
`Authorization: Bearer <token>` and the `hr` or `admin` role.

## Company details

- `GET /api/organization` returns `{ "organization": null }` before setup, otherwise the company record.
- `PATCH /api/organization` creates the company on first use (name and code required), then updates only supplied fields. Returns `{ "organization": { ... } }`.
- `GET /api/organization/summary` returns `{ "summary": { "totalEmployees": 25, "departments": 3, "activeDepartments": 2, "teams": 4, "activeReviewFrameworks": 2 } }`.

Example setup body:

```json
{
  "name": "Example Company",
  "code": "EXAMPLE",
  "logoUrl": "https://example.com/logo.png",
  "industry": "Technology",
  "description": "Company description",
  "contactEmail": "hr@example.com",
  "country": "Sri Lanka",
  "timezone": "Asia/Colombo",
  "status": "active"
}
```

Codes are normalized to uppercase. Timezone must be recognized by the server's
Intl timezone implementation. Logo URLs must use HTTP or HTTPS; this API does not upload images.
There is no delete-company endpoint. Team counts come from stored team records.
Active review frameworks are counted from the `performanceFrameworks` collection.
Total employees includes all employee records, including pending onboarding.

## Departments

- `GET /api/departments?search=eng&status=active&page=1&limit=20`
- `POST /api/departments` returns status 201 and `{ "department": { ... } }`.
- `PATCH /api/departments/:id` returns `{ "department": { ... } }`.

Create body (name and code required):

```json
{
  "name": "Engineering",
  "code": "ENG",
  "description": "Product engineering",
  "headEmployeeId": null,
  "status": "active"
}
```

`headEmployeeId` is an existing employee ID, or null to clear the head. Use the
existing `GET /api/employees` endpoint for the employee selector. A department
head may belong to another department. Status defaults to active. Department
codes are unique across active and inactive records.
Set up the company first. The backend attaches its ID as `organizationId` to each
new department; clients must not supply that field. Creating a department before
company setup returns 409.

List response:

```json
{
  "departments": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Engineering",
      "code": "ENG",
      "status": "active",
      "headEmployeeId": null,
      "employeeCount": 18
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

When selected, `headEmployeeId` is populated with `_id`, `employeeNumber`,
`firstName`, `lastName`, and `workEmail`. Search matches name or code literally,
without treating input as a regular expression. Page starts at 1; limit is 1–100.
PATCH accepts any subset of create fields. Deactivating a department retains
existing employees and its head. There is no delete endpoint.

## Employee integration and existing records

New onboarding requests to `POST /api/employees` can include `departmentId`.
The department must exist and be active. Employee records store only the
`departmentId` reference; clients should use the populated department name for
display.

`PATCH /api/employees/:id/department` accepts:

```json
{ "departmentId": "507f1f77bcf86cd799439011" }
```

Send `{ "departmentId": null }` to clear the assignment. The response is
`{ "employee": { ... } }`. Employee listing and this assignment response populate
`departmentId` with the department's `_id`, `name`, `code`, and `status`.
After a department rename, use populated `departmentId.name` as the current
display name.

Existing string assignments are not automatically migrated or guessed. Create
the matching departments, inspect employees, then explicitly assign each employee
using the PATCH endpoint. Department counts include only linked `departmentId`
assignments, including employees whose onboarding is pending. Check this mapping
before using counts in production.

## Frontend pages

Use `/api/organization` and `/api/organization/summary` for `/hr/organization`.
Use `/api/departments` for `/hr/organization/departments`. For onboarding options,
request active departments; follow pagination if there are more than 100.
Keep these API contracts in sync with the separate frontend repository.

## Errors and validation

Errors use `{ "success": false, "message": "..." }` for these service operations.
Authentication middleware uses `{ "message": "..." }`.

- 400: invalid fields, IDs, empty updates, or an inactive assignment target.
- 401: missing or invalid login token.
- 403: role other than HR/admin.
- 404: unknown department or employee.
- 409: duplicate department code (or concurrent initial company creation).

## Collection relationships

The single company is stored in `organizations`. Departments, teams,
employment types, and role definitions all require an `organizationId` reference.

| Collection | Fields in addition to organizationId and timestamps |
| --- | --- |
| `departments` | name, code, description, headEmployeeId, status |
| `teams` | name, code, departmentId, teamLeadEmployeeId, description, status |
| `employmentTypes` | name, code, description, isActive |
| `roleDefinitions` | code, label, permissions, isSystemRole, isActive |

Team, employment-type, and role-definition models are available, with unique
codes per organization. Team management endpoints are available as described below.
Employment-type management endpoints are available as described below. Role-definition
management endpoints and employee team integration are not yet implemented.
Role definitions currently store permission strings; login
and route authorization still enforce the existing fixed user roles. `MANAGER`
and the label `HOD` do not automatically become login roles. Permission strings
must use dot-separated identifiers and cannot contain duplicates. Referential
existence and matching organization for team writes are enforced by the team
service; Mongoose references alone do not enforce those rules.

If departments were created before organizationId was added, set up the company
and run `npm run departments:link` to preview the missing links. Then run
`npm run departments:link -- --apply` to save them. The script only fills missing
or null organization links and can be rerun. Back up the database before applying
the migration. This migration does not change employee assignments.

Unknown write fields are rejected. Required name/code fields cannot be cleared.
Description is limited to 2000 characters, logo URL to 2048, other text to 200.

## Verification

Run `npm test`. Tests use mocked model operations and local HTTP requests;
they do not connect to MongoDB or send email. Before deployment, verify setup,
department creation, uniqueness indexes, assignment, and counts against a test
MongoDB database. Frontend pages, employee team membership, and configurable
permissions are future milestones.

## Reporting hierarchy

- `GET /api/hierarchy?search=priya` (also `GET /api/organization/hierarchy`) returns
  `{ "organizationId": "...", "employees": [...], "rootEmployeeIds": [...], "total": 25 }`.
  With no search, the full employee graph is returned for the chart. Search matches
  full name, employee number, or job title as literal, case-insensitive text. Roots
  and total describe the full organization even when search filters employees.
- `PATCH /api/employees/:id/manager` (also `/api/hierarchy/:id/manager`) accepts
  `{ "managerId": "<employee id>" }`, or `{ "managerId": null }` to clear it, and
  returns `{ "employee": { ... } }`. Only HR/admin may read or change hierarchy.

Relationships live in `employees.managerId`, referencing another Employee. No
separate hierarchy collection is used. Nodes include employeeNumber, firstName,
lastName, jobTitle, departmentId, teamId, and managerId.
Department and team are populated with name/code/status; manager is populated
with firstName/lastName/employeeNumber/jobTitle. Use managerId._id to draw edges.
The frontend owns organization chart rendering and manager selection.

Assignments reject self-reporting, direct and indirect cycles, existing cyclic
manager chains, missing employees, and explicit foreign organization links. New
onboarding records automatically receive the configured company ID. For this
single-company application, existing employees with missing/null organizationId
are treated as belonging to the company. An assignment fills organizationId on
the employee and selected manager if missing. Explicit other-company IDs are
never accepted. Manager assignment uses `managerId` directly; manager names come
from the populated employee reference.

Manager updates use MongoDB transactions and a shared organization write to
serialize concurrent hierarchy edits, preventing simultaneous requests from
creating cycles. This requires MongoDB Atlas or another replica set/sharded
deployment with transaction support; a standalone MongoDB server cannot perform
these writes. No in-memory locking is used. Test concurrent reciprocal assignments
against a test replica set before deployment; unit tests mock transactions.
Organization setup is required (409 otherwise), missing employees return 404,
invalid/circular/cross-organization assignments return 400, and a broken ancestor
chain with a missing employee returns 409.

The optional employee teamId reference is now available for display, but team
membership assignment is not implemented here. Hierarchy is based on reporting
relationships, not inferred from department heads, team leads, or access roles.

## Employment types

- `GET /api/employment-types?search=intern&status=active&page=1&limit=20`
  returns `{ "employmentTypes": [...], "pagination": { ... } }`.
  `isActive=true` or `isActive=false` is also supported as a filter.
- `POST /api/employment-types` creates a classification, returning status 201 and
  `{ "employmentType": { ... } }`.
- `PATCH /api/employment-types/:id` updates supplied fields, returning
  `{ "employmentType": { ... } }`.
- `POST /api/employment-types/defaults` initializes Intern (`INTERN`), Probationary
  (`PROBATION`), and Permanent (`PERMANENT`) and returns `{ "employmentTypes": [...] }`.
  Call this explicitly after organization setup. It inserts only missing codes and
  preserves existing labels and inactive statuses. GET never seeds data.

Create example:

```json
{
  "name": "Intern",
  "code": "INTERN",
  "description": "Employees on an internship",
  "isActive": true
}
```

Name and code are required; isActive defaults to true and must be a JSON boolean.
Create and update also accept `status: "active"` or `status: "inactive"` from
frontend forms. This is converted to isActive before saving. If both fields are
provided, they must agree. Responses and database records continue to use isActive.
The organization ID is attached automatically. Codes are normalized to uppercase
and unique within the company. Deactivation preserves employee references but
rejects new assignments. These endpoints require HR/admin access and company setup.
They use the same pagination, literal search, and error conventions as Teams.

`POST /api/employees` accepts `employmentTypeId`. `PATCH /api/employees/:id/employment-type` accepts only
`{ "employmentTypeId": "<id>" }` and assigns an existing active classification.
Employee listing and assignment responses populate that reference with name,
code, and isActive. Existing employees are not automatically migrated; use this
PATCH endpoint after reviewing their classifications. Renaming labels preserves
IDs; display the populated name. Employee records store only the
`employmentTypeId` reference.

Workflow execution, default workflow selection, and optional review cycle types
are deferred until those modules exist. There are no hard-coded review policies.
The frontend `/hr/organization/employment-types` should call `/api/employment-types`.

## Teams

- `GET /api/teams?search=frontend&status=active&departmentId=<id>&page=1&limit=20`
  returns `{ "teams": [...], "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }`.
- `POST /api/teams` returns status 201 and `{ "team": { ... } }`.
- `PATCH /api/teams/:id` returns `{ "team": { ... } }`.

Example create body:

```json
{
  "name": "Frontend Team",
  "code": "ENG-FE",
  "departmentId": "507f1f77bcf86cd799439011",
  "teamLeadEmployeeId": null,
  "description": "Frontend application development",
  "status": "active"
}
```

Name, code, and departmentId are required on create. The company ID is attached
by the backend. Department must belong to the company and be active when creating,
moving, or reactivating a team. Backfill missing department organization links with
the migration above before using those departments. Team lead must be an existing
employee, or null; they may belong to another department. Codes are uppercase and
unique within the organization. PATCH accepts any subset of create fields.

Responses populate `departmentId` with `_id`, `name`, `code`, and `status`, and
`teamLeadEmployeeId` with `_id`, `employeeNumber`, `firstName`, `lastName`, and
`workEmail`. Search, pagination, role restrictions, and error formats follow the
department API conventions. Unknown teams/leads/departments return 404, invalid
relationships return 400, and missing company setup or duplicate codes return 409.

Deactivation keeps the team and its relationships. Existing teams remain editable
when their department becomes inactive, but cannot be moved into an inactive
department or reactivated under one. This API does not assign employee members;
there is no employee teamId field or member count yet. Use these endpoints for
the frontend `/hr/organization/teams` page.
