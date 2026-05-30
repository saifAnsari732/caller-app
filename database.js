const mongoose = require('mongoose');
const User = require('./models/User');
const Lead = require('./models/Lead');
const Notification = require('./models/Notification');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not defined in .env');

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log('✅  MongoDB Atlas connected successfully!');
  await seedDatabase();
}

async function seedDatabase() {
  const count = await User.countDocuments();
  if (count > 0) return; // Already seeded

  console.log('🌱  Seeding default users and sample leads...');

  // Admin
  const admin = await User.create({
    name: 'Sanjay Gupta',
    mobile: '9876543210',
    email: 'sanjay.gupta@oilflow.com',
    employee_id: 'EMP001',
    password: 'password123',
    role: 'admin',
    status: 'active'
  });

  // Telecallers
  const tc1 = await User.create({
    name: 'Amit Sharma',
    mobile: '9876543211',
    email: 'amit.sharma@oilflow.com',
    employee_id: 'EMP101',
    password: 'password123',
    role: 'telecaller',
    status: 'active',
    on_leave: false
  });

  const tc2 = await User.create({
    name: 'Priya Patel',
    mobile: '9876543212',
    email: 'priya.patel@oilflow.com',
    employee_id: 'EMP102',
    password: 'password123',
    role: 'telecaller',
    status: 'active',
    on_leave: false
  });

  await User.create({
    name: 'Rohan Das',
    mobile: '9876543213',
    email: 'rohan.das@oilflow.com',
    employee_id: 'EMP103',
    password: 'password123',
    role: 'telecaller',
    status: 'active',
    on_leave: true   // On leave — excluded from round-robin
  });

  // Sample Leads
  const leadsData = [
    { name: 'Kunal Kirana Store',       mobile: '9111222333', email: 'kunal@kirana.com',   city: 'Indore',     state: 'Madhya Pradesh', business_type: 'Trader',       product_interest: 'Mustard Oil (15L Tin)',    lead_source: 'Facebook Meta Lead Ads' },
    { name: 'Mahadev Oil Distributors', mobile: '9222333444', email: 'mahadev@dist.com',   city: 'Jaipur',     state: 'Rajasthan',      business_type: 'Distributor',  product_interest: 'Refined Soyabean Oil',     lead_source: 'Facebook Meta Lead Ads' },
    { name: 'Krishna Agro Foods',       mobile: '9333444555', email: 'krishna@agro.com',   city: 'Ahmedabad',  state: 'Gujarat',        business_type: 'Industrial User', product_interest: 'Palm Oil (Bulk Tanker)', lead_source: 'Manual Entry' },
    { name: 'Ramesh Supermarket',       mobile: '9444555666', email: 'ramesh@market.com',  city: 'Bhopal',     state: 'Madhya Pradesh', business_type: 'Trader',       product_interest: 'Mustard Oil (1L Bottle)', lead_source: 'Facebook Meta Lead Ads' },
    { name: 'Balaji Trading Co',        mobile: '9555666777', email: 'balaji@trade.com',   city: 'Pune',       state: 'Maharashtra',    business_type: 'Distributor',  product_interest: 'Sunflower Oil (15L Jar)', lead_source: 'Facebook Meta Lead Ads' }
  ];

  const telecallers = [tc1, tc2];
  for (let i = 0; i < leadsData.length; i++) {
    const assignedTo = telecallers[i % telecallers.length];
    await Lead.create({
      ...leadsData[i],
      status: 'Assigned',
      assigned_to: assignedTo._id,
      assigned_at: new Date()
    });
  }

  // Admin welcome notification
  await Notification.create({
    user: null,
    title: 'Welcome to OilFlow CRM',
    message: 'System initialized with 4 users and 5 sample leads. Auto distribution is active.',
    type: 'NEW_LEAD'
  });

  console.log('✅  Seeding complete. Default admin: 9876543210 / password123');
}

module.exports = { connectDB };
