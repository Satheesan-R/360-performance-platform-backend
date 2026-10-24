const { getTemplate } = require('./templateservice');
const { parseTemplate, validateEmbeddedIds } = require('./templatevalidation');
const {
  resolveFramework,
  frameworkForTemplate,
  requireTemplateReady,
  validateEmploymentTypes,
  validateDepartments,
} = require('./templaterelations');
const { effectiveCriteria } = require('../../performance-framework/services/scoringpreview');
const { fail } = require('../../organization/services/validation');

async function renderPreview(template, checkEmploymentTypes = !template.frameworkSnapshot, checkDepartments = !template.frameworkSnapshot) {
  const framework = frameworkForTemplate(template) || await resolveFramework(template);
  let validation = { ready: true, message: null };
  try {
    if (checkEmploymentTypes) await validateEmploymentTypes(template, framework);
    if (checkDepartments) await validateDepartments(template);
    requireTemplateReady(template, framework);
  }
  catch (error) { if (error.statusCode !== 400) throw error; validation = { ready: false, message: error.message }; }
  const resolve = (ids, items) => (ids || []).map((id) => (items || []).find((item) => String(item._id) === String(id)) || { _id: id, missing: true });
  return {
    templateId: template._id, name: template.name, description: template.description || '', status: template.status,
    reviewType: template.reviewType ?? null,
    departmentIds: template.departmentIds || [],
    targetRole: template.targetRole ?? null,
    approvalStatus: template.approvalStatus ?? 'not_submitted',
    availableForReviewCycles: template.status === 'active' && template.approvalStatus === 'approved',
    frameworkId: template.frameworkId, frameworkName: framework.name,
    frameworkVersion: framework.__v ?? 0, usesFrozenFramework: Boolean(template.frameworkSnapshot),
    employmentTypeIds: template.employmentTypeIds || [],
    effectiveEmploymentTypeIds: template.employmentTypeIds?.length ? template.employmentTypeIds : framework.applicableEmploymentTypeIds || [],
    ratingScale: framework.ratingScale ?? null, validation,
    criteriaWeights: validation.ready ? effectiveCriteria(framework) : [],
    sections: (template.sections || []).map((section) => ({
      ...section, competencies: resolve(section.competencyIds, framework.competencies), kpis: resolve(section.kpiIds, framework.kpis),
      evidenceRequired: Boolean(template.evidenceRequired || section.evidenceRequired),
      allowComments: section.allowComments !== false, commentsRequired: Boolean(section.commentsRequired),
    })),
  };
}

async function previewTemplate(id, body) {
  const template = await getTemplate(id);
  if (body === undefined) return renderPreview(template);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Preview body must be an object');
  const data = Object.keys(body).length ? parseTemplate(body) : {};
  if (data.sections) validateEmbeddedIds(data.sections, template.sections);
  const candidate = { ...template, ...data };
  if (data.status === 'draft' || (data.frameworkId && String(data.frameworkId) !== String(template.frameworkId))) {
    candidate.frameworkSnapshot = null; candidate.frameworkVersion = null;
  }
  return renderPreview(
    candidate,
    !candidate.frameworkSnapshot || Object.hasOwn(data, 'employmentTypeIds') || Object.hasOwn(data, 'frameworkId'),
    !candidate.frameworkSnapshot || Object.hasOwn(data, 'departmentIds')
  );
}

module.exports = { previewTemplate, renderPreview };
