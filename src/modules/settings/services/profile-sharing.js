const User = require('../../auth/models/usermodel');
const { findActiveUser } = require('./settingsservice');
const { companyFor } = require('./profile-corrections');
const { belongsToCompany } = require('../../organization/services/hierarchyservice');
const { fail } = require('./preferences');
const details = require('./profile-details');

async function read(authUser, id) {
  const viewer = await findActiveUser(authUser);
  if (!/^[a-f\d]{24}$/i.test(id)) fail('Invalid profile identifier');
  const company = await companyFor(viewer);
  const target = await User.findById(id).select('employee status profileDetails')
    .populate({ path: 'employee', select: 'firstName lastName jobTitle organizationId managerId' }).lean();
  if (!target || target.status !== 'active' || !target.employee || !belongsToCompany(target.employee, company._id)) fail('Profile was not found', 404);
  const stored = details.read(target.profileDetails);
  const result = { photo: stored.photo, bio: stored.bio, skills: stored.skills, links: stored.links };
  const self = String(viewer._id) === String(target._id);
  const assignedManager = viewer.employee && String(viewer.employee._id) === String(target.employee.managerId);
  if (self || stored.careerVisibility === 'manager_hr' && (['hr', 'admin'].includes(viewer.role) || assignedManager)) {
    result.careerInterests = stored.careerInterests;
    result.careerVisibility = stored.careerVisibility;
  }
  return { id: String(target._id), name: `${target.employee.firstName} ${target.employee.lastName}`.trim(), jobTitle: target.employee.jobTitle || '', details: result };
}
module.exports = { read };
