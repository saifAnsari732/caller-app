require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./database');

const authRoutes = require('./routes/auth');
const telecallerRoutes = require('./routes/telecallers');
const leadRoutes = require('./routes/leads');
const callRoutes = require('./routes/calls');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const reportsRoutes = require('./routes/reports');
const followupsRoutes = require('./routes/followups');

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

// Database Connection & Server Start
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('===============================================');
    console.log(`  OilFlow CRM Backend Server running!          `);
    console.log(`  Port: ${PORT}                                `);
    console.log(`  Address: http://localhost:${PORT}             `);
    console.log(`  Database: MongoDB Atlas (Mongoose)            `);
    console.log('===============================================');
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
