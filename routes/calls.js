const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const ImageKit = require('imagekit');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const Followup = require('../models/Followup');
const { authenticateToken } = require('../middleware/auth');
 
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

// POST /api/calls
router.post('/', async (req, res) => {
  try {
    const { lead_id, status, notes, start_time, end_time, duration, followupDate, followupTime, followupNotes } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    const lead = await Lead.findById(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const call = await Call.create({
      lead: lead._id,
      caller: req.user.id,
      status: status || 'Unknown',
      notes: notes || '',
      start_time: start_time || new Date(),
      end_time: end_time || new Date(),
      duration: duration ? parseInt(duration) : 0,
      followup_date: followupDate || null,
      followup_time: followupTime || null
    });

    if (status) {
      lead.status = status;
      await lead.save();
    }

    if (followupDate && followupTime) {
      await Followup.create({
        lead: lead._id,
        caller: req.user.id,
        date: followupDate,
        time: followupTime,
        notes: followupNotes || ''
      });
    }

    res.status(201).json({ message: 'Call logged successfully', callId: call._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/upload-recording
router.post('/upload-recording', upload.single('recording'), async (req, res) => {
  try {
    const { lead_id, call_status, duration, notes, start_time, end_time } = req.body;
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
        fs.unlinkSync(req.file.path); // remove temp file
      } else {
        finalRecordingUrl = `/recordings/${req.file.filename}`;
      }
    }

    const lead = await Lead.findById(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const call = await Call.create({
      lead: lead._id,
      caller: req.user.id,
      status: call_status || 'Unknown',
      notes: notes || '',
      start_time: start_time || new Date(),
      end_time: end_time || new Date(),
      duration: duration ? parseInt(duration) : 0,
      recording_url: finalRecordingUrl
    });

    if (call_status) {
      lead.status = call_status;
      await lead.save();
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
      date, time, notes
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
      .populate('lead', 'name mobile lead_source')
      .sort({ start_time: -1 })
      .lean();
    
    // Map data for mobile frontend
    const mappedLogs = logs.map(call => ({
      id: call._id,
      lead_name: call.lead ? call.lead.name : 'Unknown',
      lead_mobile: call.lead ? call.lead.mobile : 'Unknown',
      campaign: call.lead && call.lead.lead_source ? call.lead.lead_source : 'Manual Entry',
      status: call.status,
      notes: call.notes || '',
      recording_url: call.recording_url || null,
      start_time: call.start_time,
      duration: call.duration,
      followup_date: call.followup_date || null,
      followup_time: call.followup_time || null,
      origin: 'External Dialer'
    }));

    res.json(mappedLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
