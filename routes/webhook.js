const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');
const https = require('https');
const { distributeSingleLead, getOrInitSettings } = require('../services/distributor');
const { computeLeadScore } = require('../services/leadScorer');

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

// GET /api/webhooks/meta - Webhook Verification Endpoint
router.get('/meta', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  let expectedVerifyToken = META_VERIFY_TOKEN;
  try {
    const settings = await getOrInitSettings();
    if (settings?.metaConfig?.verifyToken) {
      expectedVerifyToken = settings.metaConfig.verifyToken;
    }
  } catch {
    // Fallback to env token
  }

  if (mode && token) {
    if (mode === 'subscribe' && (token === expectedVerifyToken || token === META_VERIFY_TOKEN)) {
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
  const settings = await getOrInitSettings().catch(() => null);
  const pageAccessToken = settings?.metaConfig?.accessToken || process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return res.send('Error: META_PAGE_ACCESS_TOKEN is missing in Render Environment Variables and SystemSetting.');
  }
  
  try {
    const meUrl = `https://graph.facebook.com/v21.0/me?access_token=${pageAccessToken}`;
    const meResponse = await fetchJson(meUrl);
    const pageId = meResponse.id;
    
    if (!pageId) return res.send('Failed to fetch Page ID from Facebook. Token might be invalid.');

    const postData = JSON.stringify({ subscribed_fields: ['leadgen'] });
    const reqOptions = {
      hostname: 'graph.facebook.com',
      path: `/v21.0/${pageId}/subscribed_apps?access_token=${pageAccessToken}`,
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

function extractFieldValue(fieldData, fieldNames) {
  let field = fieldData.find(f => fieldNames.includes(f.name.toLowerCase().trim()));
  if (!field) {
    field = fieldData.find(f => {
      const fname = f.name.toLowerCase().trim();
      return fieldNames.some(n => fname.includes(n) || n.includes(fname));
    });
  }
  return field && field.values && field.values.length > 0 ? field.values[0] : '';
}

function sanitizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[\s\-\(\)]/g, '');
  cleaned = cleaned.replace(/^\+91/, '').replace(/^91/, '');
  cleaned = cleaned.replace(/\D/g, '');
  if (cleaned.length === 10 && !/^0+$/.test(cleaned)) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
    if (cleaned.length === 10 && !/^0+$/.test(cleaned)) return cleaned;
  }
  return '';
}

// POST /api/webhooks/simulate - Real Live Meta Lead Ingestion Simulator
router.post('/simulate', async (req, res) => {
  try {
    const {
      name,
      mobile,
      alternate_mobile,
      city,
      state,
      business_type,
      product_interest,
      campaign_name,
      adset_name,
      ad_name,
      utm_source,
      utm_medium,
      utm_campaign,
      custom_fields,
      formId
    } = req.body;
    const settings = await getOrInitSettings();
    const formConfig = formId
      ? (settings.metaForms || []).find(f => f.formId === formId)
      : (settings.metaForms || [])[0];

    const rawPhone = mobile || '';
    let cleanMobile = sanitizePhone(rawPhone);
    let notes = `Simulated Meta Lead Ad Ingestion.`;
    let tags = [];

    if (!cleanMobile) {
      if (settings?.metaConfig?.zeroLossFallback === false) {
        return res.status(400).json({ error: 'Invalid phone number and Zero-Loss Fallback is disabled.' });
      }
      cleanMobile = rawPhone ? String(rawPhone).substring(0, 20) : '0000000000';
      notes = `[URGENT] Invalid Phone Provided (${rawPhone || 'Empty'})! Saved via Zero-Loss Fallback.\n` + notes;
      tags.push('Urgent');
    }

    const resolvedCampaign = campaign_name || formConfig?.campaignName || 'Facebook Meta Lead Ads';

    // Duplicate check by mobile
    let existingLead = null;
    if (cleanMobile && cleanMobile !== '0000000000') {
      existingLead = await Lead.findOne({ mobile: cleanMobile, is_duplicate: { $ne: true } });
    }

    if (existingLead) {
      existingLead.submission_count = (existingLead.submission_count || 1) + 1;
      existingLead.is_repeat_lead = true;
      if (!existingLead.tags.includes('Repeat Meta Enquiry')) {
        existingLead.tags.push('Repeat Meta Enquiry');
      }
      existingLead.notes = `${existingLead.notes || ''}\n[Simulated Meta Repeat Inquiry ${new Date().toLocaleDateString('en-IN')}]: ${notes}`;
      const { score, priority } = computeLeadScore(existingLead);
      existingLead.quality_score = score;
      existingLead.priority = priority;
      await existingLead.save();

      return res.status(200).json({
        success: true,
        message: 'Repeat inquiry detected and linked to existing customer record',
        lead_id: existingLead.lead_id,
        id: existingLead._id,
        name: existingLead.name,
        isRepeat: true
      });
    }

    const tempScoreData = {
      custom_fields: custom_fields || {},
      product_interest: product_interest || 'Mustard Oil (15L Tin)',
      city: city || 'Indore',
      alternate_mobile: alternate_mobile || '',
      email: '',
      status: 'New',
      createdAt: new Date()
    };
    const { score, priority } = computeLeadScore(tempScoreData);

    const newLead = await Lead.create({
      name: name || 'Meta Test Prospect',
      mobile: cleanMobile,
      alternate_mobile: alternate_mobile || '',
      city: city || 'Indore',
      state: state || 'Madhya Pradesh',
      business_type: business_type || 'Distributor',
      product_interest: product_interest || 'Mustard Oil (15L Tin)',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: resolvedCampaign,
      adset_name: adset_name || '',
      ad_name: ad_name || '',
      utm_source: utm_source || 'facebook',
      utm_medium: utm_medium || 'meta_ads',
      utm_campaign: utm_campaign || resolvedCampaign,
      custom_fields: custom_fields || {},
      status: 'New',
      quality_score: score,
      priority: priority,
      tags,
      notes
    });

    const assignedCaller = await distributeSingleLead(newLead, 'Facebook Meta Lead Ads', formConfig);
    if (formConfig) {
      const idx = (settings.metaForms || []).findIndex(f => f.formId === formConfig.formId);
      if (idx >= 0) {
        settings.metaForms[idx].leadsCaptured = (settings.metaForms[idx].leadsCaptured || 0) + 1;
        settings.metaForms[idx].lastLeadAt = new Date();
        settings.markModified('metaForms');
        await settings.save();
      }
    }

    res.status(201).json({
      success: true,
      lead_id: newLead.lead_id,
      id: newLead._id,
      name: newLead.name,
      mobile: newLead.mobile,
      assignedTo: assignedCaller ? assignedCaller.name : 'Unassigned (No Active Caller)',
      zeroLossTriggered: tags.includes('Urgent')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/meta - Receive Lead Data from Facebook/Instagram
router.post('/meta', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    const settings = await getOrInitSettings().catch(() => null);
    const pageAccessToken = settings?.metaConfig?.accessToken || process.env.META_PAGE_ACCESS_TOKEN;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.value && change.value.form_id && change.value.leadgen_id) {
          try {
            const rawLeadId = String(change.value.leadgen_id);
            const rawFormId = String(change.value.form_id);
            const formConfig = (settings?.metaForms || []).find(f => f.formId === rawFormId) || (settings?.metaForms || [])[0] || null;
            const customMapping = formConfig?.fieldMapping || {};
            
            let leadName = `Meta Lead ${rawLeadId.substring(0, 5)}`;
            let leadMobile = '';
            let leadEmail = '';
            let leadCity = '';
            let leadState = '';
            let leadBusiness = '';
            let leadProduct = '';
            let leadNotes = `Received from Meta Form ID: ${rawFormId}. Lead ID: ${rawLeadId}`;
            let tags = [];
            let customQuestionsObj = {};

            if (pageAccessToken) {
              try {
                const graphUrl = `https://graph.facebook.com/v21.0/${rawLeadId}?access_token=${pageAccessToken}`;
                const data = await fetchJson(graphUrl);
                
                if (data && data.field_data) {
                  const fields = data.field_data;

                  // Collect all raw custom questions and answers
                  for (const item of fields) {
                    if (item.name && item.values && item.values.length > 0) {
                      customQuestionsObj[item.name] = item.values[0];
                    }
                  }

                  // First apply custom fieldMapping from SystemSetting.metaForms if configured
                  const mappedValues = {};
                  for (const item of fields) {
                    const fKey = item.name;
                    const fVal = Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : '';
                    const targetCrmKey = customMapping[fKey];
                    if (targetCrmKey && fVal) {
                      mappedValues[targetCrmKey] = fVal;
                    }
                  }

                  leadName = mappedValues.name || extractFieldValue(fields, ['full_name', 'fullname', 'name', 'first_name', 'last_name', 'contact_name', 'contact name', 'naam', 'applicant_name']) || leadName;
                  const rawPhone = mappedValues.mobile || extractFieldValue(fields, [
                    'phone_number', 'phone', 'mobile', 'contact_number', 'contact number',
                    'mobile_number', 'phone number', 'mobilenumber', 'phonenumber',
                    'mob', 'cell', 'cell_number', 'whatsapp', 'whatsapp_number',
                    'number', 'contact', 'ph_no', 'phno', 'mob_no', 'mobno',
                    'फोन', 'मोबाइल', 'नंबर'
                  ]);
                  leadMobile = sanitizePhone(rawPhone);
                  
                  if (!leadMobile && rawPhone) {
                    leadMobile = rawPhone.toString().substring(0, 20);
                    leadNotes += `\n[WARNING] Number did not match standard format. Raw value: ${rawPhone}`;
                    tags.push('Urgent');
                  }
                  
                  leadEmail = mappedValues.email || extractFieldValue(fields, ['email', 'email_address']) || leadEmail;
                  leadCity = mappedValues.city || extractFieldValue(fields, ['city', 'location']) || leadCity;
                  leadState = mappedValues.state || extractFieldValue(fields, ['state', 'province']) || leadState;
                  
                  const joinAs = mappedValues.business_type || extractFieldValue(fields, ['आप_किस_रूप_में_जुड़ना_चाहते_हैं?', 'आप_किस_रूप_में_जुड़ना_चाहते_हैं', 'business_type', 'business_inquiry_type', 'business_name', 'company_name']);
                  const startWhen = mappedValues.product_interest || extractFieldValue(fields, ['आप_कब_शुरू_करना_चाहेंगे?', 'आप_कब_शुरू_करना_चाहेंगे', 'product_interest', 'product_preference', 'product', 'interest']);

                  leadBusiness = joinAs || leadBusiness;
                  leadProduct = startWhen || leadProduct;
                  if (mappedValues.notes) {
                    leadNotes += `\nForm Note: ${mappedValues.notes}`;
                  }
                  leadNotes += `\nMetadata: Form Name="${formConfig?.formName || data.form_id || rawFormId}" Platform="Meta Lead Ads"`;
                }
              } catch (fetchErr) {
                console.error('Error calling Meta Graph API:', fetchErr.message);
              }
            }

            if (!leadMobile) {
              if (settings?.metaConfig?.zeroLossFallback === false) {
                console.warn(`Dropped Meta Lead ${rawLeadId} because phone was invalid and Zero-Loss Fallback is disabled.`);
                continue;
              }
              leadMobile = '0000000000';
              leadNotes = `[URGENT] Invalid Phone Provided! Check Meta manually.\n` + leadNotes;
              if (!tags.includes('Urgent')) tags.push('Urgent');
            }

            // 1. Check for duplicate Meta Lead ID
            const existingByMetaId = await Lead.findOne({ meta_lead_id: rawLeadId });
            if (existingByMetaId) {
              console.log(`[Meta Webhook] Duplicate leadgen_id ${rawLeadId} already captured as ${existingByMetaId.lead_id}. Skipping.`);
              continue;
            }

            // 2. Check for duplicate customer inquiry by Mobile or Email
            let existingCustomer = null;
            if (leadMobile && leadMobile !== '0000000000') {
              existingCustomer = await Lead.findOne({
                mobile: leadMobile,
                is_duplicate: { $ne: true }
              }).sort({ createdAt: -1 });
            }
            if (!existingCustomer && leadEmail) {
              existingCustomer = await Lead.findOne({
                email: leadEmail,
                is_duplicate: { $ne: true }
              }).sort({ createdAt: -1 });
            }

            if (existingCustomer) {
              // Existing customer re-inquired: increment submission_count and add repeat tag
              existingCustomer.submission_count = (existingCustomer.submission_count || 1) + 1;
              existingCustomer.is_repeat_lead = true;
              if (!existingCustomer.tags.includes('Repeat Meta Enquiry')) {
                existingCustomer.tags.push('Repeat Meta Enquiry');
              }
              existingCustomer.notes = `${existingCustomer.notes || ''}\n[Repeat Meta Enquiry ${new Date().toLocaleDateString('en-IN')}]: Form=${rawFormId}. Q&A: ${JSON.stringify(customQuestionsObj)}`;
              
              const { score, priority } = computeLeadScore(existingCustomer);
              existingCustomer.quality_score = score;
              existingCustomer.priority = priority;
              await existingCustomer.save();

              if (existingCustomer.assigned_to) {
                await Notification.create({
                  user: existingCustomer.assigned_to,
                  title: 'Repeat Customer Enquiry on Meta!',
                  message: `Lead ${existingCustomer.name} (${existingCustomer.mobile}) submitted another enquiry form!`,
                  type: 'REPEAT_INQUIRY'
                });
              }
              console.log(`[Meta Webhook] Repeat enquiry from ${leadMobile} merged into ${existingCustomer.lead_id}.`);
              continue;
            }

            const resolvedCampaignName = formConfig?.campaignName || `Meta Form ${rawFormId}`;
            const tempLeadData = {
              custom_fields: customQuestionsObj,
              product_interest: leadProduct,
              city: leadCity,
              alternate_mobile: '',
              email: leadEmail,
              status: 'New',
              createdAt: new Date()
            };
            const { score, priority } = computeLeadScore(tempLeadData);

            let newLead;
            let retries = 5;
            while (retries > 0) {
              try {
                newLead = await Lead.create({
                  meta_lead_id: rawLeadId,
                  name: leadName,
                  mobile: leadMobile,
                  email: leadEmail,
                  city: leadCity,
                  state: leadState,
                  business_type: leadBusiness,
                  product_interest: leadProduct,
                  lead_source: 'Facebook Meta Lead Ads',
                  campaign_name: resolvedCampaignName,
                  ad_id: change.value?.ad_id || '',
                  adset_id: change.value?.adgroup_id || '',
                  custom_fields: customQuestionsObj,
                  status: 'New',
                  quality_score: score,
                  priority: priority,
                  tags,
                  notes: leadNotes
                });
                break;
              } catch (err) {
                if (err.code === 11000 && err.keyPattern && err.keyPattern.lead_id) {
                  retries--;
                  if (retries === 0) throw err;
                  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 400) + 100));
                } else {
                  throw err;
                }
              }
            }

            await distributeSingleLead(newLead, 'Facebook Meta Lead Ads', formConfig);

            if (settings && formConfig) {
              const idx = (settings.metaForms || []).findIndex(f => f.formId === formConfig.formId);
              if (idx >= 0) {
                settings.metaForms[idx].leadsCaptured = (settings.metaForms[idx].leadsCaptured || 0) + 1;
                settings.metaForms[idx].lastLeadAt = new Date();
              }
              settings.metaConfig.lastSyncAt = new Date();
              settings.markModified('metaForms');
              settings.markModified('metaConfig');
              await settings.save();
            }

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
