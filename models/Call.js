const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  caller:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:        { type: String, required: true },
  notes:         { type: String, required: true },
  start_time:    { type: Date, required: true },
  end_time:      { type: Date, required: true },
  duration:      { type: Number, required: true }, // seconds
  recording_url: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Call', callSchema);
