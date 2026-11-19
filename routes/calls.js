const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const ImageKit = require('imagekit');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Followup = require('../models/Followup');
const { authenticateToken } = require('../middleware/auth');
const { computeLeadScore } = require('../services/leadScorer');

router.use(authenticateToken);

let imagekit = null;
if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY) {
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
  });
  console.log('ImageKit successfully configured for cloud uploads!');
} else {
  console.log('ImageKit API keys missing. Fallback local recording storage will be used.');
}

const upload = multer({ dest: 'public/recordings/' });

// POST /api/calls - Comprehensive Telecaller Outcome Logging (Requirement 4 & 6)
router.post('/', async (req, res) => {
  try {
    const {
      lead_id,
      status,
      disposition,
      remarks,
      notes,
      start_time,
      end_time,
      duration,
      followupDate,
      followupTime,
      followupReason,
      followupPriority,
      followupNotes,
      tags
    } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(lead_id)) {
      return res.status(400).json({ error: 'Invalid lead_id format' });
    }

    const lead = await Lead.findById(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const now = new Date();
    const parsedDuration = Math.max(0, parseInt(duration, 10) || 0);
    const finalRemarks = (remarks || notes || '').trim();

    const call = await Call.create({
      lead: lead._id,
      caller: req.user.id,
      status: status || 'Contacted',
      disposition: disposition || '',
      remarks: finalRemarks,
      notes: finalRemarks,
      start_time: start_time || new Date(now.getTime() - parsedDuration * 1000),
      end_time: end_time || now,
      duration: parsedDuration,
      followup_date: followupDate || null,
      followup_time: followupTime || null
    });

    if (status) {
      lead.status = status;
    }
    if (disposition) {
      lead.call_disposition = disposition;
    }
    if (finalRemarks) {
      lead.remarks = finalRemarks;
      lead.notes = lead.notes ? `${lead.notes}\n[${new Date().toLocaleDateString('en-IN')}]: ${finalRemarks}` : finalRemarks;
    }

    // Response Time & SLA Tracking (Requirement 13)
    if (!lead.first_contacted_at) {
      lead.first_contacted_at = now;
      const createdAtTime = new Date(lead.createdAt || now).getTime();
      const responseTimeSec = Math.max(0, Math.round((now.getTime() - createdAtTime) / 1000));
      lead.response_time_seconds = responseTimeSec;
      if (responseTimeSec > 900) { // 15-minute SLA breach
        lead.sla_breached = true;
      }
    }

    lead.call_attempts = (lead.call_attempts || 0) + 1;
    lead.last_contacted_at = now;

    // Automation Rule (Requirement 14): After 3 uncontacted attempts, tag for Manager Review
    const isUnconnected = ['Call Not Connected', 'Not Connected', 'Wrong Number', 'Busy', 'Switched off', 'No answer'].includes(status) ||
      ['No answer', 'Switched off', 'Number busy', 'Busy', 'Call Not Connected', 'Wrong Number'].includes(disposition);
    lead.tags = lead.tags || [];
    if (lead.call_attempts >= 3 && isUnconnected) {
      if (!lead.tags.includes('Needs Manager Review')) {
        lead.tags.push('Needs Manager Review');
      }
    }

    if (tags && Array.isArray(tags)) {
      const existingTags = lead.tags || [];
      lead.tags = [...new Set([...existingTags, ...tags])];
    }

    // Dynamic Lead Scoring (Requirement 8)
    const recentCalls = await Call.find({ lead: lead._id }).limit(10).lean();
    const { score, priority } = computeLeadScore(lead, [...recentCalls, call]);
    lead.quality_score = score;
    lead.priority = priority;

    await lead.save();

    // Update caller last_active_at
    await User.findByIdAndUpdate(req.user.id, { last_active_at: now });

    // Mark previous open followups on this lead as completed since agent just contacted them
    await Followup.updateMany(
      { lead: lead._id, completed: false },
      { $set: { completed: true } }
    );

    // Schedule next follow-up if requested OR auto-schedule on unreachable call (Requirement 6 & 14)
    let scheduledFollowup = null;
    if (followupDate && followupTime) {
      scheduledFollowup = await Followup.create({
        lead: lead._id,
        caller: req.user.id,
        date: followupDate,
        time: followupTime,
        reason: followupReason || disposition || 'Scheduled follow-up',
        priority: followupPriority || (status === 'Interested' ? 'High' : 'Medium'),
        notes: followupNotes || finalRemarks || `Follow-up on ${status}`
      });
    } else if (isUnconnected && lead.status !== 'Converted' && lead.status !== 'Lost') {
      // Automation: Auto-schedule next callback attempt 2 hours later, or tomorrow 10:00 AM
      const nextAttemptDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      if (nextAttemptDate.getHours() >= 19 || nextAttemptDate.getHours() < 9) {
        // Move to tomorrow at 10:00 AM
        nextAttemptDate.setDate(nextAttemptDate.getDate() + 1);
        nextAttemptDate.setHours(10, 0, 0, 0);
      }
      const yyyy = nextAttemptDate.getFullYear();
      const mm = String(nextAttemptDate.getMonth() + 1).padStart(2, '0');
      const dd = String(nextAttemptDate.getDate()).padStart(2, '0');
      const autoDate = `${yyyy}-${mm}-${dd}`;
      const autoTime = `${String(nextAttemptDate.getHours()).padStart(2, '0')}:${String(nextAttemptDate.getMinutes()).padStart(2, '0')}`;

      scheduledFollowup = await Followup.create({
        lead: lead._id,
        caller: req.user.id,
        date: autoDate,
        time: autoTime,
        reason: `Auto-Retry: ${disposition || status || 'Unreachable'}`,
        priority: 'Medium',
        notes: `System auto-scheduled callback after attempt #${lead.call_attempts} (${disposition || status}).`
      });
    }

    res.status(201).json({
      message: 'Call outcome and disposition logged successfully',
      callId: call._id,
      autoFollowupScheduled: !!scheduledFollowup,
      lead: {
        id: lead._id,
        lead_id: lead.lead_id,
        status: lead.status,
        call_disposition: lead.call_disposition,
        call_attempts: lead.call_attempts,
        sla_breached: lead.sla_breached,
        quality_score: lead.quality_score,
        priority: lead.priority
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/upload-recording
router.post('/upload-recording', upload.single('recording'), async (req, res) => {
  try {
    const { lead_id, call_status, duration, notes, start_time, end_time, followupDate, followupTime, followupNotes } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    let finalRecordingUrl = null;

    if (req.file) {
      if (imagekit) {
        const fileContent = fs.readFileSync(req.file.path);
        const uploadResult = await imagekit.upload({
          file: fileContent,
          fileName: `call_${Date.now()}.m4a`,
          folder: '/oilflow_crm_recordings/'
        });
        finalRecordingUrl = uploadResult.url;
        fs.unlinkSync(req.file.path);
      } else {
        finalRecordingUrl = `/recordings/${req.file.filename}`;
      }
    }

    const lead = await Lead.findById(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const now = new Date();
    const call = await Call.create({
      lead: lead._id,
      caller: req.user.id,
      status: call_status || 'Connected',
      notes: notes || '',
      start_time: start_time || now,
      end_time: end_time || now,
      duration: duration ? parseInt(duration, 10) : 0,
      recording_url: finalRecordingUrl,
      followup_date: followupDate || null,
      followup_time: followupTime || null
    });

    if (call_status) {
      lead.status = call_status;
    }
    lead.call_attempts = (lead.call_attempts || 0) + 1;
    lead.last_contacted_at = now;
    if (!lead.first_contacted_at) {
      lead.first_contacted_at = now;
    }
    await lead.save();

    await User.findByIdAndUpdate(req.user.id, { last_active_at: now });

    await Followup.updateMany(
      { lead: lead._id, completed: false },
      { $set: { completed: true } }
    );

    if (followupDate && followupTime) {
      await Followup.create({
        lead: lead._id,
        caller: req.user.id,
        date: followupDate,
        time: followupTime,
        notes: followupNotes || notes || ''
      });
    }

    res.status(201).json({ message: 'Call logged successfully', callId: call._id, recording_url: finalRecordingUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/followup
router.post('/followup', async (req, res) => {
  try {
    const { lead_id, date, time, notes } = req.body;
    if (!lead_id || !date || !time)
      return res.status(400).json({ error: 'lead_id, date, and time are required' });

    const followup = await Followup.create({
      lead: lead_id,
      caller: req.user.id,
      date,
      time,
      notes: notes || ''
    });

    res.status(201).json({ message: 'Follow-up scheduled successfully', followupId: followup._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/calls/followup/:id
router.patch('/followup/:id', async (req, res) => {
  try {
    const followup = await Followup.findById(req.params.id);
    if (!followup) return res.status(404).json({ error: 'Followup not found' });

    followup.completed = true;
    await followup.save();
    res.json({ message: 'Follow-up marked as completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calls/my-logs
router.get('/my-logs', async (req, res) => {
  try {
    const logs = await Call.find({ caller: req.user.id })
      .populate('lead', 'name mobile lead_source _id')
      .sort({ start_time: -1 })
      .limit(100)
      .lean();
    
    const mappedLogs = logs.map(call => ({
      id: call._id,
      lead_id: call.lead ? call.lead._id : null,
      lead_name: call.lead ? call.lead.name : 'Unknown',
      lead_mobile: call.lead ? call.lead.mobile : 'Unknown',
      campaign: call.lead && call.lead.lead_source ? call.lead.lead_source : 'Meta Lead Ads',
      status: call.status,
      disposition: call.disposition || '',
      remarks: call.remarks || call.notes || '',
      notes: call.notes || '',
      recording_url: call.recording_url || null,
      start_time: call.start_time,
      duration: call.duration,
      followup_date: call.followup_date || null,
      followup_time: call.followup_time || null,
      origin: 'Mobile Dialer'
    }));

    res.json(mappedLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
