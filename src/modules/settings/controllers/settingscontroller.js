const settingsService = require('../services/settingsservice');

async function profile(req, res, next) {
  try {
    const result = await settingsService.getProfile(req.user);
    res.json({ success: true, profile: result });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const result = await settingsService.updateProfile(req.user, req.body);
    res.json({ success: true, message: 'Profile updated', profile: result });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    await settingsService.changePassword(req.user, req.body);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = { profile, updateProfile, changePassword };