const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const { authenticateToken } = require('../middleware/auth');
const moment = require('moment');

router.use(authenticateToken);

// GET /api/dashboard/summary
router.get('/summary', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const startOfDay = moment().startOf('day').toDate();
    const endOfDay = moment().endOf('day').toDate();

    let leadQuery = {};
    let callQuery = { createdAt: { $gte: startOfDay, $lte: endOfDay } };
    let followupQuery = { date: today, completed: false };

    if (req.user.role === 'telecaller') {
      leadQuery.assigned_to = req.user.id;
      callQuery.caller = req.user.id;
      followupQuery.caller = req.user.id;
    }

    const totalLeads = await Lead.countDocuments(leadQuery);
    
    let freshQuery = { ...leadQuery, status: { $in: ['Fresh Lead', 'Assigned'] } };
    const freshLeads = await Lead.countDocuments(freshQuery);

    let interestedQuery = { ...leadQuery, status: { $in: ['Interested', 'Distributor Interested', 'Trader Interested'] } };
    const interestedLeads = await Lead.countDocuments(interestedQuery);

    const closedLeads = await Lead.countDocuments({ ...leadQuery, status: 'Closed' });
    const todayCalls = await Call.countDocuments(callQuery);
    const pendingFollowups = await Followup.countDocuments(followupQuery);

    res.json({
      total_leads: totalLeads,
      fresh_leads: freshLeads,
      interested_leads: interestedLeads,
      closed_leads: closedLeads,
      today_calls: todayCalls,
      pending_followups: pendingFollowups
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/today-followups
router.get('/today-followups', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    let query = { date: today, completed: false };
    if (req.user.role === 'telecaller') query.caller = req.user.id;

    const followups = await Followup.find(query)
      .populate('lead', 'name city mobile')
      .sort({ time: 1 })
      .lean();

    res.json({ followups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/call-stats
router.get('/call-stats', async (req, res) => {
  try {
    // Return last 7 days of call counts
    const stats = [];
    for (let i = 6; i >= 0; i--) {
      const start = moment().subtract(i, 'days').startOf('day').toDate();
      const end = moment().subtract(i, 'days').endOf('day').toDate();
      const dateStr = moment().subtract(i, 'days').format('YYYY-MM-DD');

      let q = { createdAt: { $gte: start, $lte: end } };
      if (req.user.role === 'telecaller') q.caller = req.user.id;

      const count = await Call.countDocuments(q);
      stats.push({ date: dateStr, count });
    }
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
