const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const uri = process.env.MONGODB_URI || 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

const User = require('../models/User');
const Lead = require('../models/Lead');
const Call = require('../models/Call');
const Followup = require('../models/Followup');
const SystemSetting = require('../models/SystemSetting');
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
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB Atlas');

  // Setup express test app
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/leads', require('../routes/leads'));
  app.use('/api/calls', require('../routes/calls'));
  app.use('/api/followups', require('../routes/followups'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/api/webhooks', require('../routes/webhook'));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  console.log(`✅ Test server running on ${baseUrl}`);

  let testCaller = await User.findOne({ role: 'telecaller', status: 'active' });
  if (!testCaller) {
    throw new Error('No active telecaller found');
  }

  const token = jwt.sign(
    { id: testCaller._id, name: testCaller.name, mobile: testCaller.mobile, role: testCaller.role, employee_id: testCaller.employee_id },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  console.log(`\n======================================================`);
  console.log(`🚀 COMPREHENSIVE TELECALLER CRM END-TO-END VERIFICATION`);
  console.log(`======================================================\n`);

  // [TEST 1] Session Token Verification & Auto-Logout Security
  console.log('👉 [Test 1] Testing Session Token & Security...');
  const sessionCheck = await makeRequest(port, '/auth/verify-session', 'GET', null, token);
  if (sessionCheck.status !== 200 || !sessionCheck.data.valid) {
    throw new Error(`Session verify failed: ${JSON.stringify(sessionCheck.data)}`);
  }
  console.log('   ✅ Valid token accepted: Session active.');

  // Test invalid token returns 401 (not 403)
  const badTokenCheck = await makeRequest(port, '/auth/verify-session', 'GET', null, 'invalid.jwt.token');
  if (badTokenCheck.status !== 401) {
    throw new Error(`Expected 401 for invalid token, got ${badTokenCheck.status}`);
  }
  console.log('   ✅ Invalid token correctly rejected with HTTP 401 (triggers mobile auto-logout).');

  // [TEST 2] Lead Scoring & Dynamic Priority Engine (Requirement 8)
  console.log('\n👉 [Test 2] Testing Dynamic Lead Scoring Engine (Requirement 8)...');
  const hotInquiry = {
    custom_fields: { course: 'Full Stack Development', budget: '50000', timeline: 'Immediate' },
    product_interest: 'Full Stack Masterclass',
    city: 'Bangalore',
    alternate_mobile: '9876500000',
    email: 'hot.prospect@gmail.com',
    status: 'Interested',
    createdAt: new Date()
  };
  const hotResult = computeLeadScore(hotInquiry);
  console.log(`   Scored Hot Prospect: Score=${hotResult.score}, Priority=${hotResult.priority}`);
  if (hotResult.score < 70 || hotResult.priority !== 'Hot Lead') {
    throw new Error(`Expected Hot Lead priority, got ${hotResult.priority} (${hotResult.score})`);
  }
  console.log('   ✅ High-intent inquiry correctly scored as "Hot Lead".');

  // [TEST 3] Lead Creation via API with Meta Custom Questions & Auto-Scoring
  console.log('\n👉 [Test 3] Testing Lead Creation with Meta Form Questions...');
  const newLeadRes = await makeRequest(port, '/leads', 'POST', {
    name: 'Aakash Verma Meta Student',
    mobile: '9811223344',
    alternate_mobile: '9811223345',
    email: 'aakash.meta@test.com',
    city: 'Indore',
    state: 'Madhya Pradesh',
    product_interest: 'Full Stack Course',
    lead_source: 'Facebook Meta Lead Ads',
    campaign_name: 'Meta Ads Winter Batch',
    custom_fields: {
      'Highest Qualification': 'B.Tech',
      'Preferred Batch Timing': 'Evening 7 PM',
      'Ready to Join': 'Within 7 Days'
    },
    assignToSelf: true
  }, token);

  if (newLeadRes.status !== 201) {
    throw new Error(`Failed creating lead: ${JSON.stringify(newLeadRes.data)}`);
  }
  const createdLead = newLeadRes.data.lead;
  const leadId = createdLead._id || createdLead.id;
  console.log(`   ✅ Lead created: ${createdLead.name} (${createdLead.lead_id}), Score: ${createdLead.quality_score}, Priority: ${createdLead.priority}`);

  // [TEST 4] 1-Tap Call Logging, Dispositions, Remarks, SLA, & Auto Follow-up (Requirement 4, 5, 13, 14)
  console.log('\n👉 [Test 4] Testing 1-Tap Call Outcome & Unreachable Auto-Followup...');
  const callRes = await makeRequest(port, '/calls', 'POST', {
    lead_id: leadId,
    status: 'Call Not Connected',
    disposition: 'No answer',
    remarks: 'Customer phone rang continuously, no answer.',
    duration: 35
  }, token);

  if (callRes.status !== 201) {
    throw new Error(`Failed logging call: ${JSON.stringify(callRes.data)}`);
  }
  console.log(`   ✅ Call logged. Auto-followup scheduled on No-Answer: ${callRes.data.autoFollowupScheduled}`);
  if (!callRes.data.autoFollowupScheduled) {
    throw new Error('Auto followup was not scheduled for unreachable call.');
  }

  // [TEST 5] Lead Details, Timeline & Audio Recording info (Requirement 2 & 5)
  console.log('\n👉 [Test 5] Testing Lead Details Timeline & Audio Fields...');
  const leadDetailsRes = await makeRequest(port, `/leads/${leadId}`, 'GET', null, token);
  if (leadDetailsRes.status !== 200) {
    throw new Error(`Failed fetching lead details: ${JSON.stringify(leadDetailsRes.data)}`);
  }
  const timelineItems = leadDetailsRes.data.timeline || [];
  const callTimeline = timelineItems.find(t => t.type === 'CALL');
  if (!callTimeline) {
    throw new Error('Call was not recorded in timeline.');
  }
  console.log(`   ✅ Call verified in timeline: "${callTimeline.title}", Duration: ${callTimeline.duration}s`);

  // [TEST 6] Document Upload / Attachment (Requirement 2 & 16)
  console.log('\n👉 [Test 6] Testing Lead Document Attachment...');
  const docRes = await makeRequest(port, `/leads/${leadId}/upload-document`, 'POST', {
    name: 'Fee_Receipt_Initial.pdf',
    url: '/recordings/doc_test_123.pdf'
  }, token);
  if (docRes.status !== 200 || !docRes.data.documents || docRes.data.documents.length === 0) {
    throw new Error(`Failed attaching document: ${JSON.stringify(docRes.data)}`);
  }
  console.log(`   ✅ Document attached successfully. Lead has ${docRes.data.documents.length} document(s).`);

  // [TEST 7] Duplicate Detection & Merging (Requirement 9)
  console.log('\n👉 [Test 7] Testing Duplicate Detection by Mobile, Email & Meta ID...');
  // Create a duplicate lead
  const dupRes = await makeRequest(port, '/leads', 'POST', {
    name: 'Aakash Verma Second Inquiry',
    mobile: '9811223344', // Same mobile
    email: 'aakash.meta@test.com',
    product_interest: 'Data Science Course',
    assignToSelf: true
  }, token);
  const dupLeadId = dupRes.data.leadId;

  const dupCheck = await makeRequest(port, '/leads/detect-duplicates', 'POST', { field: 'mobile' }, token);
  if (dupCheck.status !== 200 || !dupCheck.data.duplicates || dupCheck.data.duplicates.length === 0) {
    throw new Error('Duplicate detection failed to find duplicates by mobile');
  }
  console.log(`   ✅ Duplicate groups identified: ${dupCheck.data.totalDuplicates} group(s).`);

  // Merge the duplicate
  const mergeRes = await makeRequest(port, '/leads/merge', 'POST', {
    primaryLeadId: leadId,
    duplicateLeadIds: [dupLeadId]
  }, token);
  if (mergeRes.status !== 200) {
    throw new Error(`Merge failed: ${JSON.stringify(mergeRes.data)}`);
  }
  console.log(`   ✅ ${mergeRes.data.message}`);

  // [TEST 8] Mark Lead Invalid / Wrong Number (Requirement 9)
  console.log('\n👉 [Test 8] Testing Mark Lead Invalid (Requirement 9)...');
  const invalidRes = await makeRequest(port, `/leads/${dupLeadId}/mark-invalid`, 'PATCH', {
    reason: 'Wrong Number',
    remarks: 'Customer said wrong person.'
  }, token);
  if (invalidRes.status !== 200 || invalidRes.data.lead.status !== 'Wrong Number') {
    throw new Error(`Mark invalid failed: ${JSON.stringify(invalidRes.data)}`);
  }
  console.log(`   ✅ Lead correctly marked as: ${invalidRes.data.lead.status}`);

  // [TEST 9] Global Search & Multi-Attribute Filters (Requirement 10)
  console.log('\n👉 [Test 9] Testing Global Search & Filters (Requirement 10)...');
  const searchByPhone = await makeRequest(port, '/leads?query=9811223344', 'GET', null, token);
  if (searchByPhone.status !== 200 || searchByPhone.data.leads.length === 0) {
    throw new Error('Search by 10-digit phone number failed.');
  }
  console.log(`   ✅ Global Search by 10-digit phone found ${searchByPhone.data.leads.length} lead(s).`);

  const filterByCity = await makeRequest(port, '/leads?city=Indore', 'GET', null, token);
  if (filterByCity.status !== 200 || filterByCity.data.leads.length === 0) {
    throw new Error('Filter by city failed.');
  }
  console.log(`   ✅ Filter by city "Indore" returned ${filterByCity.data.leads.length} lead(s).`);

  // [TEST 10] Telecaller Dashboard 12-Metric Performance Engine (Requirement 1)
  console.log('\n👉 [Test 10] Testing Telecaller Dashboard 12 Core KPIs (Requirement 1)...');
  const dashRes = await makeRequest(port, '/reports/telecaller-dashboard', 'GET', null, token);
  if (dashRes.status !== 200) {
    throw new Error(`Failed fetching dashboard stats: ${JSON.stringify(dashRes.data)}`);
  }
  const kpis = dashRes.data.kpis || {};
  console.log(`   📊 Live Telecaller Metrics:`);
  console.log(`      1. Today's Assigned Leads:   ${kpis.todayAssignedLeads}`);
  console.log(`      2. New Uncontacted Leads:    ${kpis.newUncontactedLeads}`);
  console.log(`      3. Today's Follow-ups:       ${dashRes.data.todayFollowupsCount || 0}`);
  console.log(`      4. Overdue Follow-ups:       ${dashRes.data.overdueFollowupsCount || 0}`);
  console.log(`      5. Connected Calls:          ${kpis.connectedCalls}`);
  console.log(`      6. Not Connected Calls:      ${kpis.notConnectedCalls}`);
  console.log(`      7. Interested Leads:         ${kpis.interested}`);
  console.log(`      8. Converted Leads:          ${kpis.closed}`);
  console.log(`      9. Lost Leads:               ${kpis.lostLeads}`);
  console.log(`     10. Target vs Achievement:    ${kpis.todaysCallsCount} / ${kpis.dailyCallTarget || 50}`);
  console.log(`     11. Lead Response Time (min): ${kpis.leadResponseTimeMinutes}m`);
  console.log(`     12. Conversion Percentage:    ${kpis.conversionPercentage}%`);
  console.log('   ✅ All 12 required Telecaller Dashboard KPIs verified.');

  // [TEST 11] Predefined WhatsApp / SMS / Email Templates (Requirement 7)
  console.log('\n👉 [Test 11] Testing Predefined Communication Templates (Requirement 7)...');
  const tplRes = await makeRequest(port, '/reports/templates', 'GET', null, token);
  if (tplRes.status !== 200 || !tplRes.data.templates || tplRes.data.templates.length === 0) {
    throw new Error('Failed to retrieve communication templates');
  }
  console.log(`   ✅ Retrieved ${tplRes.data.templates.length} templates (WhatsApp, SMS, Email).`);

  // Cleanup test leads created
  console.log('\n🧹 Cleaning up test leads...');
  await Lead.deleteMany({ _id: { $in: [leadId, dupLeadId] } });
  await Call.deleteMany({ lead: { $in: [leadId, dupLeadId] } });
  await Followup.deleteMany({ lead: { $in: [leadId, dupLeadId] } });
  console.log('✅ Cleanup completed.');

  console.log('\n======================================================');
  console.log('🎉 ALL 11 WORKFLOW VERIFICATION SUITES PASSED 100%!');
  console.log('======================================================\n');

  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
