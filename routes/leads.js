const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

let isDistributing = false;

// Distribute fresh leads using cyclic round-robin with Mutex to prevent race conditions on concurrent webhooks
async function distributeLeads() {
  if (isDistributing) return;
  isDistributing = true;

  try {
    let freshLeads = await Lead.find({ status: 'Fresh Lead', assigned_to: null }).sort({ _id: 1 });
    
    while (freshLeads.length > 0) {
      const activeCallers = await User.find({ role: 'telecaller', status: 'active', on_leave: false }).sort({ _id: 1 });
      if (activeCallers.length === 0) break;

      // Find the last assigned lead to determine who should be next
      const lastLead = await Lead.findOne({ assigned_to: { $ne: null } }).sort({ assigned_at: -1 });
      let lastCallerId = lastLead ? lastLead.assigned_to.toString() : null;
      let lastIndex = lastCallerId ? activeCallers.findIndex(c => c._id.toString() === lastCallerId) : -1;

      for (let lead of freshLeads) {
        const nextIndex = (lastIndex + 1) % activeCallers.length;
        const chosenCaller = activeCallers[nextIndex];
        
        lead.assigned_to = chosenCaller._id;
        lead.assigned_at = new Date();
        lead.status = 'Assigned';
        await lead.save();

        lastIndex = nextIndex; // Update index for the next lead in the batch

        await Notification.create({
          user: chosenCaller._id,
          title: 'New Lead Assigned',
          message: `Lead ${lead.name} (${lead.city || 'Unknown City'}) has been assigned to you.`,
          type: 'NEW_LEAD'
        });
      }

      // Re-fetch to see if any new leads arrived while we were processing this batch
      freshLeads = await Lead.find({ status: 'Fresh Lead', assigned_to: null }).sort({ _id: 1 });
    }
  } catch (error) {
    console.error('Error in distributeLeads:', error);
  } finally {
    isDistributing = false;
  }
}

// GET /api/leads  — get leads (admin sees all, telecaller sees own)
router.get('/', async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'telecaller') filter.assigned_to = req.user.id;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.business_type) filter.business_type = req.query.business_type;

    // Search query (name, mobile, city)
    if (req.query.query) {
      const searchRegex = new RegExp(req.query.query, 'i');
      filter.$or = [
        { name: searchRegex },
        { mobile: searchRegex },
        { city: searchRegex }
      ];
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        // Set to end of the day
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const leads = await Lead.find(filter)
      .populate('assigned_to', 'name employee_id')
      .sort({ createdAt: -1 })
      .lean();

    const mappedLeads = leads.map(l => ({ ...l, id: l._id }));
    res.json({ leads: mappedLeads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id  — details + timeline
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assigned_to', 'name employee_id').lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (req.user.role === 'telecaller' && lead.assigned_to?._id.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
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
    
    // Lead Created
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
        title: `Call: ${call.status}`,
        date: call.start_time,
        description: `Talk time: ${call.duration}s. ${call.notes || ''}`,
        recording: !!call.recording_url
      });
    });

    mappedFollowups.forEach(f => {
      timeline.push({
        type: 'FOLLOWUP',
        title: 'Follow-up Scheduled',
        date: f.createdAt || new Date(),
        description: `Scheduled for ${f.date} at ${f.time}. ${f.notes || ''}`
      });
    });

    // Sort timeline by date descending
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ lead, calls: mappedCalls, followups: mappedFollowups, timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads  — create manually
router.post('/', async (req, res) => {
  try {
    const { name, mobile, email, city, state, business_type, product_interest, lead_source } = req.body;
    if (!name || !mobile) return res.status(400).json({ error: 'Name and mobile are required' });

    const newLead = await Lead.create({
      name, mobile, email, city, state, business_type, product_interest,
      lead_source: lead_source || 'Manual Entry',
      status: 'Fresh Lead'
    });

    await distributeLeads(); // Auto distribute immediately
    res.status(201).json({ message: 'Lead added successfully', leadId: newLead._id });
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

module.exports = router;
