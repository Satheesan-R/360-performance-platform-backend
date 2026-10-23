const mongoose = require('mongoose');
const percentage = { type: Number, min: 0, max: 100, required: true };
const levelSchema = new mongoose.Schema({
  value: { type: Number, required: true },
  label: { type: String, required: true, trim: true, maxlength: 200 },
}, { _id: false });
const ratingScaleSchema = new mongoose.Schema({
  min: { type: Number, enum: [1], required: true },
  max: { type: Number, enum: [3, 4, 5], required: true },
  levels: { type: [levelSchema], required: true },
}, { _id: false });
const categoryWeightsSchema = new mongoose.Schema({ technical: percentage, behavioral: percentage }, { _id: false });
const reviewerWeightsSchema = new mongoose.Schema({ self: percentage, peer: percentage, manager: percentage }, { _id: false });

module.exports = { ratingScaleSchema, categoryWeightsSchema, reviewerWeightsSchema };
