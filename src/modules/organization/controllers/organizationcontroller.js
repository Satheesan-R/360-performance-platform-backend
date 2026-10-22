const organizationService = require('../services/organizationservice');
const departmentService = require('../services/departmentservice');
const teamService = require('../services/teamservice');
const employmentTypeService = require('../services/employmenttypeservice');
const hierarchyService = require('../services/hierarchyservice');

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
  employmentTypes: handle((req) => employmentTypeService.listEmploymentTypes(req.query)),
  createEmploymentType: handle((req) => employmentTypeService.createEmploymentType(req.body), 'employmentType', 201),
  updateEmploymentType: handle((req) => employmentTypeService.updateEmploymentType(req.params.id, req.body), 'employmentType'),
  initializeEmploymentTypes: handle(() => employmentTypeService.initializeDefaults(), 'employmentTypes'),
  assignEmploymentType: handle((req) => employmentTypeService.assignEmploymentType(req.params.id, req.body), 'employee'),
  hierarchy: handle((req) => hierarchyService.listHierarchy(req.query)),
  assignManager: handle((req) => hierarchyService.assignManager(req.params.id, req.body), 'employee'),
};
