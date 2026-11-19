const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const upload = multer({ dest: 'public/recordings/' });
const Lead = require('../models/Lead');
const User = require('../models/User');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { distributePendingLeads } = require('../services/distributor');
const { computeLeadScore } = require('../services/leadScorer');

router.use(authenticateToken);

// GET /api/leads — get leads with strict RBAC (admin sees all, team_leader sees own team, telecaller sees own)
router.get('/', async (req, res) => {
  try {
    const andClauses = [];

    // 1. Role-based scoping
    if (req.user.role === 'telecaller') {
      andClauses.push({ assigned_to: req.user.id });
    } else if (req.user.role === 'team_leader' || req.user.role === 'manager') {
      const teamMembers = await User.find({
        $or: [
          { team_leader_id: req.user.id },
          { _id: req.user.id }
        ]
      }).select('_id');
      const memberIds = teamMembers.map(m => m._id);
      andClauses.push({
        $or: [
          { assigned_team_leader: req.user.id },
          { assigned_to: { $in: memberIds } }
        ]
      });
    }

    if (req.query.status) {
      const s = String(req.query.status).trim();
      if (/^(new|fresh|fresh lead|fresh inquiry)$/i.test(s)) {
        andClauses.push({ status: { $in: ['New', 'Fresh Lead', 'Fresh Inquiry'] } });
      } else if (/^(follow[_\s-]?up|follow[_\s-]?up required)$/i.test(s)) {
        andClauses.push({ status: { $in: ['Follow Up', 'Follow-up Required', 'Follow-up', 'follow_up'] } });
      } else if (/^callback$/i.test(s)) {
        andClauses.push({ status: { $in: ['Callback', 'Callback Scheduled', 'callback'] } });
      } else if (/^(closed|converted)$/i.test(s)) {
        andClauses.push({ status: { $in: ['Closed', 'Converted'] } });
      } else if (/^not[_\s-]?connected$/i.test(s)) {
        andClauses.push({ status: { $in: ['Not Connected', 'Call Not Connected', 'No answer', 'Switched off', 'Busy'] } });
      } else {
        andClauses.push({ status: new RegExp('^' + s.replace(/_/g, '[\\s_-]?') + '$', 'i') });
      }
    }
    if (req.query.business_type) andClauses.push({ business_type: req.query.business_type });
    if (req.query.tag) andClauses.push({ tags: req.query.tag });
    if (req.query.campaign) andClauses.push({ campaign_name: req.query.campaign });
    if (req.query.priority) andClauses.push({ priority: new RegExp(req.query.priority, 'i') });
    if (req.query.city || req.query.location) andClauses.push({ city: new RegExp(req.query.city || req.query.location, 'i') });
    if (req.query.product || req.query.product_interest) andClauses.push({ product_interest: new RegExp(req.query.product || req.query.product_interest, 'i') });
    if (req.query.adset) andClauses.push({ adset_name: new RegExp(req.query.adset, 'i') });
    if (req.query.meta_lead_id) andClauses.push({ meta_lead_id: req.query.meta_lead_id });

    if (req.query.uncontacted === 'true') {
      andClauses.push({
        $or: [
          { call_attempts: 0 },
          { status: { $in: ['New', 'Fresh Lead', 'Assigned', 'Fresh Inquiry'] } }
        ]
      });
    }

    if (req.query.converted === 'true') {
      andClauses.push({ status: { $in: ['Converted', 'Closed'] } });
    } else if (req.query.converted === 'false') {
      andClauses.push({ status: { $nin: ['Converted', 'Closed'] } });
    }

    if (req.query.assigned_to && req.user.role !== 'telecaller') {
      andClauses.push({ assigned_to: req.query.assigned_to });
    }

    // Global Search query (name, mobile, alternate_mobile, city, lead_id)
    if (req.query.query) {
      const q = req.query.query.trim();
      const searchRegex = new RegExp(q, 'i');
      const cleanDigits = q.replace(/\D/g, '');
      const searchOr = [
        { name: searchRegex },
        { mobile: searchRegex },
        { alternate_mobile: searchRegex },
        { city: searchRegex },
        { lead_id: searchRegex },
        { email: searchRegex }
      ];
      if (cleanDigits.length >= 4) {
        searchOr.push({ mobile: new RegExp(cleanDigits) });
        searchOr.push({ alternate_mobile: new RegExp(cleanDigits) });
      }
      andClauses.push({ $or: searchOr });
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      const dateFilter = {};
      if (req.query.startDate) dateFilter.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      andClauses.push({ createdAt: dateFilter });
    }

    const filter = andClauses.length > 0 ? { $and: andClauses } : {};

    const leads = await Lead.find(filter)
      .populate('assigned_to', 'name employee_id mobile')
      .populate('assigned_team_leader', 'name employee_id mobile')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const mappedLeads = leads.map(l => ({ ...l, id: l._id }));
    res.json({ leads: mappedLeads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/power-queue — get ordered queue of leads to call right now (Due Followups + Fresh/Assigned Leads)
router.get('/power-queue', async (req, res) => {
  try {
    const callerFilter = req.user.role === 'telecaller' ? { assigned_to: req.user.id } : {};
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Overdue & Today's Follow-ups first
    const dueFollowups = await Followup.find({
      ...(req.user.role === 'telecaller' ? { caller: req.user.id } : {}),
      date: { $lte: todayStr },
      completed: false
    }).populate('lead').sort({ date: 1, time: 1 }).limit(30).lean();

    const followupLeads = dueFollowups
      .filter(f => f.lead)
      .map(f => ({
        ...f.lead,
        id: f.lead._id,
        queueReason: f.date < todayStr ? `Overdue Follow-up (${f.date} ${f.time})` : `Today's Follow-up (${f.time})`,
        followupNote: f.notes
      }));

    const seenIds = new Set(followupLeads.map(l => l._id.toString()));

    // 2. Uncontacted / Assigned / Fresh / Callback leads
    const freshLeads = await Lead.find({
      ...callerFilter,
      $or: [
        { status: { $in: ['New', 'Fresh Lead', 'Assigned', 'Callback', 'Callback requested', 'Follow-up Required'] } },
        { call_attempts: 0 }
      ]
    }).sort({ createdAt: -1 }).limit(50).lean();

    for (const l of freshLeads) {
      if (!seenIds.has(l._id.toString())) {
        seenIds.add(l._id.toString());
        followupLeads.push({
          ...l,
          id: l._id,
          queueReason: l.status === 'Callback' || l.status === 'Callback requested'
            ? 'Callback Requested'
            : (l.call_attempts === 0 || l.status === 'New' || l.status === 'Fresh Lead')
              ? 'Fresh Uncontacted Lead'
              : `${l.status} Lead`
        });
      }
    }

    res.json({ queue: followupLeads, total: followupLeads.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id — details + timeline
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assigned_to', 'name employee_id mobile').lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (req.user.role === 'telecaller') {
      if (!lead.assigned_to || lead.assigned_to._id.toString() !== req.user.id.toString()) {
        return res.status(403).json({ error: 'Access denied: Telecallers can only view their own assigned leads' });
      }
    } else if (req.user.role === 'team_leader' || req.user.role === 'manager') {
      const teamMembers = await User.find({
        $or: [{ team_leader_id: req.user.id }, { _id: req.user.id }]
      }).select('_id');
      const allowedIds = new Set(teamMembers.map(m => m._id.toString()));
      const assignedToId = lead.assigned_to?._id ? lead.assigned_to._id.toString() : lead.assigned_to?.toString();
      const tlId = lead.assigned_team_leader ? lead.assigned_team_leader.toString() : null;
      if ((!assignedToId || !allowedIds.has(assignedToId)) && tlId !== req.user.id.toString()) {
        return res.status(403).json({ error: 'Access denied: Team Leaders can only view their own team leads' });
      }
    }

    const calls = await Call.find({ lead: lead._id })
      .populate('caller', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const followups = await Followup.find({ lead: lead._id })
      .populate('caller', 'name')
      .sort({ date: -1, time: -1 })
      .lean();

    lead.id = lead._id;
    const mappedCalls = calls.map(c => ({ ...c, id: c._id }));
    const mappedFollowups = followups.map(f => ({ ...f, id: f._id }));

    const timeline = [];
    
    timeline.push({
      type: 'CREATED',
      title: 'Lead Created',
      date: lead.createdAt || new Date(),
      description: `Added via ${lead.lead_source || 'Manual'}`
    });

    if (lead.assigned_to) {
      timeline.push({
        type: 'ASSIGNED',
        title: 'Lead Assigned',
        date: lead.assigned_at || lead.createdAt,
        description: `Assigned to ${lead.assigned_to.name}`
      });
    }

    mappedCalls.forEach(call => {
      timeline.push({
        type: 'CALL',
        title: `Call: ${call.status}${call.disposition ? ` (${call.disposition})` : ''}`,
        date: call.start_time || call.createdAt || new Date(),
        description: `Talk time: ${call.duration}s. ${call.remarks || call.notes || ''}`,
        recording: !!call.recording_url,
        recording_url: call.recording_url || null,
        duration: call.duration || 0,
        disposition: call.disposition || '',
        remarks: call.remarks || call.notes || ''
      });
    });

    mappedFollowups.forEach(f => {
      timeline.push({
        type: 'FOLLOWUP',
        title: f.completed ? 'Follow-up Completed' : 'Follow-up Scheduled',
        date: f.createdAt || new Date(),
        description: `Scheduled for ${f.date} at ${f.time}. ${f.notes || ''}`
      });
    });

    if (lead.documents && Array.isArray(lead.documents)) {
      lead.documents.forEach(doc => {
        timeline.push({
          type: 'DOCUMENT',
          title: `Document: ${doc.name || 'Attachment'}`,
          date: doc.uploadedAt || lead.createdAt || new Date(),
          description: `Attached file: ${doc.name || 'Document'}`,
          document_url: doc.url || null
        });
      });
    }

    if (lead.status === 'Wrong Number' || lead.status === 'Invalid Lead' || (lead.tags && lead.tags.includes('Invalid Lead'))) {
      timeline.push({
        type: 'INVALID_FLAG',
        title: `Lead Flagged: ${lead.status}`,
        date: lead.updatedAt || lead.createdAt || new Date(),
        description: `Marked as ${lead.status} by agent`
      });
    }

    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ lead, calls: mappedCalls, followups: mappedFollowups, timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads — create manually (or Walk-in Lead)
router.post('/', async (req, res) => {
  try {
    const {
      name,
      mobile,
      alternate_mobile,
      email,
      city,
      state,
      business_type,
      product_interest,
      lead_source,
      campaign_name,
      adset_name,
      ad_name,
      utm_source,
      utm_medium,
      utm_campaign,
      priority,
      custom_fields,
      notes,
      tags,
      assignToSelf
    } = req.body;
    if (!name || !mobile) return res.status(400).json({ error: 'Name and mobile are required' });

    const isTelecaller = req.user.role === 'telecaller';
    const assignCallerId = (isTelecaller || assignToSelf) ? req.user.id : null;

    const leadScoreData = {
      custom_fields: custom_fields || {},
      product_interest: product_interest || '',
      city: city || '',
      alternate_mobile: alternate_mobile || '',
      email: email || '',
      status: assignCallerId ? 'Assigned' : 'New',
      createdAt: new Date()
    };
    const { score: autoScore, priority: autoPriority } = computeLeadScore(leadScoreData);

    const newLead = await Lead.create({
      name,
      mobile,
      alternate_mobile: alternate_mobile || '',
      email: email || '',
      city: city || '',
      state: state || '',
      business_type: business_type || '',
      product_interest: product_interest || '',
      lead_source: lead_source || (isTelecaller ? 'Walk-in / Telecaller Entry' : 'Manual Entry'),
      campaign_name: campaign_name || 'Direct Entry',
      adset_name: adset_name || '',
      ad_name: ad_name || '',
      utm_source: utm_source || '',
      utm_medium: utm_medium || '',
      utm_campaign: utm_campaign || '',
      quality_score: autoScore,
      priority: priority || autoPriority,
      custom_fields: custom_fields || {},
      status: assignCallerId ? 'Assigned' : 'New',
      assigned_to: assignCallerId,
      assigned_at: assignCallerId ? new Date() : null,
      tags: Array.isArray(tags) ? tags : [],
      notes: notes || ''
    });

    if (!assignCallerId) {
      await distributePendingLeads();
    }

    res.status(201).json({ message: 'Lead added successfully', leadId: newLead._id, lead: newLead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leads/:id — edit lead details
router.put('/:id', async (req, res) => {
  try {
    const {
      name, mobile, alternate_mobile, email, city, state,
      business_type, product_interest, notes, tags, priority,
      custom_fields
    } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name !== undefined) lead.name = name;
    if (mobile !== undefined) lead.mobile = mobile;
    if (alternate_mobile !== undefined) lead.alternate_mobile = alternate_mobile;
    if (email !== undefined) lead.email = email;
    if (city !== undefined) lead.city = city;
    if (state !== undefined) lead.state = state;
    if (business_type !== undefined) lead.business_type = business_type;
    if (product_interest !== undefined) lead.product_interest = product_interest;
    if (notes !== undefined) lead.notes = notes;
    if (tags !== undefined && Array.isArray(tags)) lead.tags = tags;
    if (priority !== undefined) lead.priority = priority;
    if (custom_fields !== undefined) lead.custom_fields = custom_fields;

    await lead.save();
    res.json({ message: 'Lead updated successfully', lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/upload-document (Requirement 2 & 16)
router.post('/:id/upload-document', async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!url) return res.status(400).json({ error: 'Document URL is required' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const newDoc = {
      name: name || `Doc_${Date.now()}`,
      url,
      uploadedAt: new Date()
    };

    lead.documents = lead.documents || [];
    lead.documents.push(newDoc);
    await lead.save();

    res.json({ message: 'Document attached successfully', documents: lead.documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/:id/upload-file (Multipart file upload for mobile)
router.post('/:id/upload-file', upload.single('file'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    let docUrl = '';
    let docName = req.file?.originalname || req.body?.name || `Doc_${Date.now()}`;

    if (req.file) {
      docUrl = `/recordings/${req.file.filename}`;
    } else if (req.body?.url) {
      docUrl = req.body.url;
    } else {
      return res.status(400).json({ error: 'File or URL required' });
    }

    const newDoc = {
      name: docName,
      url: docUrl,
      uploadedAt: new Date()
    };

    lead.documents = lead.documents || [];
    lead.documents.push(newDoc);
    await lead.save();

    res.json({ message: 'Document uploaded successfully', documents: lead.documents, document: newDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/detect-duplicates (Requirement 9: Same mobile, email, or Meta lead ID)
router.post('/detect-duplicates', async (req, res) => {
  try {
    const callerFilter = req.user.role === 'telecaller'
      ? { assigned_to: new mongoose.Types.ObjectId(req.user.id) }
      : {};
    
    const groupField = req.body?.field === 'email' ? '$email' : req.body?.field === 'meta_lead_id' ? '$meta_lead_id' : '$mobile';
    const matchField = req.body?.field === 'email' ? 'email' : req.body?.field === 'meta_lead_id' ? 'meta_lead_id' : 'mobile';

    // Aggregate to find duplicate customer records
    const duplicateGroups = await Lead.aggregate([
      { 
        $match: { 
          ...callerFilter, 
          is_duplicate: { $ne: true },
          [matchField]: { $nin: ['', null, '0000000000'] }
        } 
      },
      {
        $group: {
          _id: groupField,
          count: { $sum: 1 },
          leads: { $push: { id: '$_id', lead_id: '$lead_id', name: '$name', createdAt: '$createdAt', status: '$status', city: '$city', mobile: '$mobile', email: '$email' } }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 }
    ]);

    res.json({ duplicates: duplicateGroups, totalDuplicates: duplicateGroups.length, field: matchField });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/mark-invalid (Requirement 9: Invalid, fake ya wrong-number leads ko separately mark karna)
router.patch('/:id/mark-invalid', async (req, res) => {
  try {
    const { reason, remarks } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const statusChoice = reason === 'Wrong Number' ? 'Wrong Number' : 'Invalid Lead';
    lead.status = statusChoice;
    lead.notes = `${lead.notes || ''}\n[Marked Invalid by ${req.user.name || 'User'}]: ${remarks || reason || 'Invalid/Fake Lead'}`;
    lead.tags = lead.tags || [];
    if (!lead.tags.includes('Invalid Lead')) {
      lead.tags.push('Invalid Lead');
    }
    lead.quality_score = 5;
    lead.priority = 'Cold Lead';
    await lead.save();

    res.json({ message: `Lead marked as ${statusChoice}`, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/merge (Requirement 9)
router.post('/merge', async (req, res) => {
  try {
    const { primaryLeadId, duplicateLeadIds } = req.body;
    if (!primaryLeadId || !duplicateLeadIds || !Array.isArray(duplicateLeadIds) || duplicateLeadIds.length === 0) {
      return res.status(400).json({ error: 'primaryLeadId and duplicateLeadIds array required' });
    }

    const primaryLead = await Lead.findById(primaryLeadId);
    if (!primaryLead) return res.status(404).json({ error: 'Primary lead not found' });

    const duplicates = await Lead.find({ _id: { $in: duplicateLeadIds } });
    let mergedNotes = primaryLead.notes || '';
    let additionalTags = [];

    for (const dup of duplicates) {
      if (dup.notes) {
        mergedNotes += `\n[Merged Note from ${dup.lead_id || dup.name}]: ${dup.notes}`;
      }
      if (dup.tags && dup.tags.length > 0) {
        additionalTags.push(...dup.tags);
      }
      if (dup.alternate_mobile && !primaryLead.alternate_mobile) {
        primaryLead.alternate_mobile = dup.alternate_mobile;
      }
      if (dup.email && !primaryLead.email) {
        primaryLead.email = dup.email;
      }
      if (dup.documents && dup.documents.length > 0) {
        primaryLead.documents = [...(primaryLead.documents || []), ...dup.documents];
      }

      // Re-point calls and follow-ups to primary lead
      await Call.updateMany({ lead: dup._id }, { $set: { lead: primaryLead._id } });
      await Followup.updateMany({ lead: dup._id }, { $set: { lead: primaryLead._id } });

      // Mark duplicate lead
      dup.status = 'Duplicate Lead';
      dup.is_duplicate = true;
      dup.duplicate_of = primaryLead._id;
      dup.notes += `\nMerged into Primary Lead: ${primaryLead.lead_id || primaryLead._id}`;
      await dup.save();
    }

    primaryLead.notes = mergedNotes;
    primaryLead.tags = [...new Set([...(primaryLead.tags || []), ...additionalTags, 'Merged Lead'])];
    primaryLead.submission_count = (primaryLead.submission_count || 1) + duplicates.length;
    primaryLead.is_repeat_lead = true;
    await primaryLead.save();

    res.json({
      message: `Successfully merged ${duplicates.length} duplicate lead(s) into ${primaryLead.name} (${primaryLead.lead_id || primaryLead._id})`,
      primaryLead
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/reassign-on-leave (Requirement 3: Leave par hone wale telecaller ke leads ka automatic reassignment)
router.post('/reassign-on-leave', async (req, res) => {
  try {
    const onLeaveUsers = await User.find({ role: 'telecaller', on_leave: true }).select('_id name');
    if (onLeaveUsers.length === 0) {
      return res.json({ message: 'No telecallers currently on leave.', reassignedCount: 0 });
    }

    const leaveUserIds = onLeaveUsers.map(u => u._id);

    // Find active telecallers who are not on leave and clocked in
    let activeCallers = await User.find({
      role: 'telecaller',
      status: 'active',
      on_leave: false,
      shift_status: { $ne: 'Clocked Out' }
    }).select('_id name');

    if (activeCallers.length === 0) {
      activeCallers = await User.find({
        role: 'telecaller',
        status: 'active',
        on_leave: false
      }).select('_id name');
    }

    if (activeCallers.length === 0) {
      return res.status(400).json({ error: 'No active non-leave telecallers available for reassignment.' });
    }

    // Find open/uncontacted leads of on-leave callers
    const stuckLeads = await Lead.find({
      assigned_to: { $in: leaveUserIds },
      status: { $in: ['New', 'Fresh Lead', 'Assigned', 'Callback', 'Follow Up', 'Follow-up Required'] }
    });

    if (stuckLeads.length === 0) {
      return res.json({ message: 'No pending leads need reassignment from on-leave callers.', reassignedCount: 0 });
    }

    let callerIdx = 0;
    for (const lead of stuckLeads) {
      const assignedCaller = activeCallers[callerIdx % activeCallers.length];
      callerIdx++;

      lead.assigned_to = assignedCaller._id;
      lead.assigned_at = new Date();
      lead.notes = `${lead.notes || ''}\n[Auto-Reassigned]: Caller went on leave. Reassigned to ${assignedCaller.name}.`;
      await lead.save();

      await Notification.create({
        user: assignedCaller._id,
        title: 'Reassigned Lead from On-Leave Agent',
        message: `Lead ${lead.name} (${lead.mobile}) has been reassigned to you.`,
        type: 'NEW_LEAD'
      });
    }

    res.json({
      message: `Successfully reassigned ${stuckLeads.length} leads across ${activeCallers.length} active telecallers.`,
      reassignedCount: stuckLeads.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    lead.status = status;
    await lead.save();
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/bulk-assign
router.patch('/bulk-assign', async (req, res) => {
  try {
    if (req.user.role === 'telecaller') {
      return res.status(403).json({ error: 'Permission denied: Telecallers cannot assign leads.' });
    }

    const { leadIds, callerId } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }
    if (!callerId) {
      return res.status(400).json({ error: 'callerId is required' });
    }

    const caller = await User.findById(callerId);
    if (!caller || caller.role !== 'telecaller') {
      return res.status(400).json({ error: 'Invalid telecaller ID' });
    }

    // If Team Leader, verify the caller belongs to their team
    if (req.user.role === 'team_leader' || req.user.role === 'manager') {
      if (caller.team_leader_id && caller.team_leader_id.toString() !== req.user.id.toString()) {
        return res.status(403).json({ error: 'Permission denied: You can only assign leads to telecallers within your own team.' });
      }
    }

    await Lead.updateMany(
      { _id: { $in: leadIds } },
      { 
        $set: { 
          assigned_to: caller._id, 
          assigned_team_leader: caller.team_leader_id || (req.user.role === 'team_leader' ? req.user.id : null),
          assigned_at: new Date(),
          status: 'Assigned'
        } 
      }
    );

    await Notification.create({
      user: caller._id,
      title: 'Bulk Leads Assigned',
      message: `${leadIds.length} leads have been assigned to you by ${req.user.name}.`,
      type: 'NEW_LEAD'
    });

    res.json({ message: `${leadIds.length} leads assigned successfully to ${caller.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/transfer-caller
router.patch('/transfer-caller', async (req, res) => {
  try {
    if (req.user.role === 'telecaller') {
      return res.status(403).json({ error: 'Permission denied: Telecallers cannot transfer leads.' });
    }

    const { fromCallerId, toCallerId } = req.body;
    if (!fromCallerId || !toCallerId) {
      return res.status(400).json({ error: 'fromCallerId and toCallerId are required' });
    }

    const [fromCaller, toCaller] = await Promise.all([
      User.findById(fromCallerId),
      User.findById(toCallerId)
    ]);

    if (!fromCaller || fromCaller.role !== 'telecaller') return res.status(400).json({ error: 'Invalid fromCaller ID' });
    if (!toCaller || toCaller.role !== 'telecaller') return res.status(400).json({ error: 'Invalid toCaller ID' });

    // If Team Leader, both callers must belong to their team
    if (req.user.role === 'team_leader' || req.user.role === 'manager') {
      if (
        (fromCaller.team_leader_id && fromCaller.team_leader_id.toString() !== req.user.id.toString()) ||
        (toCaller.team_leader_id && toCaller.team_leader_id.toString() !== req.user.id.toString())
      ) {
        return res.status(403).json({ error: 'Permission denied: Team Leaders can only transfer leads within their own team.' });
      }
    }

    const result = await Lead.updateMany(
      { assigned_to: fromCaller._id },
      { 
        $set: { 
          assigned_to: toCaller._id, 
          assigned_team_leader: toCaller.team_leader_id || (req.user.role === 'team_leader' ? req.user.id : null),
          assigned_at: new Date(),
          status: 'Assigned'
        } 
      }
    );

    res.json({ message: `${result.modifiedCount} leads transferred successfully to ${toCaller.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
