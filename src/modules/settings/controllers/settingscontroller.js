const service = require('../services/settingsservice');
const corrections = require('../services/profile-corrections');
const sharing = require('../services/profile-sharing');
async function profile(req, res, next) { try { res.json({ success: true, profile: await service.getProfile(req.user) }); } catch (error) { next(error); } }
async function updateProfile(req, res, next) { try { res.json({ success: true, message: 'Profile updated', profile: await service.updateProfile(req.user, req.body) }); } catch (error) { next(error); } }
async function changePassword(req, res, next) { try { const result = await service.changePassword(req.user, req.body); res.json({ success: true, message: 'Password changed. All sessions have ended. Please sign in again.', ...result }); } catch (error) { next(error); } }
async function getPreferences(req, res, next) { try { res.json({ success: true, preferences: await service.getPreferences(req.user) }); } catch (error) { next(error); } }
async function updatePreferences(req, res, next) { try { res.json({ success: true, preferences: await service.updatePreferences(req.user, req.body) }); } catch (error) { next(error); } }
async function listCorrections(req, res, next) { try { res.json({ corrections: await corrections.list(req.user) }); } catch (error) { next(error); } }
async function reviewQueue(req, res, next) { try { res.json({ corrections: await corrections.list(req.user, true) }); } catch (error) { next(error); } }
async function createCorrection(req, res, next) { try { res.status(201).json({ correction: await corrections.create(req.user, req.body) }); } catch (error) { next(error); } }
async function reviewCorrection(req, res, next) { try { res.json({ correction: await corrections.review(req.user, req.params.id, req.body) }); } catch (error) { next(error); } }
async function sharedProfile(req, res, next) { try { res.json({ profile: await sharing.read(req.user, req.params.id) }); } catch (error) { next(error); } }
module.exports = { listCorrections, reviewQueue, createCorrection, reviewCorrection, sharedProfile, profile, updateProfile, changePassword, getPreferences, updatePreferences };
