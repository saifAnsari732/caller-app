const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Secret token for Meta Webhook verification
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'OILFLOW_CRM_SECRET_2026';

// Helper function to distribute leads using cyclic round-robin
async function distributeLeads(lead) {
  const activeCallers = await User.find({ role: 'telecaller', status: 'active', on_leave: false }).sort({ _id: 1 });
  if (activeCallers.length === 0) return;

  // Find the last assigned lead to determine who should be next
  const lastLead = await Lead.findOne({ assigned_to: { $ne: null } }).sort({ assigned_at: -1 });
  let chosenCaller = activeCallers[0];

  if (lastLead) {
    const lastCallerId = lastLead.assigned_to.toString();
    const lastIndex = activeCallers.findIndex(c => c._id.toString() === lastCallerId);
    if (lastIndex !== -1) {
      const nextIndex = (lastIndex + 1) % activeCallers.length;
      chosenCaller = activeCallers[nextIndex];
    }
  }
  
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

// Helper to extract field value from Meta Lead Ads payload field_data
function extractFieldValue(fieldData, fieldNames) {
  const field = fieldData.find(f => fieldNames.includes(f.name.toLowerCase()));
  return field && field.values && field.values.length > 0 ? field.values[0] : '';
}

// POST /api/webhooks/meta - Receive Lead Data
router.post('/meta', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED'); // Acknowledge Meta immediately to avoid timeouts

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.value && change.value.form_id && change.value.leadgen_id) {
          try {
            const rawLeadId = change.value.leadgen_id;
            const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
            
            let leadName = `Meta Lead ${rawLeadId.substring(0, 5)}`;
            let leadMobile = '0000000000';
            let leadEmail = '';
            let leadCity = '';
            let leadState = '';
            let leadBusiness = '';
            let leadProduct = '';
            let leadNotes = `Received from Meta Form ID: ${change.value.form_id}. Lead ID: ${rawLeadId}`;

            // If access token is set, query Facebook Graph API to retrieve actual user values
            if (pageAccessToken) {
              try {
                const graphUrl = `https://graph.facebook.com/v20.0/${rawLeadId}?access_token=${pageAccessToken}`;
                const response = await fetch(graphUrl);
                if (response.ok) {
                  const data = await response.json();
                  if (data && data.field_data) {
                    const fields = data.field_data;
                    leadName = extractFieldValue(fields, ['full_name', 'fullname', 'name', 'first_name', 'last_name']) || leadName;
                    leadMobile = extractFieldValue(fields, ['phone_number', 'phone', 'mobile']) || leadMobile;
                    leadEmail = extractFieldValue(fields, ['email', 'email_address']) || leadEmail;
                    leadCity = extractFieldValue(fields, ['city', 'location']) || leadCity;
                    leadState = extractFieldValue(fields, ['state', 'province']) || leadState;
                    leadBusiness = extractFieldValue(fields, ['business_type', 'business_name', 'company_name']) || leadBusiness;
                    leadProduct = extractFieldValue(fields, ['product_interest', 'product', 'interest']) || leadProduct;
                    leadNotes += `\nMetadata: Form Name="${data.form_id || ''}" Platform="Meta Lead Ads"`;
                  } else {
                    console.warn(`No field_data in Graph API response for lead ${rawLeadId}:`, data);
                  }
                } else {
                  const errorText = await response.text();
                  console.error(`Failed to fetch lead data from Meta Graph API (status ${response.status}):`, errorText);
                }
              } catch (fetchErr) {
                console.error('Error calling Meta Graph API:', fetchErr.message);
              }
            } else {
              console.log('META_PAGE_ACCESS_TOKEN is missing in environment variables. Saving lead with mock data.');
            }

            const newLead = await Lead.create({
              name: leadName,
              mobile: leadMobile,
              email: leadEmail,
              city: leadCity,
              state: leadState,
              business_type: leadBusiness,
              product_interest: leadProduct,
              lead_source: 'Facebook Meta Lead Ads',
              status: 'Fresh Lead',
              notes: leadNotes
            });

            await distributeLeads(newLead);
            console.log(`Successfully received and assigned Meta lead: ${newLead.lead_id} (${newLead.name})`);
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
