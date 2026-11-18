const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');
const SystemSetting = require('../models/SystemSetting');

let isDistributing = false;

async function getOrInitSettings() {
  let settings = await SystemSetting.findOne({ key: 'global' });
  if (!settings) {
    settings = await SystemSetting.create({
      key: 'global',
      distributionStrategy: 'ROUND_ROBIN',
      slaThresholdMinutes: 15,
      routingRules: [
        {
          name: 'Facebook Meta Ads — Auto Round-Robin',
          source: 'Facebook Meta Lead Ads',
          matchField: 'state',
          matchValue: '',
          strategy: 'Cyclic Round-Robin',
          targetTeam: 'North Region Sales',
          active: true
        },
        {
          name: 'Distributor & Bulk Inquiries — Load Balanced',
          source: 'ALL',
          matchField: 'business_type',
          matchValue: 'Distributor',
          strategy: 'Load Balanced',
          targetTeam: 'Bulk Lubricants Ops',
          active: true
        }
      ],
      templates: [
        {
          type: 'WHATSAPP',
          name: 'Initial Lead Welcome & Product Specs',
          category: 'Welcome',
          content: 'Namaste {{lead_name}} ji! Thank you for inquiring with KisanConnect regarding {{product_interest}}. Main {{agent_name}} bol raha hoon. Aapko rate list aur details bhej raha hoon.',
          variables: ['lead_name', 'product_interest', 'agent_name'],
          usageCount: 248
        },
        {
          type: 'WHATSAPP',
          name: 'Not Connected / Missed Call Follow-up',
          category: 'Follow-up',
          content: 'Namaste {{lead_name}} ji, humne aapko KisanConnect inquiry ke liye call kiya tha par baat nahi ho paayi. Kripya free hokar is number par reply ya call back karein. - {{agent_name}}',
          variables: ['lead_name', 'agent_name'],
          usageCount: 182
        },
        {
          type: 'WHATSAPP',
          name: 'Follow-up Reminder & Order Consultation',
          category: 'Follow-up',
          content: 'Hi {{lead_name}}, jaisa humari call par baat hui, humne aapka follow-up schedule kar liya hai. Kisi bhi jankari ke liye sampark karein. - {{agent_name}}',
          variables: ['lead_name', 'agent_name'],
          usageCount: 110
        },
        {
          type: 'SMS',
          name: 'Quick Callback Alert SMS',
          category: 'Alert',
          content: 'Dear {{lead_name}}, we tried calling you regarding your KisanConnect inquiry ({{product_interest}}). Please reply or call back to connect with {{agent_name}}.',
          variables: ['lead_name', 'product_interest', 'agent_name'],
          usageCount: 95
        },
        {
          type: 'EMAIL',
          name: 'Formal Proforma Invoice & Product Brochure',
          category: 'Sales',
          content: 'Dear {{lead_name}},\n\nPlease find attached the formal quotation for your requirement ({{product_interest}}).\n\nBest Regards,\n{{agent_name}}\nKisanConnect Sales Team',
          variables: ['lead_name', 'product_interest', 'agent_name'],
          usageCount: 64
        }
      ],
      teams: [
        {
          name: 'North Region Sales',
          code: 'NRS-01',
          leadName: 'Amit Sharma',
          leadMobile: '9876543211',
          campaigns: ['Facebook Meta Lead Ads', 'MP & Rajasthan Agro']
        },
        {
          name: 'Bulk Lubricants Ops',
          code: 'BLO-02',
          leadName: 'Priya Patel',
          leadMobile: '9876543212',
          campaigns: ['Distributor Bulk Inquiries', 'Industrial Oil Tankers']
        },
        {
          name: 'Field Ops & Followup',
          code: 'FOF-03',
          leadName: 'Rohan Das',
          leadMobile: '9876543213',
          campaigns: ['Walk-in Leads', 'Website Direct']
        }
      ]
    });
  }
  return settings;
}

async function chooseCallerForLead(lead, activeCallers, settings, lastAssignedIndexObj) {
  if (!activeCallers || activeCallers.length === 0) return null;

  const strategy = settings?.distributionStrategy || 'ROUND_ROBIN';

  // 1. Check RULE_BASED first if strategy === 'RULE_BASED'
  if (strategy === 'RULE_BASED' && settings?.routingRules?.length > 0) {
    for (const rule of settings.routingRules) {
      if (!rule.active) continue;
      const sourceMatch = !rule.source || rule.source === 'ALL' || (lead.lead_source || '').toLowerCase().includes(rule.source.toLowerCase());
      const fieldVal = String(lead[rule.matchField] || '').toLowerCase();
      const valMatch = !rule.matchValue || fieldVal.includes(rule.matchValue.toLowerCase());

      if (sourceMatch && valMatch) {
        if (rule.targetCallerId) {
          const direct = activeCallers.find(c => c._id.toString() === rule.targetCallerId.toString());
          if (direct) return direct;
        }
        if (rule.targetTeam) {
          const teamCallers = activeCallers.filter(c => (c.team || 'North Region Sales') === rule.targetTeam);
          if (teamCallers.length > 0) {
            return await pickLoadBalancedCaller(teamCallers);
          }
        }
      }
    }
  }

  // 2. Intelligent Attribute Matching (Requirement 3: Location-wise, Product-wise, Language-wise)
  let candidatePool = activeCallers;

  // Language matching
  const leadLang = (lead.language || lead.custom_fields?.language || lead.custom_fields?.भाषा || '').toLowerCase().trim();
  if (leadLang) {
    const langMatched = activeCallers.filter(c => 
      c.languages && c.languages.some(l => l.toLowerCase().includes(leadLang) || leadLang.includes(l.toLowerCase()))
    );
    if (langMatched.length > 0) candidatePool = langMatched;
  }

  // Location / City / State matching
  const leadLocation = (lead.city || lead.state || '').toLowerCase().trim();
  if (leadLocation) {
    const locMatched = candidatePool.filter(c =>
      c.locations && c.locations.some(loc => loc.toLowerCase().includes(leadLocation) || leadLocation.includes(loc.toLowerCase()))
    );
    if (locMatched.length > 0) candidatePool = locMatched;
  }

  // Product / Course interest matching
  const leadProduct = (lead.product_interest || lead.course_interest || '').toLowerCase().trim();
  if (leadProduct) {
    const prodMatched = candidatePool.filter(c =>
      c.products && c.products.some(p => p.toLowerCase().includes(leadProduct) || leadProduct.includes(p.toLowerCase()))
    );
    if (prodMatched.length > 0) candidatePool = prodMatched;
  }

  // 3. Strategy execution on resolved candidatePool
  if (strategy === 'LOAD_BALANCED') {
    return await pickLoadBalancedCaller(candidatePool);
  }

  // 4. Default: Cyclic ROUND_ROBIN on candidates
  const nextIndex = (lastAssignedIndexObj.index + 1) % candidatePool.length;
  lastAssignedIndexObj.index = nextIndex;
  return candidatePool[nextIndex];
}

async function pickLoadBalancedCaller(callers) {
  const counts = await Promise.all(
    callers.map(async (caller) => {
      const openCount = await Lead.countDocuments({
        assigned_to: caller._id,
        status: { $in: ['Fresh Lead', 'Assigned', 'Follow Up', 'Callback'] }
      });
      return { caller, openCount };
    })
  );
  counts.sort((a, b) => a.openCount - b.openCount);
  return counts[0].caller;
}

async function distributeSingleLead(lead, sourceLabel = 'Meta Ads', formConfig = null) {
  if (!lead) return null;
  const settings = await getOrInitSettings();

  if (settings?.metaConfig?.autoSyncEnabled === false || (formConfig && formConfig.active === false)) {
    return null;
  }

  // Prefer callers who are active, not on leave, and not Clocked Out
  let activeCallers = await User.find({
    role: 'telecaller',
    status: 'active',
    on_leave: false,
    shift_status: { $ne: 'Clocked Out' }
  }).sort({ _id: 1 });

  // Fallback to any active non-leave telecaller if everyone is clocked out
  if (activeCallers.length === 0) {
    activeCallers = await User.find({
      role: 'telecaller',
      status: 'active',
      on_leave: false
    }).sort({ _id: 1 });
  }

  if (activeCallers.length === 0) return null;

  // Filter pool by formConfig.assignedTeam if specified
  let pool = activeCallers;
  if (formConfig?.assignedTeam) {
    const teamMembers = activeCallers.filter(
      c => (c.team || '').toLowerCase() === formConfig.assignedTeam.toLowerCase()
    );
    if (teamMembers.length > 0) pool = teamMembers;
  }

  // Filter out callers who have reached their maximum lead capacity (Requirement 3)
  const capacityCheckedCallers = [];
  for (const caller of pool) {
    const callerLimit = caller.max_lead_limit || 100;
    const activeCount = await Lead.countDocuments({
      assigned_to: caller._id,
      status: { $in: ['New', 'Fresh Lead', 'Assigned', 'Follow Up', 'Follow-up Required', 'Callback', 'In-Progress'] }
    });
    if (activeCount < callerLimit) {
      capacityCheckedCallers.push(caller);
    }
  }
  if (capacityCheckedCallers.length > 0) {
    pool = capacityCheckedCallers;
  }

  let chosenCaller = null;
  if (formConfig?.distributionRule === 'DIRECT_CALLER' && formConfig?.assignedCallerId) {
    chosenCaller = activeCallers.find(c => c._id.toString() === formConfig.assignedCallerId.toString()) || pool[0];
  } else if (formConfig?.distributionRule === 'LOAD_BALANCED') {
    chosenCaller = await pickLoadBalancedCaller(pool);
  } else {
    const lastLead = await Lead.findOne({ assigned_to: { $in: pool.map(p => p._id) }, _id: { $ne: lead._id } }).sort({ assigned_at: -1 });
    let lastIndex = -1;
    if (lastLead && lastLead.assigned_to) {
      lastIndex = pool.findIndex(c => c._id.toString() === lastLead.assigned_to.toString());
    }
    const indexTracker = { index: lastIndex };
    chosenCaller = await chooseCallerForLead(lead, pool, settings, indexTracker);
  }

  if (!chosenCaller) return null;

  lead.assigned_to = chosenCaller._id;
  lead.assigned_at = new Date();
  lead.status = 'Assigned';
  await lead.save();

  await Notification.create({
    user: chosenCaller._id,
    title: 'New Lead Assigned',
    message: `Lead ${lead.name} (${lead.city || 'Unknown City'}) from ${sourceLabel} has been assigned to you.`,
    type: 'NEW_LEAD'
  });

  return chosenCaller;
}

async function distributePendingLeads() {
  if (isDistributing) return;
  isDistributing = true;

  try {
    const settings = await getOrInitSettings();
    let freshLeads = await Lead.find({ status: { $in: ['New', 'Fresh Lead', 'Fresh Inquiry'] }, assigned_to: null }).sort({ _id: 1 });

    while (freshLeads.length > 0) {
      let activeCallers = await User.find({
        role: 'telecaller',
        status: 'active',
        on_leave: false,
        shift_status: { $ne: 'Clocked Out' }
      }).sort({ _id: 1 });

      if (activeCallers.length === 0) {
        activeCallers = await User.find({
          role: 'telecaller',
          status: 'active',
          on_leave: false
        }).sort({ _id: 1 });
      }
      if (activeCallers.length === 0) break;

      const lastLead = await Lead.findOne({ assigned_to: { $ne: null } }).sort({ assigned_at: -1 });
      let lastCallerId = lastLead ? lastLead.assigned_to.toString() : null;
      let lastIndex = lastCallerId ? activeCallers.findIndex(c => c._id.toString() === lastCallerId) : -1;
      const indexTracker = { index: lastIndex };

      for (const lead of freshLeads) {
        const chosenCaller = await chooseCallerForLead(lead, activeCallers, settings, indexTracker);
        if (!chosenCaller) break;

        lead.assigned_to = chosenCaller._id;
        lead.assigned_at = new Date();
        lead.status = 'Assigned';
        await lead.save();

        await Notification.create({
          user: chosenCaller._id,
          title: 'New Lead Assigned',
          message: `Lead ${lead.name} (${lead.city || 'Unknown City'}) has been assigned to you.`,
          type: 'NEW_LEAD'
        });
      }

      freshLeads = await Lead.find({ status: { $in: ['New', 'Fresh Lead', 'Fresh Inquiry'] }, assigned_to: null }).sort({ _id: 1 });
    }
  } catch (error) {
    console.error('Error in distributePendingLeads:', error);
  } finally {
    isDistributing = false;
  }
}

module.exports = {
  getOrInitSettings,
  distributeSingleLead,
  distributePendingLeads
};
