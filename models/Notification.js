const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = admin broadcast
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  type:      { type: String, enum: ['NEW_LEAD', 'UNASSIGNED', 'FOLLOWUP_REMINDER', 'MISSED_FOLLOWUP', 'LOW_PERFORMANCE'], default: 'NEW_LEAD' },
  read:      { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
