const organizationService = require('../services/organizationservice');
const departmentService = require('../services/departmentservice');
const teamService = require('../services/teamservice');

const handle = (operation, key, status = 200) => async (req, res, next) => {
  try {
    const result = await operation(req);
    res.status(status).json(key ? { [key]: result } : result);
  } catch (error) { next(error); }
};

module.exports = {
  overview: handle(() => organizationService.getOrganization(), 'organization'),
  update: handle((req) => organizationService.updateOrganization(req.body), 'organization'),
  summary: handle(() => organizationService.getSummary(), 'summary'),
  departments: handle((req) => departmentService.listDepartments(req.query)),
  createDepartment: handle((req) => departmentService.createDepartment(req.body), 'department', 201),
  updateDepartment: handle((req) => departmentService.updateDepartment(req.params.id, req.body), 'department'),
  assignDepartment: handle((req) => departmentService.assignDepartment(req.params.id, req.body), 'employee'),
  teams: handle((req) => teamService.listTeams(req.query)),
  createTeam: handle((req) => teamService.createTeam(req.body), 'team', 201),
  updateTeam: handle((req) => teamService.updateTeam(req.params.id, req.body), 'team'),
};
