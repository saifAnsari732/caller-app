const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  leader:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  description: { type: String, default: '' },
  campaigns:   [{ type: String, trim: true }],
  active:      { type: Boolean, default: true }
}, { timestamps: true });

teamSchema.index({ leader: 1 });

module.exports = mongoose.model('Team', teamSchema);
