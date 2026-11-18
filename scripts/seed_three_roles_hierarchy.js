const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const uri = process.env.MONGODB_URI || 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

async function seed() {
  await mongoose.connect(uri);
  console.log('Connected to MongoDB for 3-Role Hierarchy Seeding...');

  const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Team = mongoose.models.Team || mongoose.model('Team', new mongoose.Schema({}, { strict: false }));
  const Lead = mongoose.models.Lead || mongoose.model('Lead', new mongoose.Schema({}, { strict: false }));
  const Call = mongoose.models.Call || mongoose.model('Call', new mongoose.Schema({}, { strict: false }));
  const Followup = mongoose.models.Followup || mongoose.model('Followup', new mongoose.Schema({}, { strict: false }));

  const hashedPassword = await bcrypt.hash('admin123', 10);

  // 1. Seed or Update Admins
  const adminsData = [
    {
      name: 'Sanjay Gupta',
      mobile: '9876543210',
      email: 'sanjay.gupta@kisanindia.com',
      employee_id: 'ADM-001',
      role: 'admin',
      team: 'Operations HQ',
      status: 'active',
      password: hashedPassword
    },
    {
      name: 'Saifuddin Ansari',
      mobile: '9905234866',
      email: 'ansarisaifuddin732@gmail.com',
      employee_id: 'ADM-002',
      role: 'admin',
      team: 'Operations HQ',
      status: 'active',
      password: hashedPassword
    },
    {
      name: 'Kisan developer',
      mobile: '9511450991',
      email: 'kisandeveloper2@gmail.com',
      employee_id: 'ADM-003',
      role: 'admin',
      team: 'Operations HQ',
      status: 'active',
      password: hashedPassword
    }
  ];

  for (const adm of adminsData) {
    await User.findOneAndUpdate(
      { mobile: adm.mobile },
      { $set: adm },
      { upsert: true, new: true }
    );
  }
  console.log('Admins verified.');

  // 2. Team Leaders
  const tl1Data = {
    name: 'Vikram Malhotra',
    mobile: '9876543212',
    email: 'vikram.malhotra@kisanindia.com',
    employee_id: 'TL-01',
    role: 'team_leader',
    team: 'Delhi NCR Sales Team',
    status: 'active',
    daily_call_target: 30,
    password: hashedPassword
  };
  const tl1 = await User.findOneAndUpdate(
    { mobile: tl1Data.mobile },
    { $set: tl1Data },
    { upsert: true, new: true }
  );

  const tl2Data = {
    name: 'Neha Kapoor',
    mobile: '9876543215',
    email: 'neha.kapoor@kisanindia.com',
    employee_id: 'TL-02',
    role: 'team_leader',
    team: 'Mumbai & West Sales Team',
    status: 'active',
    daily_call_target: 30,
    password: hashedPassword
  };
  const tl2 = await User.findOneAndUpdate(
    { mobile: tl2Data.mobile },
    { $set: tl2Data },
    { upsert: true, new: true }
  );
  console.log('Team Leaders verified:', tl1.name, tl2.name);

  // 3. Telecallers for Team 1 (Delhi NCR)
  const team1Telecallers = [
    {
      name: 'Amit Sharma',
      mobile: '9876543211',
      email: 'amit.sharma@kisanindia.com',
      employee_id: 'TC-01',
      role: 'telecaller',
      team: 'Delhi NCR Sales Team',
      team_leader_id: tl1._id,
      status: 'active',
      daily_call_target: 60,
      password: hashedPassword
    },
    {
      name: 'Pooja Verma',
      mobile: '9876543213',
      email: 'pooja.verma@kisanindia.com',
      employee_id: 'TC-02',
      role: 'telecaller',
      team: 'Delhi NCR Sales Team',
      team_leader_id: tl1._id,
      status: 'active',
      daily_call_target: 50,
      password: hashedPassword
    },
    {
      name: 'Rahul Singh',
      mobile: '9876543214',
      email: 'rahul.singh@kisanindia.com',
      employee_id: 'TC-03',
      role: 'telecaller',
      team: 'Delhi NCR Sales Team',
      team_leader_id: tl1._id,
      status: 'active',
      daily_call_target: 50,
      password: hashedPassword
    }
  ];

  const t1MemberIds = [];
  for (const tc of team1Telecallers) {
    const doc = await User.findOneAndUpdate(
      { mobile: tc.mobile },
      { $set: tc },
      { upsert: true, new: true }
    );
    t1MemberIds.push(doc._id);
  }

  // 4. Telecallers for Team 2 (Mumbai & West)
  const team2Telecallers = [
    {
      name: 'Rohan Patil',
      mobile: '9876543216',
      email: 'rohan.patil@kisanindia.com',
      employee_id: 'TC-04',
      role: 'telecaller',
      team: 'Mumbai & West Sales Team',
      team_leader_id: tl2._id,
      status: 'active',
      daily_call_target: 50,
      password: hashedPassword
    },
    {
      name: 'Sneha Joshi',
      mobile: '9876543217',
      email: 'sneha.joshi@kisanindia.com',
      employee_id: 'TC-05',
      role: 'telecaller',
      team: 'Mumbai & West Sales Team',
      team_leader_id: tl2._id,
      status: 'active',
      daily_call_target: 50,
      password: hashedPassword
    },
    {
      name: 'Arjun Nair',
      mobile: '9876543218',
      email: 'arjun.nair@kisanindia.com',
      employee_id: 'TC-06',
      role: 'telecaller',
      team: 'Mumbai & West Sales Team',
      team_leader_id: tl2._id,
      status: 'active',
      daily_call_target: 50,
      password: hashedPassword
    }
  ];

  const t2MemberIds = [];
  for (const tc of team2Telecallers) {
    const doc = await User.findOneAndUpdate(
      { mobile: tc.mobile },
      { $set: tc },
      { upsert: true, new: true }
    );
    t2MemberIds.push(doc._id);
  }

  // 5. Create or Update Teams
  const team1 = await Team.findOneAndUpdate(
    { code: 'TEAM-NCR' },
    {
      $set: {
        name: 'Delhi NCR Sales Team',
        code: 'TEAM-NCR',
        description: 'Specializes in North Region Agriculture and Solar solutions',
        leader: tl1._id,
        members: t1MemberIds,
        campaigns: ['Facebook - Tractor Subsidies', 'Meta Ads - Solar Pumps Delhi/UP'],
        status: 'active'
      }
    },
    { upsert: true, new: true }
  );

  const team2 = await Team.findOneAndUpdate(
    { code: 'TEAM-MUM' },
    {
      $set: {
        name: 'Mumbai & West Sales Team',
        code: 'TEAM-MUM',
        description: 'Specializes in Western Drip Irrigation and Organic Fertilizer',
        leader: tl2._id,
        members: t2MemberIds,
        campaigns: ['Instagram - Drip Irrigation Maharashtra', 'Meta Ads - Organic Fertilizer'],
        status: 'active'
      }
    },
    { upsert: true, new: true }
  );

  // Link team_id back to users
  await User.updateMany({ _id: { $in: [tl1._id, ...t1MemberIds] } }, { $set: { team_id: team1._id } });
  await User.updateMany({ _id: { $in: [tl2._id, ...t2MemberIds] } }, { $set: { team_id: team2._id } });
  console.log('Teams linked successfully.');

  // 6. Seed Realistic Leads
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const pastThreeDays = new Date(Date.now() - 3 * 24 * 3600 * 1000);

  const sampleLeads = [
    // Team 1 - Amit Sharma Leads
    {
      lead_id: 'L-101',
      name: 'Rameshwar Lal Patel',
      mobile: '9822100001',
      alternate_mobile: '9822100002',
      email: 'rameshwar.patel@gmail.com',
      city: 'Meerut',
      state: 'Uttar Pradesh',
      business_type: 'Agriculture / Farmer',
      product_interest: '5HP Solar Water Pump',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Solar Pumps Delhi/UP',
      adset_name: 'Western UP Farmers 30-55',
      ad_name: 'Solar Subsidies 2026 Video Ad',
      status: 'Interested',
      call_disposition: 'Connected - Interested',
      remarks: 'Interested in 5HP Solar pump under state subsidy scheme. Wants quotation on WhatsApp.',
      priority: 'Hot Lead',
      temperature: 'Hot',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[0], // Amit
      assigned_at: yesterday,
      call_attempts: 2,
      response_time_seconds: 320,
      custom_fields: {
        'Land Size': '8 Acres',
        'Current Irrigation': 'Diesel Engine',
        'Electricity Availability': '4 Hours/day'
      }
    },
    {
      lead_id: 'L-102',
      name: 'Virendra Singh Tyagi',
      mobile: '9822100003',
      alternate_mobile: '',
      email: 'virendra.tyagi@yahoo.com',
      city: 'Muzaffarnagar',
      state: 'Uttar Pradesh',
      business_type: 'Sugarcane Grower',
      product_interest: 'Organic Bio-NPK Fertilizer',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Solar Pumps Delhi/UP',
      adset_name: 'Sugarcane Belt Growers',
      ad_name: 'Yield Multiplier Fertilizer Ad',
      status: 'Follow-up Required',
      call_disposition: 'Connected - Follow-up Required',
      remarks: 'Called while driving on highway. Asked to call back on Friday morning after sugarcane mandi payment.',
      priority: 'Warm Lead',
      temperature: 'Warm',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[0], // Amit
      assigned_at: pastThreeDays,
      call_attempts: 3,
      response_time_seconds: 480,
      custom_fields: {
        'Crop Type': 'Sugarcane',
        'Soil Test Done': 'No'
      }
    },
    {
      lead_id: 'L-103',
      name: 'Satish Chandra Sharma',
      mobile: '9822100004',
      alternate_mobile: '9412000005',
      email: 'satish.sharma@outlook.com',
      city: 'Aligarh',
      state: 'Uttar Pradesh',
      business_type: 'Agri-Dealer',
      product_interest: 'Tractor Attachments & Rotavator',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Facebook - Tractor Subsidies',
      adset_name: 'Agri Retailers and Custom Hiring Centers',
      ad_name: 'Heavy Duty Rotavator Promo',
      status: 'Converted',
      call_disposition: 'Connected - Interested',
      remarks: 'Payment completed via NEFT for 1 Unit Rotavator. Sent invoice to billing department.',
      priority: 'Very High Priority',
      temperature: 'Hot',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[0], // Amit
      assigned_at: pastThreeDays,
      call_attempts: 4,
      response_time_seconds: 180,
      custom_fields: {
        'Dealer Code': 'UP-AL-901',
        'GST Number': '09AAAAA0000A1Z5'
      }
    },

    // Team 1 - Pooja Verma Leads
    {
      lead_id: 'L-104',
      name: 'Sunita Devi Choudhary',
      mobile: '9822100005',
      alternate_mobile: '',
      email: '',
      city: 'Sonipat',
      state: 'Haryana',
      business_type: 'Dairy & Farming',
      product_interest: 'Silage & Cattle Feed Supplements',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Facebook - Tractor Subsidies',
      adset_name: 'Haryana Dairy Network',
      ad_name: 'Milk Yield Booster Feed',
      status: 'New',
      call_disposition: '',
      remarks: '',
      priority: 'Hot Lead',
      temperature: 'Hot',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[1], // Pooja
      assigned_at: today,
      call_attempts: 0,
      custom_fields: {
        'Milch Animals': '14 Cows, 6 Buffaloes',
        'Daily Milk Output': '180 Liters'
      }
    },
    {
      lead_id: 'L-105',
      name: 'Baldev Singh Gill',
      mobile: '9822100006',
      alternate_mobile: '',
      email: 'baldev.gill@gmail.com',
      city: 'Karnal',
      state: 'Haryana',
      business_type: 'Wheat & Paddy Farming',
      product_interest: 'Laser Land Leveler',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Facebook - Tractor Subsidies',
      adset_name: 'Precision Farming Punjab Haryana',
      ad_name: 'Government Approved Leveler Subsidies',
      status: 'Demo Scheduled',
      call_disposition: 'Connected - Asked for Demo',
      remarks: 'Field demo scheduled at Karnal farm for upcoming Saturday 10:00 AM.',
      priority: 'Warm Lead',
      temperature: 'Warm',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[1], // Pooja
      assigned_at: yesterday,
      call_attempts: 1,
      response_time_seconds: 240,
      custom_fields: {
        'Tractor HP': '55 HP Mahindra',
        'Acreage': '25 Acres'
      }
    },

    // Team 1 - Rahul Singh Leads
    {
      lead_id: 'L-106',
      name: 'Anil Kumar Yadav',
      mobile: '9822100007',
      alternate_mobile: '',
      email: '',
      city: 'Gurugram',
      state: 'Haryana',
      business_type: 'Polyhouse Vegetables',
      product_interest: 'Drip Irrigation Controller',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Solar Pumps Delhi/UP',
      adset_name: 'Hydroponics & Polyhouse Enthusiasts',
      ad_name: 'Smart Irrigation Controller',
      status: 'Payment Pending',
      call_disposition: 'Connected - Interested',
      remarks: 'Approved proforma invoice. Promised token advance payment by 4 PM today.',
      priority: 'High',
      temperature: 'Hot',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[2], // Rahul
      assigned_at: yesterday,
      call_attempts: 3,
      response_time_seconds: 150,
      custom_fields: {
        'Polyhouse Area': '2000 Sqm',
        'Crop': 'English Cucumber & Bell Peppers'
      }
    },
    {
      lead_id: 'L-107',
      name: 'Manish Rawat',
      mobile: '9822100008',
      alternate_mobile: '',
      email: 'manish.rawat@rediffmail.com',
      city: 'Dehradun',
      state: 'Uttarakhand',
      business_type: 'Orchard Owner',
      product_interest: 'Apple & Plum Foliar Spray',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Solar Pumps Delhi/UP',
      adset_name: 'Hilly Region Horticulture',
      ad_name: 'Orchard Protection Spray',
      status: 'Call Not Connected',
      call_disposition: 'No Answer',
      remarks: 'Ring rang twice, no answer. Automated follow-up set for tomorrow 11 AM.',
      priority: 'Normal',
      temperature: 'Cold',
      assigned_team: team1._id,
      assigned_team_leader: tl1._id,
      assigned_to: t1MemberIds[2], // Rahul
      assigned_at: yesterday,
      call_attempts: 2,
      custom_fields: {}
    },

    // Team 2 - Rohan Patil Leads (Mumbai / Maharashtra)
    {
      lead_id: 'L-108',
      name: 'Ganesh Pandurang Shinde',
      mobile: '9822100009',
      alternate_mobile: '9822100010',
      email: 'ganesh.shinde@gmail.com',
      city: 'Nashik',
      state: 'Maharashtra',
      business_type: 'Grape Exporter / Vineyard',
      product_interest: 'Automated Drip Irrigation Fertigation Unit',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Instagram - Drip Irrigation Maharashtra',
      adset_name: 'Nashik Grape Growers Network',
      ad_name: 'Drip Automation Kit Instagram Reel',
      status: 'Interested',
      call_disposition: 'Connected - Interested',
      remarks: 'Very eager for fertigation machine with pH sensor. Requested product PDF on WhatsApp.',
      priority: 'Hot Lead',
      temperature: 'Hot',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[0], // Rohan
      assigned_at: yesterday,
      call_attempts: 1,
      response_time_seconds: 210,
      custom_fields: {
        'Vineyard Area': '12 Acres',
        'Variety': 'Thompson Seedless'
      }
    },
    {
      lead_id: 'L-109',
      name: 'Dnyaneshwar Mhatre',
      mobile: '9822100011',
      alternate_mobile: '',
      email: '',
      city: 'Pune',
      state: 'Maharashtra',
      business_type: 'Floriculture / Rose Grower',
      product_interest: 'Organic Bio-Pesticide',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Organic Fertilizer',
      adset_name: 'Flower Growers Pune Solapur',
      ad_name: 'Fungus & Mite Shield Ad',
      status: 'Qualified',
      call_disposition: 'Connected - Interested',
      remarks: 'Qualified lead. Has 4 polyhouses, current chemical spend is 40k/month. Ready to switch to organic bio-pack.',
      priority: 'Very High Priority',
      temperature: 'Hot',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[0], // Rohan
      assigned_at: pastThreeDays,
      call_attempts: 2,
      response_time_seconds: 190,
      custom_fields: {
        'Target Pest': 'Red Spider Mites & Thrips'
      }
    },

    // Team 2 - Sneha Joshi Leads
    {
      lead_id: 'L-110',
      name: 'Kavita Rajesh Deshmukh',
      mobile: '9822100012',
      alternate_mobile: '',
      email: 'kavita.deshmukh@gmail.com',
      city: 'Kolhapur',
      state: 'Maharashtra',
      business_type: 'Jaggery Production Unit',
      product_interest: 'Organic Jaggery Processing Clarifier',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Organic Fertilizer',
      adset_name: 'Kolhapur Sugarcane belt',
      ad_name: 'Chemical-Free Jaggery Making kit',
      status: 'Follow-up Required',
      call_disposition: 'Connected - Follow-up Required',
      remarks: 'Client is at factory till 5 PM. Rescheduled call for evening 6:30 PM today.',
      priority: 'Warm Lead',
      temperature: 'Warm',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[1], // Sneha
      assigned_at: today,
      call_attempts: 1,
      response_time_seconds: 140,
      custom_fields: {
        'Daily Cane Crushing': '10 Tons'
      }
    },
    {
      lead_id: 'L-111',
      name: 'Santosh Baburao Gaikwad',
      mobile: '9822100013',
      alternate_mobile: '',
      email: '',
      city: 'Ahmednagar',
      state: 'Maharashtra',
      business_type: 'Pomegranate Grower',
      product_interest: 'Bio-Fungicide for Oily Spot',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Instagram - Drip Irrigation Maharashtra',
      adset_name: 'Pomegranate Producers',
      ad_name: 'Bacterial Blight Protection Reel',
      status: 'Converted',
      call_disposition: 'Connected - Interested',
      remarks: 'Delivered trial 20-liter barrel. Customer paid via UPI and requested monthly repeat order.',
      priority: 'High',
      temperature: 'Hot',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[1], // Sneha
      assigned_at: pastThreeDays,
      call_attempts: 3,
      response_time_seconds: 260,
      custom_fields: {}
    },

    // Team 2 - Arjun Nair Leads
    {
      lead_id: 'L-112',
      name: 'Vijay Marathe',
      mobile: '9822100014',
      alternate_mobile: '',
      email: 'vijay.marathe@yahoo.com',
      city: 'Baramati',
      state: 'Maharashtra',
      business_type: 'Commercial Farming',
      product_interest: 'Soil Moisture Sensors with App',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Instagram - Drip Irrigation Maharashtra',
      adset_name: 'Tech Savvy Farmers',
      ad_name: 'IoT Soil Sensor Mobile Alert',
      status: 'Not Interested',
      call_disposition: 'Connected - Price Issue',
      remarks: 'Customer felt standard sensor pricing is high. Looking for low-cost Chinese alternative. Marked not interested for now.',
      priority: 'Low Priority',
      temperature: 'Cold',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[2], // Arjun
      assigned_at: pastThreeDays,
      call_attempts: 2,
      response_time_seconds: 400,
      custom_fields: {}
    },
    {
      lead_id: 'L-113',
      name: 'Nitin Kulkarni',
      mobile: '9822100015',
      alternate_mobile: '',
      email: '',
      city: 'Solapur',
      state: 'Maharashtra',
      business_type: 'Onion Farmer',
      product_interest: 'Onion Storage Bio-Preservative',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Organic Fertilizer',
      adset_name: 'Onion Belt Growers',
      ad_name: 'Stop Onion Rotting In Storage',
      status: 'New',
      call_disposition: '',
      remarks: '',
      priority: 'Hot Lead',
      temperature: 'Hot',
      assigned_team: team2._id,
      assigned_team_leader: tl2._id,
      assigned_to: t2MemberIds[2], // Arjun
      assigned_at: today,
      call_attempts: 0,
      custom_fields: {
        'Storage Capacity': '50 Tons'
      }
    },

    // Unassigned Pool Leads (Visible to Admin and ready for Round-Robin Assignment)
    {
      lead_id: 'L-114',
      name: 'Harpreet Singh Sandhu',
      mobile: '9822100016',
      alternate_mobile: '',
      email: 'sandhu.farm@gmail.com',
      city: 'Ludhiana',
      state: 'Punjab',
      business_type: 'Large Grain Producer',
      product_interest: 'Combine Harvester GPS Kit',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Facebook - Tractor Subsidies',
      adset_name: 'Punjab High Acreage Farmers',
      ad_name: 'GPS Guidance System Ad',
      status: 'New',
      call_disposition: '',
      remarks: '',
      priority: 'Very High Priority',
      temperature: 'Hot',
      assigned_team: null,
      assigned_team_leader: null,
      assigned_to: null,
      assigned_at: null,
      call_attempts: 0,
      custom_fields: {
        'Acreage': '80 Acres'
      }
    },
    {
      lead_id: 'L-115',
      name: 'Pravin Solanki',
      mobile: '9822100017',
      alternate_mobile: '',
      email: '',
      city: 'Rajkot',
      state: 'Gujarat',
      business_type: 'Groundnut & Cotton Farmer',
      product_interest: 'Solar Insect Trap',
      lead_source: 'Facebook Meta Lead Ads',
      campaign_name: 'Meta Ads - Organic Fertilizer',
      adset_name: 'Saurashtra Cotton Farmers',
      ad_name: 'Pest Control Solar Trap',
      status: 'New',
      call_disposition: '',
      remarks: '',
      priority: 'Normal',
      temperature: 'Warm',
      assigned_team: null,
      assigned_team_leader: null,
      assigned_to: null,
      assigned_at: null,
      call_attempts: 0,
      custom_fields: {}
    }
  ];

  for (const item of sampleLeads) {
    await Lead.findOneAndUpdate(
      { lead_id: item.lead_id },
      { $set: item },
      { upsert: true, new: true }
    );
  }
  console.log(`Seeded ${sampleLeads.length} realistic multi-team leads.`);

  // 7. Seed Followups (Today, Tomorrow, Overdue)
  const l101 = await Lead.findOne({ lead_id: 'L-101' });
  const l102 = await Lead.findOne({ lead_id: 'L-102' });
  const l105 = await Lead.findOne({ lead_id: 'L-105' });
  const l108 = await Lead.findOne({ lead_id: 'L-108' });
  const l110 = await Lead.findOne({ lead_id: 'L-110' });

  await Followup.deleteMany({}); // fresh clean followups
  const sampleFollowups = [
    {
      lead_id: l101._id,
      telecaller_id: t1MemberIds[0], // Amit
      scheduled_date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30),
      status: 'pending',
      priority: 'high',
      reason: 'Quote Review',
      notes: 'Customer requested 5HP solar pump subsidy calculation sheet on WhatsApp.',
      reminder_sent: false
    },
    {
      lead_id: l102._id,
      telecaller_id: t1MemberIds[0], // Amit
      scheduled_date: new Date(Date.now() - 4 * 3600 * 1000), // Overdue by 4 hours
      status: 'pending',
      priority: 'medium',
      reason: 'Payment Follow-up',
      notes: 'Overdue follow-up: Customer asked for call back after sugarcane mandi closing.',
      reminder_sent: true
    },
    {
      lead_id: l105._id,
      telecaller_id: t1MemberIds[1], // Pooja
      scheduled_date: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 11, 0),
      status: 'pending',
      priority: 'high',
      reason: 'Demo Confirmation',
      notes: 'Confirm field technician arrival for Laser Leveler demonstration.',
      reminder_sent: false
    },
    {
      lead_id: l108._id,
      telecaller_id: t2MemberIds[0], // Rohan
      scheduled_date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0),
      status: 'pending',
      priority: 'high',
      reason: 'Brochure Follow-up',
      notes: 'Check if vineyard owner reviewed automated fertigation specs PDF.',
      reminder_sent: false
    },
    {
      lead_id: l110._id,
      telecaller_id: t2MemberIds[1], // Sneha
      scheduled_date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 30),
      status: 'pending',
      priority: 'medium',
      reason: 'Factory Visit Follow-up',
      notes: 'Discuss bulk 500-liter bio-clarifier supply contract.',
      reminder_sent: false
    }
  ];

  for (const f of sampleFollowups) {
    await Followup.create(f);
  }
  console.log('Seeded realistic follow-ups.');

  // 8. Seed Calls History
  await Call.deleteMany({});
  const sampleCalls = [
    {
      lead_id: l101._id,
      caller_id: t1MemberIds[0],
      duration: 185,
      status: 'completed',
      call_type: 'outgoing',
      disposition: 'Connected - Interested',
      remarks: 'Explained 5HP solar pump subsidy. Lead is interested, sending brochure.',
      created_at: yesterday
    },
    {
      lead_id: l102._id,
      caller_id: t1MemberIds[0],
      duration: 45,
      status: 'completed',
      call_type: 'outgoing',
      disposition: 'Call Back Requested',
      remarks: 'Driving on highway, asked to call back Friday.',
      created_at: yesterday
    },
    {
      lead_id: l108._id,
      caller_id: t2MemberIds[0],
      duration: 210,
      status: 'completed',
      call_type: 'outgoing',
      disposition: 'Connected - Interested',
      remarks: 'Discussed fertigation controller for Nashik grape plantation.',
      created_at: yesterday
    }
  ];
  for (const c of sampleCalls) {
    await Call.create(c);
  }
  console.log('Seeded call logs.');

  console.log('✅ 3-Role Hierarchy & Seed Data setup complete!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
