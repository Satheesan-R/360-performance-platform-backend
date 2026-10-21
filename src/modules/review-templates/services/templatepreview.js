const { getTemplate } = require('./templateservice');
const { parseTemplate, validateEmbeddedIds } = require('./templatevalidation');
const { resolveFramework, frameworkForTemplate, requireTemplateReady } = require('./templaterelations');
const { effectiveCriteria } = require('../../performance-framework/services/scoringpreview');
const { fail } = require('../../organization/services/validation');

async function renderPreview(template) {
  const framework = frameworkForTemplate(template) || await resolveFramework(template);
  let validation = { ready: true, message: null };
  try { requireTemplateReady(template, framework); }
  catch (error) { if (error.statusCode !== 400) throw error; validation = { ready: false, message: error.message }; }
  const resolve = (ids, items) => (ids || []).map((id) => (items || []).find((item) => String(item._id) === String(id)) || { _id: id, missing: true });
  return {
    templateId: template._id, name: template.name, description: template.description || '', status: template.status,
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
  return renderPreview(candidate);
}

module.exports = { previewTemplate, renderPreview };
