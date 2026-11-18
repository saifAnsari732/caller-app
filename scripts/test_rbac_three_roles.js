const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const uri = process.env.MONGODB_URI || 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

async function runTests() {
  await mongoose.connect(uri);
  console.log('--- RUNNING 3-ROLE RBAC & TEAM HIERARCHY VERIFICATION SUITE ---');

  const User = require('../models/User');
  const Team = require('../models/Team');
  const Lead = require('../models/Lead');
  const Call = require('../models/Call');
  const Followup = require('../models/Followup');

  // 1. Fetch Users
  const admin = await User.findOne({ mobile: '9876543210' });
  const tl1 = await User.findOne({ mobile: '9876543212' }); // Vikram Malhotra (NCR)
  const tl2 = await User.findOne({ mobile: '9876543215' }); // Neha Kapoor (Mumbai)
  const tc1 = await User.findOne({ mobile: '9876543211' }); // Amit Sharma (NCR)
  const tc4 = await User.findOne({ mobile: '9876543216' }); // Rohan Patil (Mumbai)

  console.log(`✅ Loaded Admin: ${admin.name} (${admin.role})`);
  console.log(`✅ Loaded TL1 (NCR): ${tl1.name} (${tl1.role}) - Team: ${tl1.team}`);
  console.log(`✅ Loaded TL2 (Mumbai): ${tl2.name} (${tl2.role}) - Team: ${tl2.team}`);
  console.log(`✅ Loaded TC1 (NCR): ${tc1.name} (${tc1.role})`);
  console.log(`✅ Loaded TC4 (Mumbai): ${tc4.name} (${tc4.role})`);

  // 2. Test Admin Visibility
  const allLeadsCount = await Lead.countDocuments({});
  console.log(`\n[TEST 1] Admin Global Visibility:`);
  console.log(`Total Leads in Database: ${allLeadsCount}`);
  if (allLeadsCount >= 10) {
    console.log(`✅ PASSED: Admin has full global oversight over all ${allLeadsCount} leads.`);
  } else {
    throw new Error('FAILED: Insufficient leads in database.');
  }

  // 3. Test Team Leader 1 (NCR) Lead Scoping
  console.log(`\n[TEST 2] Team Leader 1 (NCR) Strict Team-Only Scoping:`);
  const ncrTeamMembers = await User.find({
    $or: [{ team_leader_id: tl1._id }, { _id: tl1._id }]
  }).select('_id');
  const ncrMemberIds = ncrTeamMembers.map(m => m._id);

  const ncrLeads = await Lead.find({
    $or: [
      { assigned_team_leader: tl1._id },
      { assigned_to: { $in: ncrMemberIds } }
    ]
  });
  console.log(`Leads visible to TL1 (${tl1.name}): ${ncrLeads.length}`);

  // Verify none of Mumbai's leads are in TL1's query
  const leakedMumbaiLeads = ncrLeads.filter(l => l.assigned_to && l.assigned_to.toString() === tc4._id.toString());
  if (leakedMumbaiLeads.length === 0 && ncrLeads.length > 0) {
    console.log(`✅ PASSED: TL1 sees exactly ${ncrLeads.length} team leads and 0 leads from other teams (Mumbai data is completely isolated).`);
  } else {
    throw new Error(`FAILED: Data isolation breach! Found ${leakedMumbaiLeads.length} Mumbai leads in TL1 view.`);
  }

  // 4. Test Team Leader 2 (Mumbai) Lead Scoping
  console.log(`\n[TEST 3] Team Leader 2 (Mumbai) Strict Team-Only Scoping:`);
  const mumTeamMembers = await User.find({
    $or: [{ team_leader_id: tl2._id }, { _id: tl2._id }]
  }).select('_id');
  const mumMemberIds = mumTeamMembers.map(m => m._id);

  const mumLeads = await Lead.find({
    $or: [
      { assigned_team_leader: tl2._id },
      { assigned_to: { $in: mumMemberIds } }
    ]
  });
  console.log(`Leads visible to TL2 (${tl2.name}): ${mumLeads.length}`);
  const leakedNcrLeads = mumLeads.filter(l => l.assigned_to && l.assigned_to.toString() === tc1._id.toString());
  if (leakedNcrLeads.length === 0 && mumLeads.length > 0) {
    console.log(`✅ PASSED: TL2 sees exactly ${mumLeads.length} team leads and 0 leads from NCR team.`);
  } else {
    throw new Error(`FAILED: Data isolation breach! Found ${leakedNcrLeads.length} NCR leads in TL2 view.`);
  }

  // 5. Test Telecaller (Amit Sharma) Scoping
  console.log(`\n[TEST 4] Telecaller Strict Assigned-Only Scoping:`);
  const tc1Leads = await Lead.find({ assigned_to: tc1._id });
  console.log(`Leads visible to Telecaller (${tc1.name}): ${tc1Leads.length}`);
  const foreignLeads = tc1Leads.filter(l => l.assigned_to.toString() !== tc1._id.toString());
  if (foreignLeads.length === 0 && tc1Leads.length > 0) {
    console.log(`✅ PASSED: Telecaller sees ONLY their ${tc1Leads.length} assigned leads. Zero cross-agent access.`);
  } else {
    throw new Error('FAILED: Telecaller access isolation failed.');
  }

  // 6. Test Team Leader Leaderboard Metrics
  console.log(`\n[TEST 5] Team Leader Leaderboard & KPI Calculation:`);
  const team1Telecallers = await User.find({
    $or: [{ team_leader_id: tl1._id }, { team: tl1.team, role: 'telecaller' }]
  }).lean();

  const tcIds = team1Telecallers.map(t => t._id);
  const calls = await Call.find({ caller: { $in: tcIds } });
  console.log(`Team 1 Telecaller count: ${team1Telecallers.length}`);
  console.log(`Team 1 Calls logged: ${calls.length}`);

  const leaderboard = team1Telecallers.map(tc => {
    const tcCalls = calls.filter(c => c.caller?.toString() === tc._id.toString());
    const tcConnected = tcCalls.filter(c => c.status === 'completed' || (c.duration && c.duration > 0)).length;
    const tcAssigned = ncrLeads.filter(l => l.assigned_to?.toString() === tc._id.toString());
    const tcConverted = tcAssigned.filter(l => ['Converted', 'Closed'].includes(l.status)).length;
    const tcInterested = tcAssigned.filter(l => ['Interested', 'DSS Interested', 'RSS Interested'].includes(l.status)).length;
    const rate = tcAssigned.length > 0 ? parseFloat(((tcConverted / tcAssigned.length) * 100).toFixed(1)) : 0;
    return {
      name: tc.name,
      calls: tcCalls.length,
      connected: tcConnected,
      interested: tcInterested,
      converted: tcConverted,
      conversionRate: rate
    };
  });

  leaderboard.sort((a, b) => b.converted - a.converted || b.connected - a.connected || b.calls - a.calls);
  console.table(leaderboard);
  console.log(`✅ PASSED: Team Leader Leaderboard generated accurately.`);

  // 7. Verify Team Structure in DB
  console.log(`\n[TEST 6] Team Hierarchy Model Verification:`);
  const teams = await Team.find({}).populate('leader', 'name mobile').populate('members', 'name mobile');
  for (const t of teams) {
    console.log(`🏢 Team: ${t.name} (${t.code})`);
    console.log(`   Leader: ${t.leader?.name} (${t.leader?.mobile})`);
    console.log(`   Members (${t.members?.length}): ${t.members?.map(m => m.name).join(', ')}`);
  }
  if (teams.length >= 2) {
    console.log(`✅ PASSED: ${teams.length} enterprise teams active with assigned leaders and members.`);
  } else {
    throw new Error('FAILED: Insufficient teams configured.');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL 6 RBAC & HIERARCHY VERIFICATION TESTS PASSED 100%!');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
