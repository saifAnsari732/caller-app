const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Lead = require('../models/Lead');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const { authenticateToken } = require('../middleware/auth');
const { getOrInitSettings } = require('../services/distributor');
const mongoose = require('mongoose');

function jsonToCsv(items, fields) {
  const header = fields.join(',');
  const replacer = (key, value) => (value === null || value === undefined) ? '' : value;
  const csv = [
    header,
    ...items.map(row => fields.map(fieldName => JSON.stringify(row[fieldName] ?? '', replacer)).join(','))
  ].join('\r\n');
  return csv;
}

// GET /api/reports/templates — Get WhatsApp/SMS/Email communication templates for Mobile & Web
router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const settings = await getOrInitSettings();
    res.json({ templates: settings.templates || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Admin Dashboard Stats
router.get('/admin-dashboard', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { startDate, endDate } = req.query;
    let dateMatch = {};
    if (startDate || endDate) {
      dateMatch.createdAt = {};
      if (startDate) dateMatch.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateMatch.createdAt.$lte = end;
      }
    }

    const kpisPipeline = [];
    if (Object.keys(dateMatch).length > 0) kpisPipeline.push({ $match: dateMatch });
    
    kpisPipeline.push({
      $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        freshLeads: { $sum: { $cond: [{ $eq: ['$status', 'Fresh Lead'] }, 1, 0] } },
        assignedLeads: { $sum: { $cond: [{ $eq: ['$status', 'Assigned'] }, 1, 0] } },
        interestedLeads: { $sum: { $cond: [{ $in: ['$status', ['Interested', 'DSS Interested', 'RSS Interested', 'SS Interested']] }, 1, 0] } },
        followUpLeads: { $sum: { $cond: [{ $eq: ['$status', 'Follow Up'] }, 1, 0] } },
        callbackLeads: { $sum: { $cond: [{ $eq: ['$status', 'Callback'] }, 1, 0] } },
        closedLeads: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } },
        notConnectedLeads: { $sum: { $cond: [{ $eq: ['$status', 'Not Connected'] }, 1, 0] } },
        distributorInterestedLeads: { $sum: { $cond: [{ $eq: ['$status', 'Distributor Interested'] }, 1, 0] } },
        traderInterestedLeads: { $sum: { $cond: [{ $eq: ['$status', 'Trader Interested'] }, 1, 0] } }
      }
    });
    const kpisResult = await Lead.aggregate(kpisPipeline);
    const kpis = kpisResult[0] || {};

    const chartPipeline = [
      { $match: { role: 'telecaller', status: 'active' } },
      {
        $lookup: {
          from: 'leads',
          localField: '_id',
          foreignField: 'assigned_to',
          as: 'leads'
        }
      },
      {
        $project: {
          telecallerName: '$name',
          freshLeads: { $size: { $filter: { input: '$leads', as: 'l', cond: { $eq: ['$$l.status', 'Assigned'] } } } },
          followUps: { $size: { $filter: { input: '$leads', as: 'l', cond: { $in: ['$$l.status', ['Follow Up', 'Callback']] } } } },
          interested: { $size: { $filter: { input: '$leads', as: 'l', cond: { $in: ['$$l.status', ['Interested', 'Distributor Interested', 'Trader Interested', 'DSS Interested', 'RSS Interested', 'SS Interested']] } } } },
          notConnected: { $size: { $filter: { input: '$leads', as: 'l', cond: { $eq: ['$$l.status', 'Not Connected'] } } } },
          closed: { $size: { $filter: { input: '$leads', as: 'l', cond: { $eq: ['$$l.status', 'Closed'] } } } }
        }
      }
    ];
    const chartRows = await User.aggregate(chartPipeline);

    const conversionPipeline = [];
    if (Object.keys(dateMatch).length > 0) conversionPipeline.push({ $match: dateMatch });

    conversionPipeline.push({
      $group: {
        _id: null,
        connectedCalls: { $sum: { $cond: [{ $in: ['$status', ['Interested', 'Follow Up', 'Callback', 'Distributor Interested', 'Trader Interested', 'DSS Interested', 'RSS Interested', 'SS Interested', 'Connected', 'Closed']] }, 1, 0] } },
        notConnectedCalls: { $sum: { $cond: [{ $in: ['$status', ['Not Connected', 'Wrong Number', 'Rejected']] }, 1, 0] } },
        avgDuration: { $avg: '$duration' }
      }
    });
    const convResult = await Call.aggregate(conversionPipeline);
    const convRow = convResult[0] || {};

    const ratesPipeline = [];
    const ratesMatch = { assigned_to: { $ne: null } };
    if (startDate) {
      ratesMatch.createdAt = ratesMatch.createdAt || {};
      ratesMatch.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      ratesMatch.createdAt = ratesMatch.createdAt || {};
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      ratesMatch.createdAt.$lte = end;
    }
    ratesPipeline.push({ $match: ratesMatch });
    ratesPipeline.push({
      $group: {
        _id: null,
        totalAssigned: { $sum: 1 },
        totalConverted: { $sum: { $cond: [{ $in: ['$status', ['Closed', 'Distributor Interested', 'Trader Interested']] }, 1, 0] } }
      }
    });
    const ratesResult = await Lead.aggregate(ratesPipeline);
    const rateRow = ratesResult[0] || {};

    const connected = convRow.connectedCalls || 0;
    const notConnected = convRow.notConnectedCalls || 0;
    const totalCalls = connected + notConnected;
    const avgTalkTime = Math.round(convRow.avgDuration || 0);
    const assigned = rateRow.totalAssigned || 0;
    const converted = rateRow.totalConverted || 0;
    const conversionRate = assigned > 0 ? parseFloat(((converted / assigned) * 100).toFixed(1)) : 0.0;

    // Top performer calculations from chartRows
    const sortedByClosed = [...chartRows].sort((a, b) => (b.closed || 0) - (a.closed || 0));
    const sortedByInterested = [...chartRows].sort((a, b) => (b.interested || 0) - (a.interested || 0));

    res.json({
      kpis,
      performanceChart: chartRows,
      conversionAnalytics: {
        connectedCalls: connected,
        notConnectedCalls: notConnected,
        totalCalls,
        conversionRate,
        avgTalkTime
      },
      rankings: {
        topPerformer: sortedByInterested[0]?.telecallerName || 'N/A',
        topCloser: sortedByClosed[0]?.telecallerName || 'N/A',
        topTelecaller: sortedByClosed[0]?.telecallerName || 'N/A'
      }
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to generate dashboard data' });
  }
});

// 1.5. Team Leader Dashboard Stats & Leaderboard (RBAC: Team Leader only sees own team, Admin can see any team)
router.get('/team-leader-dashboard', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'telecaller') {
      return res.status(403).json({ error: 'Forbidden: Team Leader or Admin access required' });
    }

    let teamLeaderId = req.user.id;
    if (req.user.role === 'admin' && req.query.team_leader_id) {
      teamLeaderId = req.query.team_leader_id;
    }

    const tlDoc = await User.findById(teamLeaderId);
    if (!tlDoc) return res.status(404).json({ error: 'Team Leader not found' });

    // Fetch team telecallers
    const teamTelecallers = await User.find({
      $or: [
        { team_leader_id: teamLeaderId },
        { team: tlDoc.team, role: 'telecaller' }
      ]
    }).lean();

    const telecallerIds = teamTelecallers.map(t => t._id);
    const allMemberIds = [tlDoc._id, ...telecallerIds];

    // Team Leads Filter
    const teamLeadsFilter = {
      $or: [
        { assigned_team_leader: tlDoc._id },
        { assigned_to: { $in: allMemberIds } }
      ]
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const clientDate = req.query.clientDate || new Date().toISOString().split('T')[0];

    const [
      teamTotalLeads,
      newLeads,
      uncontactedLeads,
      interestedLeads,
      qualifiedLeads,
      convertedLeads,
      lostLeads,
      leadsList,
      teamCalls,
      teamFollowups
    ] = await Promise.all([
      Lead.countDocuments(teamLeadsFilter),
      Lead.countDocuments({ ...teamLeadsFilter, status: { $in: ['New', 'Fresh Lead', 'Assigned'] } }),
      Lead.countDocuments({ ...teamLeadsFilter, call_attempts: { $lte: 0 } }),
      Lead.countDocuments({ ...teamLeadsFilter, status: { $in: ['Interested', 'DSS Interested', 'RSS Interested', 'SS Interested'] } }),
      Lead.countDocuments({ ...teamLeadsFilter, status: 'Qualified' }),
      Lead.countDocuments({ ...teamLeadsFilter, status: { $in: ['Converted', 'Closed'] } }),
      Lead.countDocuments({ ...teamLeadsFilter, status: { $in: ['Lost', 'Not Interested', 'Rejected', 'Invalid Lead', 'Duplicate Lead'] } }),
      Lead.find(teamLeadsFilter).select('response_time_seconds sla_breached assigned_to status').lean(),
      Call.find({ caller: { $in: allMemberIds } }).lean(),
      Followup.find({ caller: { $in: allMemberIds }, completed: false }).lean()
    ]);

    // Average first response time
    const validResponses = leadsList.filter(l => l.response_time_seconds && l.response_time_seconds > 0);
    const avgResponseTimeMin = validResponses.length > 0
      ? Math.round(validResponses.reduce((acc, curr) => acc + curr.response_time_seconds, 0) / validResponses.length / 60)
      : 8;

    // Follow-ups breakdown
    let todayFollowupsCount = 0;
    let overdueFollowupsCount = 0;
    teamFollowups.forEach(f => {
      if (f.date === clientDate) todayFollowupsCount++;
      else if (f.date < clientDate) overdueFollowupsCount++;
    });

    // Calls breakdown
    const totalCalls = teamCalls.length;
    const connectedCalls = teamCalls.filter(c => c.status === 'completed' || (c.duration && c.duration > 0)).length;
    const todaysCalls = teamCalls.filter(c => {
      const cDate = c.start_time || c.createdAt;
      return cDate && new Date(cDate) >= todayStart && new Date(cDate) <= todayEnd;
    }).length;

    // Daily target versus completed calls
    const teamDailyTarget = teamTelecallers.reduce((acc, t) => acc + (t.daily_call_target || 50), 0);
    const targetProgressPct = teamDailyTarget > 0 ? Math.min(100, Math.round((todaysCalls / teamDailyTarget) * 100)) : 0;
    const conversionRate = teamTotalLeads > 0 ? parseFloat(((convertedLeads / teamTotalLeads) * 100).toFixed(1)) : 0;

    // Telecaller Leaderboard
    const leaderboard = teamTelecallers.map(tc => {
      const tcCalls = teamCalls.filter(c => c.caller?.toString() === tc._id.toString());
      const tcConnected = tcCalls.filter(c => c.status === 'completed' || (c.duration && c.duration > 0)).length;
      const tcLeads = leadsList.filter(l => l.assigned_to?.toString() === tc._id.toString());
      const tcInterested = tcLeads.filter(l => ['Interested', 'DSS Interested', 'RSS Interested', 'SS Interested'].includes(l.status)).length;
      const tcConverted = tcLeads.filter(l => ['Converted', 'Closed'].includes(l.status)).length;
      const tcRate = tcLeads.length > 0 ? parseFloat(((tcConverted / tcLeads.length) * 100).toFixed(1)) : 0;

      return {
        id: tc._id,
        name: tc.name,
        employee_id: tc.employee_id,
        mobile: tc.mobile,
        shift_status: tc.shift_status || 'Clocked In',
        daily_call_target: tc.daily_call_target || 50,
        calls: tcCalls.length,
        connected: tcConnected,
        interested: tcInterested,
        converted: tcConverted,
        totalLeads: tcLeads.length,
        conversionRate: tcRate
      };
    });

    // Sort leaderboard by converted DESC, connected DESC, calls DESC
    leaderboard.sort((a, b) => b.converted - a.converted || b.connected - a.connected || b.calls - a.calls);
    leaderboard.forEach((item, idx) => { item.rank = idx + 1; });

    res.json({
      teamLeader: {
        id: tlDoc._id,
        name: tlDoc.name,
        email: tlDoc.email,
        mobile: tlDoc.mobile,
        team: tlDoc.team,
        employee_id: tlDoc.employee_id
      },
      kpis: {
        teamTotalLeads,
        newLeads,
        uncontactedLeads,
        todayFollowupsCount,
        overdueFollowupsCount,
        totalCalls,
        connectedCalls,
        todaysCalls,
        interestedLeads,
        qualifiedLeads,
        convertedLeads,
        lostLeads,
        conversionRate,
        avgFirstResponseTimeMinutes: avgResponseTimeMin,
        teamDailyTarget,
        targetProgressPct
      },
      leaderboard,
      telecallers: teamTelecallers.map(t => ({
        id: t._id,
        name: t.name,
        employee_id: t.employee_id,
        mobile: t.mobile,
        daily_call_target: t.daily_call_target,
        shift_status: t.shift_status
      }))
    });
  } catch (err) {
    console.error('Team Leader dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Telecaller Dashboard Stats (My Dashboard) - Comprehensive 12-Metric Engine (Requirement 1)
router.get('/telecaller-dashboard', authenticateToken, async (req, res) => {
  try {
    const callerId = req.user.id;
    const callerObjectId = new mongoose.Types.ObjectId(callerId);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const clientDate = req.query.todayDate || new Date().toISOString().split('T')[0];

    // 1. Core KPIs Aggregate
    const kpisPipeline = [
      { $match: { assigned_to: callerObjectId } },
      {
        $group: {
          _id: null,
          assignedLeads: { $sum: 1 },
          todayAssignedLeads: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $gte: ['$assigned_at', startOfToday] },
                    { $gte: ['$createdAt', startOfToday] }
                  ]
                },
                1,
                0
              ]
            }
          },
          newUncontactedLeads: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$call_attempts', 0] },
                    { $in: ['$status', ['New', 'Fresh Lead', 'Assigned', 'Fresh Inquiry']] }
                  ]
                },
                1,
                0
              ]
            }
          },
          freshLeads: { $sum: { $cond: [{ $in: ['$status', ['New', 'Fresh Lead', 'Assigned', 'Fresh Inquiry']] }, 1, 0] } },
          followUps: { $sum: { $cond: [{ $in: ['$status', ['Follow Up', 'Follow-up Required', 'Callback Scheduled']] }, 1, 0] } },
          interested: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    [
                      'Interested', 'Qualified', 'Demo/Meeting Scheduled',
                      'Payment Pending', 'Distributor Interested', 'Trader Interested',
                      'DSS Interested', 'RSS Interested', 'SS Interested'
                    ]
                  ]
                },
                1,
                0
              ]
            }
          },
          callbackLeads: { $sum: { $cond: [{ $in: ['$status', ['Callback', 'Callback Scheduled']] }, 1, 0] } },
          notConnected: { $sum: { $cond: [{ $in: ['$status', ['Not Connected', 'Call Not Connected', 'Busy', 'Wrong Number']] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $in: ['$status', ['Closed', 'Converted']] }, 1, 0] } },
          lostLeads: { $sum: { $cond: [{ $in: ['$status', ['Lost', 'Not Interested', 'Rejected', 'Duplicate Lead', 'Invalid Lead']] }, 1, 0] } },
          distributorInterested: { $sum: { $cond: [{ $eq: ['$status', 'Distributor Interested'] }, 1, 0] } },
          traderInterested: { $sum: { $cond: [{ $eq: ['$status', 'Trader Interested'] }, 1, 0] } },
          totalContactedLeads: {
            $sum: {
              $cond: [{ $gt: ['$call_attempts', 0] }, 1, 0]
            }
          },
          totalResponseTimeSec: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$response_time_seconds', null] }, { $gt: ['$response_time_seconds', 0] }] },
                '$response_time_seconds',
                0
              ]
            }
          },
          leadsWithResponseTime: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$response_time_seconds', null] }, { $gt: ['$response_time_seconds', 0] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ];
    const kpisResult = await Lead.aggregate(kpisPipeline);
    const kpis = kpisResult[0] || {};

    // 2. Today's calls counts (Total, Connected, Not Connected)
    const todaysCalls = await Call.find({
      caller: callerObjectId,
      start_time: { $gte: startOfToday }
    }).select('duration status disposition').lean();

    const todaysCallsCount = todaysCalls.length;
    let connectedCalls = 0;
    let notConnectedCalls = 0;

    for (const c of todaysCalls) {
      const dur = c.duration || 0;
      const st = (c.status || '').toLowerCase();
      const disp = (c.disposition || '').toLowerCase();

      if (
        dur > 0 ||
        st.includes('connect') ||
        st.includes('interest') ||
        disp.includes('connect') ||
        disp.includes('interest') ||
        st.includes('qualified') ||
        st.includes('converted') ||
        st.includes('closed')
      ) {
        connectedCalls++;
      } else {
        notConnectedCalls++;
      }
    }

    // 3. Followup counts (Today's Follow-ups vs Overdue Follow-ups)
    const [todayFollowupsCount, overdueFollowupsCount] = await Promise.all([
      Followup.countDocuments({ caller: callerObjectId, date: clientDate, completed: false }),
      Followup.countDocuments({ caller: callerObjectId, date: { $lt: clientDate }, completed: false })
    ]);

    // 4. User profile & targets
    const userDoc = await User.findById(callerId)
      .select('shift_status daily_call_target daily_conversion_target on_leave max_lead_limit employee_id team name')
      .lean();

    const dailyCallTarget = userDoc?.daily_call_target || 50;
    const dailyConversionTarget = userDoc?.daily_conversion_target || 5;
    const targetProgressPct = Math.min(100, Math.round((todaysCallsCount / dailyCallTarget) * 100));

    // 5. Conversion Rate Calculation
    const totalAssigned = kpis.assignedLeads || 0;
    const convertedCount = kpis.closed || 0;
    const conversionPercentage = totalAssigned > 0
      ? Number(((convertedCount / totalAssigned) * 100).toFixed(1))
      : 0;

    // 6. Lead Response Time (Average Minutes)
    let leadResponseTimeMinutes = 12; // default standard
    if (kpis.leadsWithResponseTime > 0) {
      leadResponseTimeMinutes = Math.max(1, Math.round((kpis.totalResponseTimeSec / kpis.leadsWithResponseTime) / 60));
    }

    // 7. Recent Activities
    const recentActivities = await Call.find({ caller: callerId })
      .populate('lead', 'name mobile lead_id')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const mappedActivities = recentActivities.map(a => ({
      ...a,
      lead_name: a.lead?.name || 'Customer',
      lead_mobile: a.lead?.mobile || '',
      lead_id: a.lead?.lead_id || '',
      id: a._id
    }));

    // 8. Followups list for dashboard quick action
    const followups = await Followup.find({ caller: callerId, date: { $lte: clientDate }, completed: false })
      .populate('lead', 'name mobile city priority lead_id product_interest')
      .sort({ date: 1, time: 1 })
      .limit(8)
      .lean();

    const mappedFollowups = followups.map(f => ({
      ...f,
      lead: f.lead?._id || f.lead,
      lead_id: f.lead?.lead_id || '',
      lead_name: f.lead?.name || 'Lead',
      lead_mobile: f.lead?.mobile || '',
      lead_city: f.lead?.city || '',
      lead_priority: f.lead?.priority || 'Normal',
      lead_product: f.lead?.product_interest || '',
      isOverdue: f.date < clientDate,
      id: f._id
    }));

    res.json({
      kpis: {
        // 12 Core Requirements:
        assignedLeads: totalAssigned,
        todayAssignedLeads: kpis.todayAssignedLeads || 0,
        newUncontactedLeads: kpis.newUncontactedLeads || 0,
        freshLeads: kpis.freshLeads || 0,
        todayFollowupsCount,
        overdueFollowupsCount,
        followUps: kpis.followUps || 0,
        connectedCalls,
        notConnectedCalls,
        interestedLeads: kpis.interested || 0,
        interested: kpis.interested || 0,
        convertedLeads: convertedCount,
        closed: convertedCount,
        lostLeads: kpis.lostLeads || 0,
        todaysCallsCount,
        dailyCallTarget,
        dailyConversionTarget,
        targetProgressPct,
        leadResponseTimeMinutes,
        conversionPercentage,
        shiftStatus: userDoc?.shift_status || 'Clocked In',
        employeeId: userDoc?.employee_id || '',
        team: userDoc?.team || 'North Region Sales',
        onLeave: Boolean(userDoc?.on_leave)
      },
      recentActivities: mappedActivities,
      todaysFollowups: mappedFollowups
    });
  } catch (error) {
    console.error('Telecaller dashboard error:', error);
    res.status(500).json({ error: 'Failed to generate dashboard data' });
  }
});

// 3. Export Reports in CSV or JSON Format
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const filter = req.user.role === 'telecaller' ? { assigned_to: req.user.id } : {};
    const leads = await Lead.find(filter).populate('assigned_to', 'name mobile').sort({ createdAt: -1 }).lean();

    const rows = leads.map(l => ({
      lead_id: l.lead_id || '',
      name: l.name || '',
      mobile: l.mobile || '',
      city: l.city || '',
      state: l.state || '',
      business_type: l.business_type || '',
      product_interest: l.product_interest || '',
      lead_source: l.lead_source || '',
      status: l.status || '',
      assigned_to: l.assigned_to?.name || 'Unassigned',
      call_attempts: l.call_attempts || 0,
      created_at: l.createdAt ? new Date(l.createdAt).toISOString() : ''
    }));

    const fields = ['lead_id', 'name', 'mobile', 'city', 'state', 'business_type', 'product_interest', 'lead_source', 'status', 'assigned_to', 'call_attempts', 'created_at'];
    const csv = jsonToCsv(rows, fields);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/my-reports
router.get('/my-reports', authenticateToken, async (req, res) => {
  try {
    const callerId = new mongoose.Types.ObjectId(req.user.id);
    
    const clientStartDateStr = req.query.startDate || new Date().toISOString().split('T')[0];
    const clientEndDateStr = req.query.endDate || new Date().toISOString().split('T')[0];
    
    const startDate = new Date(clientStartDateStr);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(clientEndDateStr);
    endDate.setHours(23, 59, 59, 999);

    const pipeline = [
      { $match: { caller: callerId, start_time: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          connectedCalls: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $gt: ['$duration', 0] },
                    {
                      $in: [
                        '$status',
                        ['Connected', 'Interested', 'Follow Up', 'Follow-up Required', 'Callback', 'Qualified', 'Converted', 'Closed', 'Demo/Meeting Scheduled']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          unconnectedCalls: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$duration', 0] },
                    {
                      $in: [
                        '$status',
                        ['Not Connected', 'Call Not Connected', 'No answer', 'Switched off', 'Busy', 'Wrong Number']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          totalCallTime: { $sum: '$duration' },
          avgCallDuration: { $avg: '$duration' },
          firstCallTime: { $min: '$start_time' }
        }
      }
    ];

    const result = await Call.aggregate(pipeline);
    const callStats = result[0] || {
      totalCalls: 0,
      connectedCalls: 0,
      unconnectedCalls: 0,
      totalCallTime: 0,
      avgCallDuration: 0,
      firstCallTime: null
    };

    const kpisPipeline = [
      { $match: { assigned_to: callerId } },
      {
        $group: {
          _id: null,
          totalAssigned: { $sum: 1 },
          followUps: { $sum: { $cond: [{ $in: ['$status', ['Follow Up', 'Follow-up Required', 'Callback']] }, 1, 0] } },
          interested: { $sum: { $cond: [{ $in: ['$status', ['Interested', 'Qualified', 'Demo/Meeting Scheduled', 'Payment Pending', 'Distributor Interested', 'Trader Interested', 'DSS Interested', 'RSS Interested', 'SS Interested']] }, 1, 0] } },
          callbackLeads: { $sum: { $cond: [{ $in: ['$status', ['Callback', 'Callback Scheduled']] }, 1, 0] } },
          notConnectedLeads: { $sum: { $cond: [{ $in: ['$status', ['Not Connected', 'Call Not Connected', 'Busy', 'Wrong Number']] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $in: ['$status', ['Closed', 'Converted']] }, 1, 0] } },
          lostLeads: { $sum: { $cond: [{ $in: ['$status', ['Lost', 'Not Interested', 'Rejected', 'Duplicate Lead', 'Invalid Lead']] }, 1, 0] } },
          distributorInterested: { $sum: { $cond: [{ $eq: ['$status', 'Distributor Interested'] }, 1, 0] } },
          traderInterested: { $sum: { $cond: [{ $eq: ['$status', 'Trader Interested'] }, 1, 0] } }
        }
      }
    ];
    const kpisResult = await Lead.aggregate(kpisPipeline);
    const leadStats = kpisResult[0] || {};

    const assigned = leadStats.totalAssigned || 0;
    const closed = leadStats.closed || 0;
    const conversionRate = assigned > 0 ? Number(((closed / assigned) * 100).toFixed(1)) : 0;

    res.json({
      ...callStats,
      avgCallDuration: Math.round(callStats.avgCallDuration || 0),
      leadStats: {
        ...leadStats,
        conversionRate
      }
    });
  } catch (error) {
    console.error('My reports error:', error);
    res.status(500).json({ error: 'Failed to generate my reports data' });
  }
});

module.exports = router;
