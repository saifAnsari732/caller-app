const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema({
  lead:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  caller:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:      { type: String, required: true }, // YYYY-MM-DD
  time:      { type: String, required: true }, // HH:MM
  notes:     { type: String, default: '' },
  reason:    { type: String, default: '' },
  priority:  { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
  attempt:   { type: Number, default: 1 },
  completed: { type: Boolean, default: false }
}, { timestamps: true });

// Add indexes for performance optimization
followupSchema.index({ caller: 1, date: 1, completed: 1 });
followupSchema.index({ date: 1 });
followupSchema.index({ lead: 1 });

module.exports = mongoose.model('Followup', followupSchema);
