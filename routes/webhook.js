const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
        } else {
          reject(new Error(`Status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

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

// GET /api/webhooks/subscribe-page - Automates Subscribing App to Page
router.get('/subscribe-page', async (req, res) => {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return res.send('Error: META_PAGE_ACCESS_TOKEN is missing in Render Environment Variables.');
  }
  
  try {
    // 1. Get Page ID
    const meUrl = `https://graph.facebook.com/v20.0/me?access_token=${pageAccessToken}`;
    const meResponse = await fetchJson(meUrl);
    const pageId = meResponse.id;
    
    if (!pageId) return res.send('Failed to fetch Page ID from Facebook. Token might be invalid.');

    // 2. Subscribe App to Page
    const postData = JSON.stringify({ subscribed_fields: ['leadgen'] });
    const reqOptions = {
      hostname: 'graph.facebook.com',
      path: `/v20.0/${pageId}/subscribed_apps?access_token=${pageAccessToken}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const subscribeReq = https.request(reqOptions, (subRes) => {
      let data = '';
      subRes.on('data', chunk => data += chunk);
      subRes.on('end', () => {
        res.send(`<h2>Meta Page Subscription Status</h2><p>Page ID: ${pageId}</p><p>Response: ${data}</p><p>If you see {"success":true}, your App is now successfully receiving leads from your Page!</p>`);
      });
    });
    subscribeReq.on('error', (e) => res.send('Error making subscription request: ' + e.message));
    subscribeReq.write(postData);
    subscribeReq.end();

  } catch (err) {
    res.send('Error: ' + err.message);
  }
});

// Helper to extract field value from Meta Lead Ads payload field_data
// Supports exact match AND partial/contains match for flexibility with Meta form field names
function extractFieldValue(fieldData, fieldNames) {
  // First try exact match
  let field = fieldData.find(f => fieldNames.includes(f.name.toLowerCase().trim()));
  // If not found, try partial/contains match
  if (!field) {
    field = fieldData.find(f => {
      const fname = f.name.toLowerCase().trim();
      return fieldNames.some(n => fname.includes(n) || n.includes(fname));
    });
  }
  return field && field.values && field.values.length > 0 ? field.values[0] : '';
}

// Sanitize phone number: remove spaces, dashes, +91, keep only digits, return '' if invalid
function sanitizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[\s\-\(\)]/g, ''); // remove spaces, dashes, brackets
  cleaned = cleaned.replace(/^\+91/, '').replace(/^91/, ''); // remove country code
  cleaned = cleaned.replace(/\D/g, ''); // keep only digits
  // Must be 10 digits and not all zeros
  if (cleaned.length === 10 && !/^0+$/.test(cleaned)) return cleaned;
  // If 11+ digits starting with 0, strip leading 0
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
    if (cleaned.length === 10 && !/^0+$/.test(cleaned)) return cleaned;
  }
  return ''; // invalid
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
            let leadMobile = ''; // will be filled from Meta Graph API
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
                const data = await fetchJson(graphUrl);
                
                if (data && data.field_data) {
                  const fields = data.field_data;
                  leadName = extractFieldValue(fields, ['full_name', 'fullname', 'name', 'first_name', 'last_name', 'contact_name', 'contact name', 'naam', 'applicant_name']) || leadName;
                  // Log all available field names for debugging
                  console.log(`[Meta Lead ${rawLeadId}] Available fields:`, fields.map(f => `${f.name}=${f.values?.[0]}`).join(', '));
                  const rawPhone = extractFieldValue(fields, [
                    'phone_number', 'phone', 'mobile', 'contact_number', 'contact number',
                    'mobile_number', 'phone number', 'mobilenumber', 'phonenumber',
                    'mob', 'cell', 'cell_number', 'whatsapp', 'whatsapp_number',
                    'number', 'contact', 'ph_no', 'phno', 'mob_no', 'mobno',
                    'फोन', 'मोबाइल', 'नंबर'
                  ]);
                  leadMobile = sanitizePhone(rawPhone);
                  leadEmail = extractFieldValue(fields, ['email', 'email_address']) || leadEmail;
                  leadCity = extractFieldValue(fields, ['city', 'location']) || leadCity;
                  leadState = extractFieldValue(fields, ['state', 'province']) || leadState;
                  
                  const joinAs = extractFieldValue(fields, ['आप_किस_रूप_में_जुड़ना_चाहते_हैं?', 'आप_किस_रूप_में_जुड़ना_चाहते_हैं', 'business_type', 'business_name', 'company_name']);
                  const startWhen = extractFieldValue(fields, ['आप_कब_शुरू_करना_चाहेंगे?', 'आप_कब_शुरू_करना_चाहेंगे', 'product_interest', 'product', 'interest']);

                  const formatMetaValue = (val) => val && typeof val === 'string' ? val.replace(/_/g, ' ').trim() : val;

                  leadBusiness = formatMetaValue(joinAs) || leadBusiness;
                  leadProduct = formatMetaValue(startWhen) || leadProduct;
                  leadNotes += `\nMetadata: Form Name="${data.form_id || ''}" Platform="Meta Lead Ads"`;
                  if (joinAs) leadNotes += `\nJoin As: ${formatMetaValue(joinAs)}`;
                  if (startWhen) leadNotes += `\nStart Time Preference: ${formatMetaValue(startWhen)}`;
                } else {
                  console.warn(`No field_data in Graph API response for lead ${rawLeadId}:`, data);
                }
              } catch (fetchErr) {
                console.error('Error calling Meta Graph API:', fetchErr.message);
              }
            } else {
              console.log('META_PAGE_ACCESS_TOKEN is missing in environment variables. Saving lead with mock data.');
            }

            // ✅ VALIDATION: Skip lead if mobile is invalid/missing
            if (!leadMobile) {
              console.warn(`[Meta Webhook] Skipping lead ${rawLeadId} — mobile number missing or invalid. Raw phone from API: "${extractFieldValue((await fetchJson(`https://graph.facebook.com/v20.0/${rawLeadId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`).catch(()=>({field_data:[]})))?.field_data || [], ['phone_number','phone','mobile'])}". Lead NOT saved.`);
              // Still log it for debugging but don't save
              continue;
            }

            let newLead;
            let retries = 5;
            while (retries > 0) {
              try {
                newLead = await Lead.create({
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
                break; // success
              } catch (err) {
                // If concurrent webhooks generate the same lead_id, wait and retry
                if (err.code === 11000 && err.keyPattern && err.keyPattern.lead_id) {
                  retries--;
                  if (retries === 0) throw err;
                  await new Promise(res => setTimeout(res, Math.floor(Math.random() * 400) + 100));
                } else {
                  throw err;
                }
              }
            }

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
