const Team = require('../models/team');
const Employee = require('../../auth/models/employee');
const {
  company,
  departmentRecord,
  employeeScope,
  employeeFields,
  employeeRelations,
} = require('./structurequeries');

function groupHierarchy(department, teams, employees) {
  const grouped = new Map(teams.map((team) => [String(team._id), { ...team, employees: [] }]));
  const unassignedEmployees = [];

  for (const employee of employees) {
    const teamId = employee.teamId?._id ?? employee.teamId;
    const team = teamId ? grouped.get(String(teamId)) : null;

    if (team) {
      team.employees.push(employee);
    } else {
      unassignedEmployees.push({
        ...employee,
        unassignedReason: teamId ? 'team-not-in-department' : 'no-team',
      });
    }
  }

  const branches = [...grouped.values()].map((team) => ({
    ...team,
    employeeCount: team.employees.length,
  }));

  return {
    department,
    teams: branches,
    unassignedEmployees,
    summary: {
      teamCount: teams.length,
      employeeCount: employees.length,
      unassignedEmployeeCount: unassignedEmployees.length,
    },
  };
}

async function departmentHierarchy(id) {
  const organization = await company();
  const department = await departmentRecord(id, organization._id);

  const [teams, employees] = await Promise.all([
    Team.find({ departmentId: department._id, organizationId: organization._id })
      .sort({ name: 1, _id: 1 })
      .populate('teamLeadEmployeeId', 'employeeNumber firstName lastName jobTitle workEmail')
      .lean(),
    Employee.find({ departmentId: department._id, ...employeeScope(organization._id) })
      .select(employeeFields)
      .sort({ firstName: 1, lastName: 1, _id: 1 })
      .populate(employeeRelations)
      .lean(),
  ]);

  return groupHierarchy(department, teams, employees);
}

module.exports = { departmentHierarchy, groupHierarchy };
