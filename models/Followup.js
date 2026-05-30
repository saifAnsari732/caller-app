const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema({
  lead:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  caller:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:      { type: String, required: true }, // YYYY-MM-DD
  time:      { type: String, required: true }, // HH:MM
  notes:     { type: String, default: '' },
  completed: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Followup', followupSchema);
