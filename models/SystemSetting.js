const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  distributionStrategy: {
    type: String,
    enum: ['ROUND_ROBIN', 'LOAD_BALANCED', 'RULE_BASED'],
    default: 'ROUND_ROBIN'
  },
  slaThresholdMinutes: { type: Number, default: 15 },
  metaConfig: {
    connected: { type: Boolean, default: true },
    appId: { type: String, default: '1007200718473332' },
    pageId: { type: String, default: '933429549844450' },
    pageName: { type: String, default: 'Kisan Choice' },
    adAccountId: { type: String, default: 'act_1796071777698019' },
    accessToken: { type: String, default: '' },
    verifyToken: { type: String, default: 'OILFLOW_CRM_SECRET_2026' },
    webhookSubscribed: { type: Boolean, default: true },
    autoSyncEnabled: { type: Boolean, default: true },
    zeroLossFallback: { type: Boolean, default: true },
    connectedAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: Date.now }
  },
  metaForms: [{
    formId: { type: String, required: true },
    formName: { type: String, required: true },
    pageName: { type: String, default: 'Kisan Choice' },
    platform: { type: String, default: 'Facebook & Instagram Lead Ads' },
    campaignAction: { type: String, default: 'existing' },
    campaignName: { type: String, default: 'Facebook Meta Lead Ads' },
    distributionRule: { type: String, default: 'ROUND_ROBIN' },
    assignedTeam: { type: String, default: 'North Region Sales' },
    assignedCallerId: { type: String, default: '' },
    assignedCallerName: { type: String, default: 'Auto Round-Robin' },
    customizeFields: { type: Boolean, default: true },
    fieldMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        full_name: 'name',
        phone_number: 'mobile',
        email: 'email',
        city: 'city',
        state: 'state',
        business_inquiry_type: 'business_type',
        product_preference: 'product_interest'
      }
    },
    active: { type: Boolean, default: true },
    leadsCaptured: { type: Number, default: 0 },
    lastLeadAt: { type: Date, default: Date.now }
  }],
  customCampaigns: [{
    name: { type: String, required: true },
    platform: { type: String, default: 'META ADS' },
    formName: { type: String, default: 'KisanChoice Lead Form 2026' },
    team: { type: String, default: 'North Region Sales' },
    rule: { type: String, default: 'Round-Robin' },
    status: { type: String, default: 'ACTIVE' },
    dailyBudget: { type: Number, default: 2500 },
    createdAt: { type: Date, default: Date.now }
  }],
  metaCampaigns: [{
    campaignId: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'ACTIVE' },
    objective: { type: String, default: 'OUTCOME_LEADS' },
    dailyBudget: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    leadsCount: { type: Number, default: 0 },
    assignedTeam: { type: String, default: 'North Region Sales' },
    distributionRule: { type: String, default: 'ROUND_ROBIN' },
    linkedFormId: { type: String, default: '' },
    linkedFormName: { type: String, default: '' },
    lastSyncAt: { type: Date, default: Date.now }
  }],
  campaignGoals: [{
    campaignId: { type: String, required: true },
    campaignName: { type: String, required: true },
    targetLeadsDaily: { type: Number, default: 25 },
    targetCostPerLead: { type: Number, default: 35 },
    targetMonthlyBudget: { type: Number, default: 15000 },
    slaTargetMinutes: { type: Number, default: 15 },
    conversionRateTarget: { type: Number, default: 12 },
    notes: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
  }],
  routingRules: [{
    name: { type: String, required: true },
    source: { type: String, default: 'ALL' },
    matchField: { type: String, default: 'state' },
    matchValue: { type: String, default: '' },
    strategy: { type: String, default: 'Cyclic Round-Robin' },
    targetTeam: { type: String, default: 'North Region Sales' },
    targetCallerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    active: { type: Boolean, default: true }
  }],
  templates: [{
    type: { type: String, enum: ['WHATSAPP', 'SMS', 'EMAIL'], default: 'WHATSAPP' },
    name: { type: String, required: true },
    category: { type: String, default: 'General' },
    content: { type: String, required: true },
    variables: [{ type: String }],
    usageCount: { type: Number, default: 0 }
  }],
  teams: [{
    name: { type: String, required: true },
    code: { type: String, required: true },
    leadName: { type: String, default: '' },
    leadMobile: { type: String, default: '' },
    campaigns: [{ type: String }]
  }]
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema);
