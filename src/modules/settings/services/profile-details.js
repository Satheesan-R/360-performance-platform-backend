const { fields, fail } = require('./preferences');
const levels = ['learning', 'intermediate', 'advanced', 'expert'];
function defaults() { return { photo: '', bio: '', skills: [], careerInterests: '', careerVisibility: 'private', links: [] }; }
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`${label} must be ${required ? 'non-empty ' : ''}text up to ${max} characters`);
  return value.trim();
}
function validate(value) {
  fields(value, Object.keys(defaults()));
  const result = { ...defaults(), ...value };
  result.bio = text(result.bio, 500, 'Bio');
  result.careerInterests = text(result.careerInterests, 1000, 'Career interests');
  if (!['private', 'manager_hr'].includes(result.careerVisibility)) fail('Choose a valid career interests audience');
  if (typeof result.photo !== 'string' || result.photo.length > 180000) fail('Profile photo is too large');
  if (result.photo) {
    if (!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(result.photo)) fail('Photo must be a cropped JPEG');
    const bytes = Buffer.from(result.photo.split(',')[1], 'base64');
    if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) fail('Photo must be a valid JPEG');
  }
  if (!Array.isArray(result.skills) || result.skills.length > 20) fail('Add up to 20 skills');
  const seen = new Set();
  result.skills = result.skills.map(skill => {
    fields(skill, ['name', 'proficiency', 'developing']);
    const name = text(skill.name, 60, 'Skill name', true);
    if (seen.has(name.toLowerCase())) fail('Each skill should appear only once');
    seen.add(name.toLowerCase());
    if (!levels.includes(skill.proficiency) || typeof skill.developing !== 'boolean') fail('Choose valid skill proficiency and development options');
    return { name, proficiency: skill.proficiency, developing: skill.developing };
  });
  if (!Array.isArray(result.links) || result.links.length > 5) fail('Add up to 5 professional links');
  result.links = result.links.map(link => {
    fields(link, ['label', 'url']);
    const label = text(link.label, 60, 'Link label', true); const url = text(link.url, 500, 'Web address', true);
    let parsed; try { parsed = new URL(url); } catch { fail('Use an HTTP or HTTPS web address'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) fail('Use an HTTP or HTTPS link without sign-in credentials');
    return { label, url };
  });
  return result;
}
function read(value) { try { return validate(value?.toObject ? value.toObject() : value || {}); } catch { return defaults(); } }
module.exports = { defaults, validate, read, text };
