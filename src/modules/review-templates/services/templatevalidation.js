const { fail, objectId } = require('../../organization/services/validation');

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`Unknown ${label} fields: ${unknown.join(', ')}`);
}
function text(value, field, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`${field} must be ${required ? 'non-empty ' : ''}text up to ${max} characters`);
  return value.trim();
}
function boolean(value, field) {
  if (typeof value !== 'boolean') fail(`${field} must be true or false`);
  return value;
}
function ids(value, field) {
  if (!Array.isArray(value) || value.length > 100) fail(`${field} must be an array of at most 100 IDs`);
  const result = value.map((id) => objectId(id, field).toLowerCase());
  if (new Set(result).size !== result.length) fail(`${field} must not contain duplicates`);
  return result;
}

function sections(value) {
  if (!Array.isArray(value) || value.length > 50) fail('sections must be an array of at most 50 sections');
  let questionCount = 0;
  const seen = { competencyIds: new Set(), kpiIds: new Set(), sectionIds: new Set(), questionIds: new Set() };
  return value.map((section) => {
    object(section, ['_id', 'title', 'competencyIds', 'kpiIds', 'questions', 'required', 'allowComments', 'commentsRequired', 'evidenceRequired'], 'section');
    const result = { title: text(section.title, 'title', 200, true) };
    if (section._id !== undefined) {
      result._id = objectId(section._id, 'sectionId').toLowerCase();
      if (seen.sectionIds.has(result._id)) fail('Duplicate section ID');
      seen.sectionIds.add(result._id);
    }
    for (const key of ['competencyIds', 'kpiIds']) {
      result[key] = ids(section[key] ?? [], key);
      for (const id of result[key]) {
        if (seen[key].has(id)) fail('A criterion can appear in only one section');
        seen[key].add(id);
      }
    }
    for (const key of ['required', 'allowComments', 'commentsRequired', 'evidenceRequired']) {
      result[key] = section[key] === undefined ? key === 'allowComments' : boolean(section[key], key);
    }
    if (result.commentsRequired && !result.allowComments) fail('Required comments must be enabled');
    const questions = section.questions ?? [];
    if (!Array.isArray(questions) || questions.length > 20) fail('A section can contain at most 20 questions');
    questionCount += questions.length;
    if (questionCount > 200) fail('A template can contain at most 200 questions');
    result.questions = questions.map((question) => {
      object(question, ['_id', 'prompt', 'required'], 'question');
      const parsed = { prompt: text(question.prompt, 'prompt', 2000, true), required: question.required === undefined ? false : boolean(question.required, 'required') };
      if (question._id !== undefined) {
        parsed._id = objectId(question._id, 'questionId').toLowerCase();
        if (seen.questionIds.has(parsed._id)) fail('Duplicate question ID');
        seen.questionIds.add(parsed._id);
      }
      return parsed;
    });
    return result;
  });
}

function parseTemplate(body, create = false) {
  object(body, [
    'name',
    'description',
    'reviewType',
    'departmentIds',
    'targetRole',
    'frameworkId',
    'employmentTypeIds',
    'sections',
    'evidenceRequired',
    'status',
  ], 'template');
  if (!Object.keys(body).length) fail('At least one field is required');
  const data = {};
  if (create || Object.hasOwn(body, 'name')) data.name = text(body.name, 'name', 200, true);
  if (Object.hasOwn(body, 'description')) data.description = text(body.description, 'description', 2000);
  if (Object.hasOwn(body, 'reviewType')) {
    if (!['annual', 'probation', 'internship'].includes(body.reviewType)) {
      fail('reviewType must be annual, probation or internship');
    }

    data.reviewType = body.reviewType;
  }

  if (Object.hasOwn(body, 'departmentIds')) {
    data.departmentIds = ids(body.departmentIds, 'departmentIds');
  }

  if (Object.hasOwn(body, 'targetRole')) {
    if (body.targetRole !== 'department_manager') {
      fail('HR templates currently target department_manager only');
    }

    data.targetRole = body.targetRole;
  }
  if (create || Object.hasOwn(body, 'frameworkId')) data.frameworkId = objectId(body.frameworkId, 'frameworkId').toLowerCase();
  if (Object.hasOwn(body, 'employmentTypeIds')) data.employmentTypeIds = ids(body.employmentTypeIds, 'employmentTypeIds');
  if (Object.hasOwn(body, 'sections')) data.sections = sections(body.sections);
  if (Object.hasOwn(body, 'evidenceRequired')) data.evidenceRequired = boolean(body.evidenceRequired, 'evidenceRequired');
  if (Object.hasOwn(body, 'status')) {
    if (!['draft', 'active', 'archived'].includes(body.status)) fail('status must be draft, active or archived');
    data.status = body.status;
  }
  return data;
}

function validateEmbeddedIds(nextSections, existingSections = []) {
  for (const section of nextSections || []) {
    const previous = existingSections.find((item) => String(item._id) === section._id);
    if (section._id && !previous) fail('Section ID does not belong to this template');
    for (const question of section.questions || []) {
      if (question._id && !previous?.questions?.some((item) => String(item._id) === question._id)) fail('Question ID does not belong to this section');
    }
  }
}

module.exports = { parseTemplate, validateEmbeddedIds };
