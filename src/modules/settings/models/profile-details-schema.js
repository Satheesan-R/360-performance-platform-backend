const mongoose = require('mongoose');
const skill = new mongoose.Schema({ name: { type: String, maxlength: 60, required: true }, proficiency: { type: String, enum: ['learning', 'intermediate', 'advanced', 'expert'], required: true }, developing: { type: Boolean, default: false } }, { _id: false });
const link = new mongoose.Schema({ label: { type: String, maxlength: 60, required: true }, url: { type: String, maxlength: 500, required: true } }, { _id: false });
module.exports = new mongoose.Schema({
  photo: { type: String, maxlength: 180000, default: '' }, bio: { type: String, maxlength: 500, default: '' },
  skills: { type: [skill], default: [] }, links: { type: [link], default: [] },
  careerInterests: { type: String, maxlength: 1000, default: '' },
  careerVisibility: { type: String, enum: ['private', 'manager_hr'], default: 'private' },
}, { _id: false });
