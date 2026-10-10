# Organization management

This backend manages one company. All endpoints below require a login token in
`Authorization: Bearer <token>` and the `hr` or `admin` role.

## Company details

- `GET /api/organization` returns `{ "organization": null }` before setup, otherwise the company record.
- `PATCH /api/organization` creates the company on first use (name and code required), then updates only supplied fields. Returns `{ "organization": { ... } }`.
- `GET /api/organization/summary` returns `{ "summary": { "totalEmployees": 25, "departments": 3, "activeDepartments": 2, "teams": null, "activeReviewFrameworks": null } }`.

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
There is no delete-company endpoint. Teams and review frameworks are not implemented;
their summary values are `null` so the frontend can show an unavailable state.
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
The department must exist and be active. When an ID is supplied, it determines
the legacy `department` name even if that name is also supplied in the request.
Existing requests with just the string `department` continue to work.

`PATCH /api/employees/:id/department` accepts:

```json
{ "departmentId": "507f1f77bcf86cd799439011" }
```

Send `{ "departmentId": null }` to clear the assignment. The response is
`{ "employee": { ... } }`. Employee listing and this assignment response populate
`departmentId` with the department's `_id`, `name`, `code`, and `status`.
The old `department` string remains available for the current frontend. After a
department rename, use populated `departmentId.name` as the current display name;
the legacy string is not automatically rewritten for every employee.

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

Unknown write fields are rejected. Required name/code fields cannot be cleared.
Description is limited to 2000 characters, logo URL to 2048, other text to 200.

## Verification

Run `npm test`. Tests use mocked model operations and local HTTP requests;
they do not connect to MongoDB or send email. Before deployment, verify setup,
department creation, uniqueness indexes, assignment, and counts against a test
MongoDB database. Frontend pages, teams, employment-type management, hierarchy,
and configurable permissions are future milestones.
