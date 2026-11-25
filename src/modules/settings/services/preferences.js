const DASHBOARDS = { admin: '/admin/dashboard', hr: '/hr/dashboard', department_manager: '/manager/dashboard', tech_lead: '/tech-lead/dashboard', employee: '/employee/dashboard' };
const LANDING_PAGES = {
  admin: ['/admin/dashboard', '/admin/configuration'],
  hr: ['/hr/dashboard', '/hr/organization', '/hr/review-cycles', '/hr/performance-framework', '/hr/configuration'],
  department_manager: ['/manager/dashboard'], tech_lead: ['/tech-lead/dashboard'],
  employee: ['/employee/dashboard', '/employee/profile', '/employee/goals', '/employee/reviews', '/employee/feedback', '/employee/development'],
};

function fail(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('A JSON object is required');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Only authorized personal fields may be changed');
}
function defaults(role) { return { language: 'en', timezone: 'UTC', landingPage: DASHBOARDS[role], theme: 'system', appearance: { accent: 'blue', fontSize: 16, reduceMotion: 'system', contrast: 'standard' }, notifications: { email: true, goals: true, reviews: true, feedback: true, development: true } }; }
function validate(body, role, current = defaults(role)) {
  if (!LANDING_PAGES[role]) fail('Unsupported account role', 403);
  fields(body, ['language', 'timezone', 'landingPage', 'theme', 'appearance', 'notifications']);
  if (!Object.keys(body).length) fail('Nothing to update');
  const result = { ...current, appearance: { ...defaults(role).appearance, ...current.appearance }, notifications: { ...current.notifications } };
  if ('language' in body) { if (body.language !== 'en') fail('English is the only supported language'); result.language = body.language; }
  if ('timezone' in body) {
    if (typeof body.timezone !== 'string' || !body.timezone || body.timezone.length > 100) fail('Choose a valid time zone');
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { fail('Choose a valid time zone'); }
    result.timezone = body.timezone;
  }
  if ('landingPage' in body) { if (!LANDING_PAGES[role].includes(body.landingPage)) fail('Landing page is not available to this role', 403); result.landingPage = body.landingPage; }
  if ('theme' in body) { if (!['light', 'dark', 'system'].includes(body.theme)) fail('Choose Light, Dark or System Default'); result.theme = body.theme; }
  if ('appearance' in body) {
    fields(body.appearance, ['accent', 'fontSize', 'reduceMotion', 'contrast']);
    const value = body.appearance;
    if ('accent' in value && !['blue', 'teal', 'violet'].includes(value.accent)) fail('Choose a supported accent color');
    if ('fontSize' in value && (!Number.isInteger(value.fontSize) || value.fontSize < 14 || value.fontSize > 18)) fail('UI font size must be a whole number from 14 to 18 px');
    if ('reduceMotion' in value && !['system', 'on', 'off'].includes(value.reduceMotion)) fail('Choose a valid reduced motion preference');
    if ('contrast' in value && !['standard', 'high'].includes(value.contrast)) fail('Choose a valid contrast preference');
    Object.assign(result.appearance, value);
  }
  if ('notifications' in body) {
    fields(body.notifications, Object.keys(result.notifications));
    for (const [key, value] of Object.entries(body.notifications)) { if (typeof value !== 'boolean') fail('Notification preferences must be boolean'); result.notifications[key] = value; }
  }
  return result;
}
function read(stored, role) {
  const result = defaults(role);
  if (!stored) return result;
  const raw = typeof stored.toObject === 'function' ? stored.toObject() : stored;
  for (const key of ['language', 'timezone', 'landingPage', 'theme', 'appearance', 'notifications']) {
    if (raw[key] !== undefined) { try { Object.assign(result, validate({ [key]: raw[key] }, role, result)); } catch { /* Ignore obsolete stored values after role/policy changes. */ } }
  }
  return result;
}
module.exports = { DASHBOARDS, LANDING_PAGES, defaults, validate, read, fields, fail };
