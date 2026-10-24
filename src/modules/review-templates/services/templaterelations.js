const Framework = require('../../performance-framework/models/performanceframework');
const EmploymentType = require('../../organization/models/employmenttype');
const Department = require('../../organization/models/department');
const { fail } = require('../../organization/services/validation');
const { requireScoringReady } = require('../../performance-framework/services/scoringvalidation');
const { effectiveCriteria } = require('../../performance-framework/services/scoringpreview');

async function resolveFramework(template) {
  const framework = await Framework.findOne({ _id: template.frameworkId, organizationId: template.organizationId }).lean();
  if (!framework) fail('Selected framework was not found in this organization', 404);
  return framework;
}

async function validateEmploymentTypes(template, framework) {
  const ids = template.employmentTypeIds || [];
  const applicable = (framework.applicableEmploymentTypeIds || []).map(String);
  if (applicable.length && ids.some((id) => !applicable.includes(String(id)))) fail('Template employment types must match the framework targeting');
  const effective = ids.length ? ids : applicable;
  if (effective.length && await EmploymentType.countDocuments({ _id: { $in: effective }, organizationId: template.organizationId, isActive: true }) !== effective.length) {
    fail('Employment types must exist, be active and belong to this organization');
  }
}

async function validateDepartments(template) {
  const ids = template.departmentIds || [];

  if (!ids.length) {
    return;
  }

  const count = await Department.countDocuments({
    _id: { $in: ids },
    organizationId: template.organizationId,
    status: 'active',
  });

  if (count !== ids.length) {
    fail('Departments must exist, be active and belong to this organization');
  }
}

function validateCriteria(template, framework) {
  for (const section of template.sections || []) {
    for (const [field, kind] of [['competencyIds', 'competencies'], ['kpiIds', 'kpis']]) {
      for (const id of section[field] || []) {
        if (!(framework[kind] || []).some((item) => String(item._id) === String(id) && (item.status || 'active') === 'active')) fail(`Selected ${kind} must be active and belong to the selected framework`);
      }
    }
  }
}

function requireTemplateReady(template, framework) {
  if (framework.status !== 'active') fail('Activate the selected framework before activating the template');
  requireScoringReady(framework);
  if (!template.sections?.length) fail('Add at least one section before activating the template');
  validateCriteria(template, framework);
  const selected = new Set();
  for (const section of template.sections) {
    if (!section.competencyIds?.length && !section.kpiIds?.length && !section.questions?.length && section.allowComments === false) fail('Each active template section needs criteria, questions or a comment field');
    for (const id of [...(section.competencyIds || []), ...(section.kpiIds || [])]) selected.add(String(id));
  }
  if (effectiveCriteria(framework).some((item) => item.effectiveWeight > 0 && !selected.has(item.criterionId))) fail('Include every positively weighted framework criterion before activating the template');
}

function frameworkForTemplate(template) {
  if (!template.frameworkSnapshot) return null;
  return { ...template.frameworkSnapshot, _id: template.frameworkId, organizationId: template.organizationId, __v: template.frameworkVersion, status: 'active' };
}

module.exports = {
  resolveFramework,
  validateEmploymentTypes,
  validateDepartments,
  validateCriteria,
  requireTemplateReady,
  frameworkForTemplate,
};
