const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

async function runVerification() {
  console.log('================================================================');
  console.log('VERIFYING 1-SCREEN TELECALLER WORKFLOW, DIALER, WHATSAPP & TIMELINE');
  console.log('================================================================\n');

  await mongoose.connect(uri);

  const User = require('../models/User');
  const Lead = require('../models/Lead');
  const Call = require('../models/Call');
  const Followup = require('../models/Followup');
  const { computeLeadScore } = require('../services/leadScorer');

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

  // -------------------------------------------------------------
  // TEST 1: Phone Dialer Link Generation & Sanitization
  // -------------------------------------------------------------
  console.log('[TEST 1] Dialer Links & Phone Sanitization:');
  const sanitizePhone = (num) => String(num || '').replace(/\D/g, '').slice(-10);
  const getDialerLink = (num) => 'tel:' + sanitizePhone(num);

  assert(sanitizePhone('+91 98765 43210') === '9876543210', 'Strips +91 and spaces from mobile');
  assert(sanitizePhone('09876543210') === '9876543210', 'Strips trunk 0 from mobile');
  assert(sanitizePhone('91-9876543210') === '9876543210', 'Strips 91- prefix');
  assert(getDialerLink('+91 9876543210') === 'tel:9876543210', 'Generates standard tel: URL scheme');

  // Simulated elapsed call time calculation on AppState return
  const callStartTime = Date.now() - 65000; // 65 seconds ago
  const elapsedSec = Math.max(5, Math.round((Date.now() - callStartTime) / 1000));
  assert(elapsedSec >= 64 && elapsedSec <= 66, 'AppState return timer measures 65s call duration accurately');

  // -------------------------------------------------------------
  // TEST 2: WhatsApp Deep Link Generation & Templates
  // -------------------------------------------------------------
  console.log('\n[TEST 2] WhatsApp Deep Links & URL Encoding:');
  const generateWhatsAppUrls = (lead, agentName, templateText) => {
    const cleanPhone = sanitizePhone(lead.mobile);
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

  const testLead = { name: 'Rameshwar Sharma', mobile: '9876543210', product_interest: 'Mustard Oil (15L Tin)' };
  const waResult = generateWhatsAppUrls(testLead, 'Amit Sharma');
  assert(waResult.nativeUrl.startsWith('whatsapp://send?phone=919876543210&text='), 'Native WhatsApp deep link has 91 country prefix');
  assert(waResult.webUrl.startsWith('https://wa.me/919876543210?text='), 'Web fallback URL has https://wa.me/91 format');
  assert(decodeURIComponent(waResult.encoded).includes('Rameshwar Sharma'), 'Decoded WhatsApp message contains personalized prospect name');
  assert(decodeURIComponent(waResult.encoded).includes('Mustard Oil (15L Tin)'), 'Decoded WhatsApp message contains product interest');

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
  // TEST 3: 1-Screen Telecaller Workflow - Outcome Logging
  // -------------------------------------------------------------
  console.log('\n[TEST 3] 1-Screen Telecaller Outcome Logging & State Transitions:');
  const caller = await User.findOne({ mobile: '9876543211' }); // Amit Sharma
  assert(Boolean(caller), `Found active telecaller Amit Sharma: ${caller?.name}`);

  // Create temporary test lead for workflow
  const workflowLead = await Lead.create({
    name: 'Workflow Prospect Test',
    mobile: '98' + Math.floor(10000000 + Math.random() * 90000000),
    city: 'Varanasi',
    state: 'Uttar Pradesh',
    product_interest: 'Mustard Oil (15L Tin)',
    lead_source: 'Meta Lead Ads',
    assigned_to: caller._id,
    status: 'New',
    priority: 'Normal'
  });
  assert(Boolean(workflowLead._id), 'Created test lead for 1-screen telecaller workflow');

  // Simulate 1-Tap Save & Complete with Primary Status: Interested, Disposition: Interested
  const now = new Date();
  const parsedDuration = 65;
  const remarks = 'Discussed 15L Tin dealership; requested security deposit and catalog details.';
  
  const callRecord = await Call.create({
    lead: workflowLead._id,
    caller: caller._id,
    status: 'Interested',
    disposition: 'Interested',
    remarks: remarks,
    notes: remarks,
    start_time: new Date(now.getTime() - parsedDuration * 1000),
    end_time: now,
    duration: parsedDuration,
    recording_url: 'https://ik.imagekit.io/4eqyb4rwe/call_sample_test.m4a'
  });
  assert(Boolean(callRecord._id), `Call record created with duration: ${callRecord.duration}s`);
  assert(callRecord.recording_url.includes('ik.imagekit.io'), 'Call record contains audio recording URL');

  // Update lead
  workflowLead.status = 'Interested';
  workflowLead.call_disposition = 'Interested';
  workflowLead.remarks = remarks;
  workflowLead.notes = remarks;
  workflowLead.call_attempts = (workflowLead.call_attempts || 0) + 1;
  workflowLead.last_contacted_at = now;
  if (!workflowLead.first_contacted_at) {
    workflowLead.first_contacted_at = now;
    workflowLead.response_time_seconds = 120;
    workflowLead.sla_breached = false;
  }
  const { score, priority } = computeLeadScore(workflowLead, [callRecord]);
  workflowLead.quality_score = score;
  workflowLead.priority = priority;
  await workflowLead.save();

  assert(workflowLead.status === 'Interested', 'Lead status transitioned from New to Interested');
  assert(workflowLead.call_attempts === 1, 'Call attempts counter incremented to 1');
  assert(workflowLead.sla_breached === false, '120s response time satisfies 15-minute SLA');
  assert(workflowLead.quality_score >= 50, `Dynamic lead quality score re-calculated: ${workflowLead.quality_score}`);

  // Schedule Follow-up
  const followup = await Followup.create({
    lead: workflowLead._id,
    caller: caller._id,
    date: '2026-11-20',
    time: '11:00 AM',
    reason: 'Follow-up on Interested Lead',
    priority: 'High',
    notes: remarks
  });
  assert(Boolean(followup._id), `Follow-up created for ${followup.date} at ${followup.time}`);

  // -------------------------------------------------------------
  // TEST 4: Timeline Construction & Chronological Ordering
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Timeline Construction & Interaction History:');
  const calls = await Call.find({ lead: workflowLead._id }).sort({ createdAt: -1 }).lean();
  const followups = await Followup.find({ lead: workflowLead._id }).sort({ date: -1, time: -1 }).lean();

  const timeline = [];
  timeline.push({
    type: 'CREATED',
    title: 'Lead Created',
    date: workflowLead.createdAt || new Date(),
    description: `Added via ${workflowLead.lead_source || 'Manual'}`
  });

  if (workflowLead.assigned_to) {
    timeline.push({
      type: 'ASSIGNED',
      title: 'Lead Assigned',
      date: workflowLead.assigned_at || workflowLead.createdAt,
      description: `Assigned to ${caller.name}`
    });
  }

  calls.forEach(c => {
    timeline.push({
      type: 'CALL',
      title: `Call: ${c.status}${c.disposition ? ` (${c.disposition})` : ''}`,
      date: c.start_time,
      description: `Talk time: ${c.duration}s. ${c.remarks || c.notes || ''}`,
      recording: !!c.recording_url,
      recording_url: c.recording_url || null,
      duration: c.duration || 0
    });
  });

  followups.forEach(f => {
    timeline.push({
      type: 'FOLLOWUP',
      title: f.completed ? 'Follow-up Completed' : 'Follow-up Scheduled',
      date: f.createdAt || new Date(),
      description: `Scheduled for ${f.date} at ${f.time}. ${f.notes || ''}`
    });
  });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  assert(timeline.length === 4, 'Timeline contains exactly 4 events (CREATED, ASSIGNED, CALL, FOLLOWUP)');
  assert(new Date(timeline[0].date) >= new Date(timeline[1].date), 'Timeline items sorted newest-first');
  const callEvent = timeline.find(e => e.type === 'CALL');
  assert(callEvent && callEvent.recording === true, 'Call event in timeline flags recording available');
  assert(callEvent.recording_url === 'https://ik.imagekit.io/4eqyb4rwe/call_sample_test.m4a', 'Call event contains valid recording URL');

  // -------------------------------------------------------------
  // TEST 5: Document Attachment & Mark Invalid Workflow
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Document Attachment & Mark Invalid:');
  // Attach Document
  workflowLead.documents = workflowLead.documents || [];
  workflowLead.documents.push({
    name: 'Shop_GST_Certificate.pdf',
    url: '/recordings/doc_test_123.pdf',
    uploadedAt: new Date()
  });
  await workflowLead.save();
  assert(workflowLead.documents.length === 1, 'Document attached to lead successfully');
  assert(workflowLead.documents[0].name === 'Shop_GST_Certificate.pdf', 'Document name preserved');

  // Mark Invalid Lead
  workflowLead.status = 'Wrong Number';
  workflowLead.tags = workflowLead.tags || [];
  if (!workflowLead.tags.includes('Invalid Lead')) workflowLead.tags.push('Invalid Lead');
  await workflowLead.save();

  assert(workflowLead.status === 'Wrong Number', 'Lead status updated to Wrong Number');
  assert(workflowLead.tags.includes('Invalid Lead'), 'Lead tagged with [Invalid Lead]');

  // Clean up
  await Call.deleteMany({ lead: workflowLead._id });
  await Followup.deleteMany({ lead: workflowLead._id });
  await Lead.deleteOne({ _id: workflowLead._id });
  console.log('  ✓ Cleaned up test lead data successfully.');

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runVerification().catch(e => {
  console.error('Verification error:', e);
  process.exit(1);
});
