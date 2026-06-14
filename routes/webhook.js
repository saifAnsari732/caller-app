const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Secret token for Meta Webhook verification
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'OILFLOW_CRM_SECRET_2026';

// Helper function to distribute leads
async function distributeLeads(lead) {
  const activeCallers = await User.find({ role: 'telecaller', status: 'active', on_leave: false }).sort({ _id: 1 });
  if (activeCallers.length === 0) return;

  let assignedCounts = {};
  for (let caller of activeCallers) {
    assignedCounts[caller._id.toString()] = await Lead.countDocuments({ assigned_to: caller._id });
  }

  // Find the caller with the fewest leads
  activeCallers.sort((a, b) => assignedCounts[a._id.toString()] - assignedCounts[b._id.toString()]);
  const chosenCaller = activeCallers[0];
  
  lead.assigned_to = chosenCaller._id;
  lead.assigned_at = new Date();
  lead.status = 'Assigned';
  await lead.save();

  await Notification.create({
    user: chosenCaller._id,
    title: 'New Lead Assigned',
    message: `Lead ${lead.name} (${lead.city || 'Unknown City'}) from Meta Ads has been assigned to you.`,
    type: 'NEW_LEAD'
  });
}

// GET /api/webhooks/meta - Webhook Verification Endpoint
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// POST /api/webhooks/meta - Receive Lead Data
router.post('/meta', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED'); // Acknowledge Meta immediately to avoid timeouts

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.value && change.value.form_id && change.value.leadgen_id) {
          try {
            // Note: To get the actual lead details, we would typically need to make a Graph API call 
            // using the leadgen_id and a Page Access Token.
            // For now, we will save the raw lead ID and simulate the parsing,
            // as this requires a live Facebook App setup and Token.
            
            // Example parsing of dummy data provided in webhook test payload
            const rawLeadId = change.value.leadgen_id;
            
            // In a real scenario, fetch actual lead data using Axios and Graph API here
            // const response = await axios.get(`https://graph.facebook.com/v19.0/${rawLeadId}?access_token=${PAGE_ACCESS_TOKEN}`);
            // const fieldData = response.data.field_data;
            
            // Mocking the parsed data since we don't have Graph API access token right now
            const newLead = await Lead.create({
              name: `Meta Lead ${rawLeadId.substring(0, 5)}`,
              mobile: '0000000000', // To be extracted from Graph API
              lead_source: 'Facebook Meta Lead Ads',
              status: 'Fresh Lead',
              notes: `Received from Meta Form ID: ${change.value.form_id}`
            });

            await distributeLeads(newLead);
            console.log(`Successfully received and assigned Meta lead: ${newLead.lead_id}`);
          } catch (error) {
            console.error('Error processing Meta Webhook Lead:', error);
          }
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

module.exports = router;
