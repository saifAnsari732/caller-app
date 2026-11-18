const mongoose = require('mongoose');

const LEAD_STATUSES = [
  // 18 Standard Statuses
  'New', 'Assigned', 'Contacted', 'Interested', 'Qualified', 'Follow-up Required',
  'Demo Scheduled', 'Meeting Scheduled', 'Demo/Meeting Scheduled', 'Payment Pending',
  'Converted', 'Not Interested', 'Wrong Number', 'Busy', 'No Response',
  'Call Not Connected', 'Duplicate', 'Duplicate Lead', 'Invalid Lead', 'Lost',
  // Backward compatibility with existing pipeline stages
  'Fresh Lead', 'Fresh Inquiry', 'In-Progress', 'Callback',
  'Follow Up', 'Follow-up', 'Callback Scheduled', 'Closed', 'Rejected',
  'Distributor Interested', 'Trader Interested', 'DSS Interested', 'RSS Interested', 'SS Interested'
];

const PRIORITY_LEVELS = [
  'Low', 'Normal', 'High', 'VIP',
  'Hot Lead', 'Warm Lead', 'Cold Lead',
  'Very High Priority', 'Low Priority',
  'Hot', 'Warm', 'Cold'
];

const leadSchema = new mongoose.Schema({
  lead_id:            { type: String, unique: true }, // e.g. L-1001
  name:               { type: String, required: true, trim: true },
  mobile:             { type: String, required: true, trim: true },
  alternate_mobile:   { type: String, trim: true, default: '' },
  email:              { type: String, trim: true, lowercase: true, default: '' },
  city:               { type: String, trim: true, default: '' },
  state:              { type: String, trim: true, default: '' },
  business_type:      { type: String, trim: true, default: '' },
  product_interest:   { type: String, trim: true, default: '' },
  lead_source:        { type: String, default: 'Facebook Meta Lead Ads' },
  campaign_name:      { type: String, default: 'Meta Lead Campaign' },
  adset_name:         { type: String, default: '' },
  ad_name:            { type: String, default: '' },
  ad_id:              { type: String, default: '' },
  adset_id:           { type: String, default: '' },
  utm_source:         { type: String, default: '' },
  utm_medium:         { type: String, default: '' },
  utm_campaign:       { type: String, default: '' },
  status:             { type: String, enum: LEAD_STATUSES, default: 'New' },
  call_disposition:   { type: String, default: '' },
  remarks:            { type: String, default: '' },
  meta_lead_id:       { type: String, default: '' },
  priority:           { type: String, enum: PRIORITY_LEVELS, default: 'Normal' },
  temperature:        { type: String, enum: ['Hot', 'Warm', 'Cold'], default: 'Warm' },
  tags:               [{ type: String, trim: true }],
  assigned_team:      { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  assigned_team_leader:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assigned_to:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assigned_at:        { type: Date, default: null },
  first_contacted_at: { type: Date, default: null },
  last_contacted_at:  { type: Date, default: null },
  call_attempts:      { type: Number, default: 0 },
  response_time_seconds: { type: Number, default: null },
  sla_breached:       { type: Boolean, default: false },
  notes:              { type: String, default: '' },
  custom_fields:      { type: mongoose.Schema.Types.Mixed, default: {} },
  documents:          [{
    name:       { type: String, default: '' },
    url:        { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Duplicate & Repeat Inquiry Tracking
  is_repeat_lead:     { type: Boolean, default: false },
  is_duplicate:       { type: Boolean, default: false },
  duplicate_of:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  submission_count:   { type: Number, default: 1 },
  last_resubmitted_at:{ type: Date, default: null },
  quality_score:      { type: Number, default: 50 },
  quality_tier:       { type: String, default: 'Normal' }
}, { timestamps: true });

// Add indexes for performance optimization
leadSchema.index({ assigned_to: 1 });
leadSchema.index({ assigned_team: 1 });
leadSchema.index({ assigned_team_leader: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ assigned_to: 1, status: 1 });
leadSchema.index({ mobile: 1 });
leadSchema.index({ alternate_mobile: 1 });
leadSchema.index({ is_duplicate: 1 });
leadSchema.index({ sla_breached: 1 });

const Counter = require('./Counter');

// Auto-generate lead_id before saving new documents atomically
leadSchema.pre('save', async function () {
  if (this.lead_id) return;
  const LeadModel = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
  for (let attempt = 0; attempt < 10; attempt++) {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'leadId' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const candidate = `L-${counter.seq}`;
    const exists = await LeadModel.exists({ lead_id: candidate });
    if (!exists) {
      this.lead_id = candidate;
      return;
    }
    const latest = await LeadModel.findOne({ lead_id: /^L-\d+$/ }).sort({ createdAt: -1 }).select('lead_id').lean();
    if (latest?.lead_id) {
      const num = parseInt(latest.lead_id.replace('L-', ''), 10);
      if (!isNaN(num) && num >= counter.seq) {
        await Counter.updateOne({ _id: 'leadId' }, { $max: { seq: num } });
      }
    }
  }
  this.lead_id = `L-${Date.now().toString().slice(-6)}`;
});

module.exports = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
