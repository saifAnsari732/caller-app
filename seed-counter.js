const mongoose = require('mongoose');
require('dotenv').config();
const Lead = require('./models/Lead');
const Counter = require('./models/Counter');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  const lastLead = await Lead.findOne({}, {}, { sort: { createdAt: -1 } });
  let maxNum = 1000;
  if (lastLead && lastLead.lead_id) {
    maxNum = parseInt(lastLead.lead_id.replace('L-', ''), 10);
  }
  await Counter.findOneAndUpdate(
    { _id: 'leadId' },
    { $max: { seq: maxNum } },
    { upsert: true }
  );
  console.log('Seeded counter to:', maxNum);
  process.exit(0);
}
seed();
