const Template = require('../models/reviewtemplate');
const User = require('../../auth/models/usermodel');
const { getTemplate } = require('./templateservice');
const { frameworkForTemplate, requireTemplateReady, validateDepartments, validateEmploymentTypes } = require('./templaterelations');
const { fail, objectId } = require('../../organization/services/validation');

async function actor(userId, role) {
  objectId(userId, 'userId');

  if (!await User.exists({ _id: userId, status: 'active', role })) {
    fail(`An active ${role} account is required`, 403);
  }
}

function comment(body) {
  if (body === undefined) return '';
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'comment')) {
    fail('Provide only an optional comment');
  }
  if (body.comment === undefined) return '';
  if (typeof body.comment !== 'string' || body.comment.trim().length > 1000) fail('comment must be text up to 1000 characters');
  return body.comment.trim();
}

async function ready(template) {
  const framework = frameworkForTemplate(template);
  if (template.status !== 'active' || !framework) fail('Activate and validate the template before submitting it for approval', 409);
  requireTemplateReady(template, framework);
  await validateDepartments(template);
  await validateEmploymentTypes(template, framework);
  if (template.targetRole !== 'department_manager') fail('This workflow requires a department-manager template');
}

async function save(template, data) {
  const updated = await Template.findOneAndUpdate({
    _id: template._id,
    organizationId: template.organizationId,
    __v: template.__v === undefined ? { $exists: false } : template.__v,
  }, { $set: data, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();

  if (!updated) fail('Template changed while processing approval. Reload and try again', 409);
  return updated;
}

async function submit(id, userId, body) {
  const note = comment(body);
  await actor(userId, 'hr');
  const template = await getTemplate(id);
  await ready(template);
  if (['pending', 'approved'].includes(template.approvalStatus)) fail('Template is already pending or approved', 409);
  return save(template, {
    approvalStatus: 'pending', submittedBy: userId, submittedAt: new Date(),
    approvedBy: null, approvedAt: null, approvalComment: note,
  });
}

async function decide(id, userId, approved, body) {
  const note = comment(body);
  await actor(userId, 'admin');
  const template = await getTemplate(id);
  if (template.approvalStatus !== 'pending') fail('Only pending templates can be approved or rejected', 409);
  if (String(template.createdBy) === userId || String(template.submittedBy) === userId) fail('An admin cannot approve their own template submission', 403);
  if (approved) await ready(template);
  return save(template, {
    approvalStatus: approved ? 'approved' : 'rejected',
    approvedBy: approved ? userId : null,
    approvedAt: approved ? new Date() : null,
    approvalComment: note,
  });
}

module.exports = { submit, decide, ready };
