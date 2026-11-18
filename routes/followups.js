const express = require('express');
const router = express.Router();
const Followup = require('../models/Followup');
const Lead = require('../models/Lead');
const { authenticateToken } = require('../middleware/auth');

// 1. Get Followups grouped by Today, Tomorrow, This Week, Upcoming, Overdue (Requirement 6)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isTelecaller = req.user.role === 'telecaller';
    const clientDate = req.query.todayDate || new Date().toISOString().split('T')[0];

    // Compute Tomorrow & This Week date strings
    const tomDate = new Date();
    tomDate.setDate(tomDate.getDate() + 1);
    const tomorrowStr = tomDate.toISOString().split('T')[0];

    const weekEndDate = new Date();
    weekEndDate.setDate(weekEndDate.getDate() + 7);
    const weekEndStr = weekEndDate.toISOString().split('T')[0];

    const filter = { completed: false };
    if (isTelecaller) {
      filter.caller = req.user.id;
    }

    const followups = await Followup.find(filter)
      .populate('lead', 'name mobile alternate_mobile city priority lead_id product_interest')
      .populate('caller', 'name')
      .sort({ date: 1, time: 1 })
      .limit(300)
      .lean();

    const today = [];
    const tomorrow = [];
    const thisWeek = [];
    const upcoming = [];
    const overdue = [];
    const completed = [];

    followups.forEach(item => {
      item.lead_name = item.lead?.name || 'Lead';
      item.lead_mobile = item.lead?.mobile || '';
      item.lead_alt = item.lead?.alternate_mobile || '';
      item.lead_city = item.lead?.city || '';
      item.lead_priority = item.lead?.priority || 'Normal';
      item.lead_product = item.lead?.product_interest || '';
      item.lead_code = item.lead?.lead_id || '';
      item.caller_name = item.caller?.name || 'Telecaller';
      item.id = item._id;
      item.reason = item.reason || 'Follow-up Call';
      item.priority = item.priority || 'Medium';

      if (item.completed) {
        completed.push(item);
      } else if (item.date < clientDate) {
        overdue.push(item);
      } else if (item.date === clientDate) {
        today.push(item);
      } else {
        if (item.date === tomorrowStr) {
          tomorrow.push(item);
        }
        if (item.date <= weekEndStr) {
          thisWeek.push(item);
        }
        upcoming.push(item);
      }
    });

    res.json({
      today,
      tomorrow,
      thisWeek,
      upcoming,
      overdue,
      completed
    });
  } catch (error) {
    console.error('Followups fetch error:', error);
    res.status(500).json({ error: 'Database error fetching follow-ups' });
  }
});

// 2. Create a Follow-up
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { lead_id, date, time, notes, reason, priority } = req.body;
    const caller_id = req.user.id;

    if (!lead_id || !date || !time) {
      return res.status(400).json({ error: 'lead_id, date, and time are required' });
    }

    const followup = new Followup({
      lead: lead_id,
      caller: caller_id,
      date,
      time,
      notes: notes || '',
      reason: reason || 'Scheduled follow-up',
      priority: priority || 'Medium',
      completed: false
    });
    await followup.save();

    // Update lead status to Follow Up / Callback if it isn't already set
    const lead = await Lead.findById(lead_id);
    if (lead && lead.status === 'Assigned') {
      lead.status = 'Follow Up';
      await lead.save();
    }

    res.status(201).json({ 
      message: 'Follow-up created successfully',
      followupId: followup._id
    });
  } catch (error) {
    console.error('Followup creation error:', error);
    res.status(500).json({ error: 'Database error creating follow-up' });
  }
});

// 3. Mark Follow-up as Completed
router.patch('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isTelecaller = req.user.role === 'telecaller';

    const filter = { _id: id };
    if (isTelecaller) {
      filter.caller = req.user.id;
    }

    const followup = await Followup.findOne(filter);
    if (!followup) return res.status(404).json({ error: 'Follow-up not found or access denied' });

    followup.completed = true;
    await followup.save();

    res.json({ message: 'Follow-up marked as completed' });
  } catch (error) {
    console.error('Followup completion error:', error);
    res.status(500).json({ error: 'Database error completing follow-up' });
  }
});

module.exports = router;
