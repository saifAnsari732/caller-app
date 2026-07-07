const mongoose = require('mongoose');

const LEAD_STATUSES = [
  'Fresh Lead', 'Assigned', 'Follow Up', 'Callback',
  'Interested', 'Distributor Interested', 'Trader Interested',
  'Not Connected', 'Closed', 'Rejected'
];

const leadSchema = new mongoose.Schema({
  lead_id:          { type: String, unique: true }, // e.g. L-1001
  name:             { type: String, required: true, trim: true },
  mobile:           { type: String, required: true, trim: true },
  email:            { type: String, trim: true, lowercase: true },
  city:             { type: String, trim: true },
  state:            { type: String, trim: true },
  business_type:    { type: String, trim: true },
  product_interest: { type: String, trim: true },
  lead_source:      { type: String, default: 'Facebook Meta Lead Ads' },
  status:           { type: String, enum: LEAD_STATUSES, default: 'Fresh Lead' },
  assigned_to:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assigned_at:      { type: Date, default: null }
}, { timestamps: true });

const Counter = require('./Counter');

// Auto-generate lead_id before saving new documents atomically
leadSchema.pre('save', async function () {
  if (this.lead_id) return;
  
  const counter = await Counter.findOneAndUpdate(
    { _id: 'leadId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  this.lead_id = `L-${counter.seq}`;
});

module.exports = mongoose.model('Lead', leadSchema);
