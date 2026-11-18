const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  description: { type: String, default: '' },
  leader:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  campaigns:   [{ type: String, trim: true }],
  status:      { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

teamSchema.index({ leader: 1 });

module.exports = mongoose.models.Team || mongoose.model('Team', teamSchema);
