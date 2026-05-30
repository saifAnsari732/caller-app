const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  mobile:      { type: String, required: true, unique: true, trim: true },
  email:       { type: String, required: true, unique: true, trim: true, lowercase: true },
  employee_id: { type: String, required: true, unique: true, trim: true },
  password:    { type: String, required: true },
  role:        { type: String, enum: ['admin', 'telecaller'], required: true },
  status:      { type: String, enum: ['active', 'disabled'], default: 'active' },
  on_leave:    { type: Boolean, default: false }
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
