const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:                    { type: String, required: true, trim: true },
  mobile:                  { type: String, required: true, unique: true, trim: true },
  email:                   { type: String, required: true, unique: true, trim: true, lowercase: true },
  employee_id:             { type: String, required: true, unique: true, trim: true },
  password:                { type: String, required: true },
  role:                    { type: String, enum: ['admin', 'team_leader', 'manager', 'telecaller'], required: true, default: 'telecaller' },
  team:                    { type: String, default: 'North Region Sales', trim: true },
  team_id:                 { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  team_leader_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status:                  { type: String, enum: ['active', 'disabled'], default: 'active' },
  on_leave:                { type: Boolean, default: false },
  shift_status:            { type: String, enum: ['Clocked In', 'On Break', 'Clocked Out'], default: 'Clocked In' },
  last_clock_in:           { type: Date, default: Date.now },
  last_clock_out:          { type: Date, default: null },
  last_active_at:          { type: Date, default: Date.now },
  daily_call_target:       { type: Number, default: 50 },
  daily_conversion_target: { type: Number, default: 5 },
  max_lead_limit:          { type: Number, default: 100 },
  languages:               [{ type: String, trim: true }],
  products:                [{ type: String, trim: true }],
  locations:               [{ type: String, trim: true }]
}, { timestamps: true });

// Pre-save hook: hash password automatically
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
