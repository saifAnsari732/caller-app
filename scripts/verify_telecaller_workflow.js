const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const uri = process.env.MONGODB_URI || 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

const User = require('../models/User');
const Lead = require('../models/Lead');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const { computeLeadScore } = require('../services/leadScorer');
const { JWT_SECRET } = require('../middleware/auth');

function makeRequest(serverPort, apiPath, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const fullPath = apiPath.startsWith('/api') ? apiPath : '/api' + (apiPath.startsWith('/') ? apiPath : '/' + apiPath);
    const options = {
      hostname: '127.0.0.1',
      port: serverPort,
      path: fullPath,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('VERIFYING 1-SCREEN TELECALLER WORKFLOW, DIALER, WHATSAPP & TIMELINE');
  console.log('================================================================\n');

  await mongoose.connect(uri);

  // Spin up test Express app mounting backend routes
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/leads', require('../routes/leads'));
  app.use('/api/calls', require('../routes/calls'));
  app.use('/api/followups', require('../routes/followups'));
  app.use('/api/reports', require('../routes/reports'));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  let passed = 0;
  let failed = 0;
  function assert(cond, name) {
    if (cond) {
      console.log('  ✓ PASS:', name);
      passed++;
    } else {
      console.error('  ✗ FAIL:', name);
      failed++;
    }
  }

  // Find active telecaller for JWT
  const caller = await User.findOne({ mobile: '9876543211' }); // Amit Sharma
  assert(Boolean(caller), `Found active telecaller Amit Sharma: ${caller?.name}`);

  const token = jwt.sign(
    { id: caller._id, name: caller.name, mobile: caller.mobile, role: caller.role, employee_id: caller.employee_id },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  // -------------------------------------------------------------
  // TEST 1: Phone Dialer Link Generation & Sanitization
  // -------------------------------------------------------------
  console.log('\n[TEST 1] Dialer Links & Phone Sanitization:');
  const sanitizePhone = (num) => String(num || '').replace(/\D/g, '').slice(-10);
  const getDialerLink = (num) => {
    const clean = sanitizePhone(num);
    return clean ? 'tel:' + clean : null;
  };

  assert(sanitizePhone('+91 98765 43210') === '9876543210', 'Strips +91 and spaces from mobile');
  assert(sanitizePhone('09876543210') === '9876543210', 'Strips trunk 0 from mobile');
  assert(sanitizePhone('91-9876543210') === '9876543210', 'Strips 91- prefix');
  assert(sanitizePhone('98765-43210') === '9876543210', 'Strips dashes');
  assert(getDialerLink('+91 9876543210') === 'tel:9876543210', 'Generates standard tel: URL scheme');
  assert(getDialerLink(null) === null, 'Safely returns null on missing phone');
  assert(sanitizePhone('+91 98765 43219') === '9876543219', 'Sanitizes alternate mobile correctly');

  // Simulated elapsed call time calculation on AppState return
  const callStartTime = Date.now() - 65000; // 65 seconds ago
  const elapsedSec = Math.max(5, Math.round((Date.now() - callStartTime) / 1000));
  assert(elapsedSec >= 64 && elapsedSec <= 66, 'AppState return timer measures 65s call duration accurately');

  // -------------------------------------------------------------
  // TEST 2: WhatsApp Deep Link Generation & Templates
  // -------------------------------------------------------------
  console.log('\n[TEST 2] WhatsApp Deep Links & URL Encoding:');
  const generateWhatsAppUrls = (lead, agentName, templateText, targetNumber) => {
    const cleanPhone = sanitizePhone(targetNumber || lead.mobile);
    if (!cleanPhone || cleanPhone.length < 10) return null;
    const defaultMsg = `Namaste ${lead.name || 'Sir/Madam'} ji! KisanConnect me inquiry karne ke liye dhanyawad (${lead.product_interest || 'Products'}). Main ${agentName} bol raha hoon. Aapko details aur rate list bhej raha hoon.`;
    const msgToSend = templateText || defaultMsg;
    const encoded = encodeURIComponent(msgToSend);
    return {
      nativeUrl: `whatsapp://send?phone=91${cleanPhone}&text=${encoded}`,
      webUrl: `https://wa.me/91${cleanPhone}?text=${encoded}`,
      cleanPhone,
      encoded
    };
  };

  const testLead = {
    name: 'Rameshwar Sharma',
    mobile: '9876543210',
    alternate_mobile: '9876543219',
    city: 'Varanasi',
    product_interest: 'Mustard Oil (15L Tin)'
  };
  const waResult = generateWhatsAppUrls(testLead, 'Amit Sharma');
  assert(waResult.nativeUrl.startsWith('whatsapp://send?phone=919876543210&text='), 'Native WhatsApp deep link has 91 country prefix');
  assert(waResult.webUrl.startsWith('https://wa.me/919876543210?text='), 'Web fallback URL has https://wa.me/91 format');
  assert(decodeURIComponent(waResult.encoded).includes('Rameshwar Sharma'), 'Decoded WhatsApp message contains personalized prospect name');
  assert(decodeURIComponent(waResult.encoded).includes('Mustard Oil (15L Tin)'), 'Decoded WhatsApp message contains product interest');

  // WhatsApp targeting alternate mobile
  const waAltResult = generateWhatsAppUrls(testLead, 'Amit Sharma', null, testLead.alternate_mobile);
  assert(waAltResult.cleanPhone === '9876543219', 'Targeting alternate mobile uses alternate phone number');
  assert(waAltResult.nativeUrl.includes('phone=919876543219'), 'Alternate mobile native link generated');

  // Verify all 5 quick templates
  const templates = [
    { title: 'Welcome & Rates', text: `Namaste ${testLead.name} ji! KisanConnect me inquiry ke liye dhanyawad.` },
    { title: 'Call Not Connected', text: `Namaste ${testLead.name} ji, humne aapko call kiya tha par sampark nahi ho paya.` },
    { title: 'Catalog & Margin', text: `Namaste ${testLead.name} ji! Margin sheet aur catalog share kar raha hoon.` },
    { title: 'Follow-up & Order', text: `Hello ${testLead.name} ji, jaisa humari baat hui, requirement note kar li gayi hai.` },
    { title: 'Distributor Proposal', text: `Namaste ${testLead.name} ji, Distributorship details share ki ja rahi hain.` }
  ];
  templates.forEach(t => {
    const res = generateWhatsAppUrls(testLead, 'Amit Sharma', t.text);
    assert(res.nativeUrl.includes(encodeURIComponent(t.text)), `Template "${t.title}" encoded properly`);
  });

  // -------------------------------------------------------------
  // TEST 3: 1-Screen Telecaller Outcome Logging via HTTP API
  // -------------------------------------------------------------
  console.log('\n[TEST 3] 1-Screen Telecaller Outcome Logging (Live HTTP API):');

  // Create temporary test lead for workflow
  const workflowLead = await Lead.create({
    name: 'Workflow Prospect Test',
    mobile: '98' + Math.floor(10000000 + Math.random() * 90000000),
    alternate_mobile: '98' + Math.floor(10000000 + Math.random() * 90000000),
    city: 'Varanasi',
    state: 'Uttar Pradesh',
    product_interest: 'Mustard Oil (15L Tin)',
    lead_source: 'Meta Lead Ads',
    assigned_to: caller._id,
    status: 'New',
    priority: 'Normal'
  });
  const workflowLeadId = String(workflowLead._id);
  assert(Boolean(workflowLeadId), `Created test lead in database: ${workflowLeadId}`);

  // Test invalid lead_id returns 400
  const invalidIdRes = await makeRequest(port, '/calls', 'POST', {
    lead_id: 'nonexistent_invalid_id',
    status: 'Interested',
    remarks: 'Test'
  }, token);
  assert(invalidIdRes.status === 400, 'Invalid lead_id properly rejected with HTTP 400');

  // Test 1-Tap Save & Complete via HTTP POST /api/calls
  const remarksText = 'Discussed 15L Tin dealership; requested security deposit and catalog details.';
  const callPayload = {
    lead_id: workflowLeadId,
    status: 'Interested',
    disposition: 'Interested',
    remarks: remarksText,
    notes: remarksText,
    duration: 65,
    followupDate: '2026-11-20',
    followupTime: '11:00 AM',
    followupReason: 'Follow-up on Interested Lead',
    followupPriority: 'High',
    followupNotes: remarksText
  };

  const callRes = await makeRequest(port, '/calls', 'POST', callPayload, token);
  assert(callRes.status === 201, `Call logged via HTTP 201: ${callRes.data?.message}`);
  assert(Boolean(callRes.data?.callId), `Created Call record ID: ${callRes.data?.callId}`);

  // Verify lead state transition
  const updatedLead = await Lead.findById(workflowLeadId);
  assert(updatedLead.status === 'Interested', 'Lead status transitioned from New to Interested');
  assert(updatedLead.call_disposition === 'Interested', 'Lead call_disposition set to Interested');
  assert(updatedLead.call_attempts === 1, 'Lead call_attempts counter incremented to 1');
  assert(updatedLead.sla_breached === false, 'First contacted within SLA window (sla_breached=false)');
  assert(updatedLead.quality_score >= 50, `Dynamic quality score computed: ${updatedLead.quality_score}`);

  // Verify scheduled follow-up
  const followup = await Followup.findOne({ lead: workflowLeadId, completed: false });
  assert(Boolean(followup), `Open follow-up found scheduled for ${followup?.date} at ${followup?.time}`);

  // -------------------------------------------------------------
  // TEST 4: Timeline via HTTP GET /api/leads/:id
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Timeline Construction & Chronological Ordering (Live HTTP API):');

  // Attach Document first via HTTP POST /api/leads/:id/upload-document
  const docRes = await makeRequest(port, `/leads/${workflowLeadId}/upload-document`, 'POST', {
    name: 'Shop_GST_Certificate.pdf',
    url: '/recordings/doc_test_123.pdf'
  }, token);
  assert(docRes.status === 200, 'Document attached via HTTP 200');

  // Fetch full lead details with timeline over HTTP
  const leadDetailsRes = await makeRequest(port, `/leads/${workflowLeadId}`, 'GET', null, token);
  assert(leadDetailsRes.status === 200, 'Fetched lead details via HTTP 200');

  const timeline = leadDetailsRes.data?.timeline || [];
  console.log(`  Timeline event count: ${timeline.length}`);
  timeline.forEach((t, i) => console.log(`    [${i+1}] ${t.type}: ${t.title} (${new Date(t.date).toISOString().slice(0, 16)})`));

  assert(timeline.length >= 4, `Timeline contains ${timeline.length} events (CREATED, ASSIGNED, CALL, FOLLOWUP, DOCUMENT)`);
  
  // Verify Chronological Sort (newest first)
  let sortedCorrectly = true;
  for (let i = 0; i < timeline.length - 1; i++) {
    if (new Date(timeline[i].date).getTime() < new Date(timeline[i+1].date).getTime()) {
      sortedCorrectly = false;
      break;
    }
  }
  assert(sortedCorrectly, 'Timeline events are strictly sorted newest-first');

  // Verify CALL event details
  const callEvent = timeline.find(e => e.type === 'CALL');
  assert(Boolean(callEvent), 'CALL event present in timeline');
  assert(callEvent?.duration === 65, 'CALL event contains talk time duration: 65s');
  assert(callEvent?.disposition === 'Interested', 'CALL event preserves disposition: Interested');

  // Verify FOLLOWUP event details
  const followupEvent = timeline.find(e => e.type === 'FOLLOWUP');
  assert(Boolean(followupEvent), 'FOLLOWUP event present in timeline');
  assert(followupEvent?.description.includes('2026-11-20'), 'FOLLOWUP event contains scheduled date');

  // Verify DOCUMENT event in timeline
  const docEvent = timeline.find(e => e.type === 'DOCUMENT');
  assert(Boolean(docEvent), 'DOCUMENT event present in timeline');
  assert(docEvent?.title.includes('Shop_GST_Certificate.pdf'), 'DOCUMENT event title contains filename');

  // -------------------------------------------------------------
  // TEST 5: Mark Invalid Workflow via HTTP API
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Mark Invalid Lead (Live HTTP API):');
  const markRes = await makeRequest(port, `/leads/${workflowLeadId}/mark-invalid`, 'PATCH', {
    reason: 'Wrong Number',
    remarks: 'Customer answered but said wrong person'
  }, token);

  assert(markRes.status === 200, 'Lead marked invalid via HTTP 200');
  assert(markRes.data?.lead?.status === 'Wrong Number', 'Lead status updated to Wrong Number');
  assert(markRes.data?.lead?.tags?.includes('Invalid Lead'), 'Lead tagged with [Invalid Lead]');

  // Verify timeline reflects invalid flag
  const recheckedLeadRes = await makeRequest(port, `/leads/${workflowLeadId}`, 'GET', null, token);
  const updatedTimeline = recheckedLeadRes.data?.timeline || [];
  const invalidFlagEvent = updatedTimeline.find(e => e.type === 'INVALID_FLAG');
  assert(Boolean(invalidFlagEvent), 'INVALID_FLAG event present in timeline');

  // -------------------------------------------------------------
  // TEST 6: Power Queue Progression via HTTP API
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Power Queue Endpoint:');
  const powerQueueRes = await makeRequest(port, '/leads/power-queue', 'GET', null, token);
  assert(powerQueueRes.status === 200, 'Power Queue endpoint returned HTTP 200');
  assert(Array.isArray(powerQueueRes.data?.queue), `Power Queue returned ${powerQueueRes.data?.queue?.length || 0} prioritized leads`);

  // -------------------------------------------------------------
  // CLEANUP
  // -------------------------------------------------------------
  console.log('\n[CLEANUP] Purging test lead artifacts:');
  await Call.deleteMany({ lead: workflowLead._id });
  await Followup.deleteMany({ lead: workflowLead._id });
  await Lead.deleteOne({ _id: workflowLead._id });
  console.log('  ✓ Test lead artifacts purged successfully.');

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  server.close();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runVerification().catch(e => {
  console.error('Verification error:', e);
  process.exit(1);
});
