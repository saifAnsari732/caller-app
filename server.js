require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./database');
const Counter = require('./models/Counter');
const Lead = require('./models/Lead');

const authRoutes = require('./routes/auth');
const telecallerRoutes = require('./routes/telecallers');
const leadRoutes = require('./routes/leads');
const callRoutes = require('./routes/calls');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const reportsRoutes = require('./routes/reports');
const followupsRoutes = require('./routes/followups');
const webhookRoutes = require('./routes/webhook');
// smovbkmsokbnslondsvbdbx 
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); 
app.use(express.json());
app.use('/recordings', express.static(path.join(__dirname, 'public/recordings')));

// Ensure local fallback directory exists for recordings
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'public/recordings'))) {
  fs.mkdirSync(path.join(__dirname, 'public/recordings'), { recursive: true });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/telecallers', telecallerRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/followups', followupsRoutes);
app.use('/api/webhooks', webhookRoutes);

// health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});


// Database Connection & Server Start
connectDB().then(async () => {
  // Initialize Counter if missing to ensure concurrent webhook safety
  try {
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
    console.log(`[Init] Counter synchronized with max lead_id: ${maxNum}`);
  } catch(e) {
    console.error('[Init] Error synchronizing counter', e);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log('===============================================');
    console.log(`  TradeFlow CRM Backend Server running!          `);
    console.log(`  Port: ${PORT}                                `);
    console.log(`  Address: http://localhost:${PORT}             `);
    console.log(`  Database: MongoDB Atlas (Mongoose)            `);
    console.log('===============================================');
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
