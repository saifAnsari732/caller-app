const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    if (!mobile || !password)
      return res.status(400).json({ error: 'Mobile and password are required' });

    const user = await User.findOne({ mobile });
    if (!user)
      return res.status(401).json({ error: 'Invalid mobile number or password' });

    if (user.status === 'disabled')
      return res.status(403).json({ error: 'Your account has been deactivated. Contact Admin.' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch)
      return res.status(401).json({ error: 'Invalid mobile number or password' });

    const token = jwt.sign(
      { id: user._id, name: user.name, mobile: user.mobile, role: user.role, employee_id: user.employee_id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user._id, name: user.name, mobile: user.mobile,
        email: user.email, employee_id: user.employee_id,
        role: user.role, status: user.status, on_leave: user.on_leave
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status === 'disabled') return res.status(403).json({ error: 'Account disabled' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: 'Old and new passwords are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect current password' });

    user.password = newPassword; // pre-save hook will hash
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
