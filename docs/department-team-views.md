# Department → team → employee views

These APIs support the separate frontend repository. No frontend application or
mock company records are created in this backend repository. All endpoints require
a Bearer login token and the HR/admin role.

## Frontend navigation

```text
Organization → Departments
  View Engineering → /hr/organization/departments/<departmentId>
    Overview | Teams | Employees | Hierarchy
      View Frontend Team → /hr/organization/teams/<teamId>
        Team details | Employees
```

The department table should show Department, Head, Teams, Employees, Status,
and Actions. Use View, Edit and Deactivate actions. The team table should show
Team, Department, Team Lead, Employees, Status and View/Edit actions. Use separate
empty states for no departments, no teams and no employees. Show the selected
department/team name in the page header and keep search/filter controls above
the tables. Breadcrumbs should link back to the parent department.

The backend supplies relationships and counts; the frontend implements layout,
tabs, dialogs, responsive spacing, loading states and error messages.

## Endpoints

| Method and path | Purpose / response |
| --- | --- |
| GET /api/departments | Paginated department list; rows include employeeCount and teamCount |
| GET /api/departments/summary | `{ "summary": { "total": 4, "active": 3, "inactive": 1 } }` |
| GET /api/departments/:id | `{ "department": { ...details, "employeeCount": 42, "teamCount": 2 } }` |
| GET /api/departments/:id/teams | `{ "teams": [...], "pagination": { ... } }` |
| GET /api/departments/:id/employees | `{ "employees": [...], "pagination": { ... } }` |
| GET /api/departments/:id/hierarchy | Full department/teams/employees tree, described below |
| PATCH /api/departments/:id | Edit permitted department fields |
| DELETE /api/departments/:id | Deactivate without removing the record; `{ "department": { ... } }` |
| GET /api/teams/:id | `{ "team": { ...details, "employeeCount": 8 } }` |
| GET /api/teams/:id/employees | `{ "employees": [...], "pagination": { ... } }` |
| PATCH /api/teams/:id | Edit team details, status, department or lead |
| PATCH /api/employees/:id/team | Assign or remove a team |
| PATCH /api/employees/:id/department | Change department; clears incompatible team membership |

Use POST /api/departments and POST /api/teams for creation. Existing request fields
remain unchanged. Department writes now also accept departmentHeadId as an alias
for headEmployeeId; if both are present they must agree. Responses use the
canonical headEmployeeId field. Null clears the head assignment.

GET department teams accepts search, status, page and limit. GET department/team
employee lists accept search, page (default 1) and limit (default 20, maximum 100).
Employee search matches first name, last name, employee number, work email or job
title as case-insensitive literal text. Follow pagination for the Employees tabs.
The department summary counts all departments regardless of current table filters.

## Hierarchy response

```json
{
  "department": {
    "_id": "<departmentId>",
    "name": "Engineering",
    "code": "ENG",
    "headEmployeeId": {
      "_id": "<headEmployeeId>",
      "firstName": "Kamal",
      "lastName": "Example"
    }
  },
  "teams": [
    {
      "_id": "<teamId>",
      "name": "Frontend Team",
      "status": "active",
      "teamLeadEmployeeId": null,
      "employeeCount": 1,
      "employees": [
        {
          "_id": "<employeeId>",
          "employeeNumber": "EMP-001",
          "firstName": "Example",
          "lastName": "Employee",
          "jobTitle": "Software Engineer",
          "teamId": { "_id": "<teamId>", "name": "Frontend Team" },
          "managerId": null
        }
      ]
    }
  ],
  "unassignedEmployees": [],
  "summary": {
    "teamCount": 1,
    "employeeCount": 1,
    "unassignedEmployeeCount": 0
  }
}
```

Names above are documentation examples only. The hierarchy endpoint returns real
database records. It includes inactive teams and empty teams so existing structure
does not disappear. Teams are sorted by name, employees by first/last name. Every
employee assigned to the department appears exactly once in a team branch or the
separate Employees without a team group. A department head or team lead is not
automatically counted as a team member; assignment is separate.

An unassigned employee has unassignedReason: no-team or team-not-in-department.
The latter highlights a stale/invalid team reference instead of hiding that
employee. The hierarchy is a full department graph without pagination; use the
paginated employee endpoints for large tables. Very large departments may need
future incremental hierarchy loading.

Employees expose directory fields only: employee number, name, work email, job
title, department/team/manager links, onboarding status, and populated user
role/status. Personal email, address, date of birth, phone and credentials are
not selected. Manager/team/user references are populated for display. Department
details populate the head; team details populate its department and lead.

Counts include all assigned employee records, including pending onboarding and
disabled user accounts. Team counts require both teamId and departmentId to match;
invalid cross-department references do not inflate team counts. Department counts
also include employees without teams.

## Assign employees from the team page

Use the department Employees endpoint as the candidate selector. Send one selected
employee at a time:

```http
PATCH /api/employees/<employeeId>/team
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{ "teamId": "<teamId>" }
```

Send `{ "teamId": null }` to remove membership without changing the department.
The response is `{ "employee": { ... } }`, with populated departmentId and teamId.
The employee must already belong to that team's department. Both team and parent
department must be active and belong to the configured company. Explicit foreign
employee organization links are rejected. Legacy employees with missing/null
organizationId are accepted for this single-company application; the link is
filled when assigned.

To move someone between departments, PATCH their department first. This clears
their old team. Then PATCH teamId to the new department's team. Saving the same
department preserves membership; clearing the department also clears membership.
These operations do not change managerId. Department heads, team leads and
reporting managers are independent relationships.

Team moves are rejected with 409 while any employees reference that team. Reassign
or remove members first, move the team, then assign employees in the destination
department. This avoids silently moving employees or creating inconsistent links.
New onboarding requests still assign the department only; use the membership
endpoint after employee creation to select a team.

Team edits and department/team assignment routes use MongoDB transactions and a
shared organization structureVersion write to serialize competing team moves and
assignments. MongoDB Atlas or another transaction-capable replica set/sharded
deployment is required. A standalone MongoDB server cannot perform these writes.

## View, edit and delete behavior

View opens the detail page and calls the read endpoints above. Edit uses the
existing PATCH forms; refresh the table/detail counts after successful writes.
Department DELETE is deliberately non-destructive: it sets status to inactive,
retains the department head, teams and employee assignments, and returns the
department. Repeated requests are safe. Label the UI action Deactivate and use a
confirmation dialog explaining that existing relationships remain. Reactivate
through PATCH with status active. There is no permanent delete operation.

Inactivated departments remain visible in read views and can retain active teams,
but new team memberships are blocked while the parent department is inactive.
Read views scope parent records to the configured organization. Older departments
without organizationId need the existing departments:link migration before their
detail views can be opened.

This change does not implement parent departments, effective dates, department
contact/location/cost-centre fields, head-authority policy, approval workflows or
assignment audit history. Do not display a working History or Approvals tab until
those APIs exist. Deactivation preserves current relationships but is not a
historical change log. Existing validation checks head/lead employee existence;
role-based eligibility for those assignments remains separate future work.

## Errors and verification

400 indicates invalid IDs/fields or an incompatible/inactive assignment target.
401/403 indicate authentication/authorization errors. Missing parent/employee/team
records return 404. Missing company setup and moves of populated teams return 409.
Service errors use `{ "success": false, "message": "..." }`.

Run npm test. Tests use mocked model operations and local HTTP calls; they do not
change the real database. Validate transactions, population, membership moves,
counts and the separate frontend integration against a test Atlas database before
deployment. No sample company data is inserted by this change.
