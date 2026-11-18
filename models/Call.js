const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  caller:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:        { type: String, required: true },
  disposition:   { type: String, default: '' },
  remarks:       { type: String, default: '' },
  call_type:     { type: String, enum: ['outgoing', 'incoming', 'missed'], default: 'outgoing' },
  notes:         { type: String, default: '' },
  start_time:    { type: Date, required: true },
  end_time:      { type: Date, required: true },
  duration:      { type: Number, required: true }, // seconds
  recording_url: { type: String, default: null },
  followup_date: { type: String, default: null },
  followup_time: { type: String, default: null }
}, { timestamps: true });

// Add indexes for performance optimization
callSchema.index({ caller: 1 });
callSchema.index({ lead: 1 });
callSchema.index({ createdAt: -1 });
callSchema.index({ caller: 1, createdAt: -1 });

module.exports = mongoose.model('Call', callSchema);
