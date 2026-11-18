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

    user.last_active_at = new Date();
    if (!user.last_clock_in || user.shift_status === 'Clocked Out') {
      user.shift_status = 'Clocked In';
      user.last_clock_in = new Date();
      user.on_leave = false;
    }
    await user.save();

    const token = jwt.sign(
      { id: user._id, name: user.name, mobile: user.mobile, role: user.role, employee_id: user.employee_id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        employee_id: user.employee_id,
        role: user.role,
        team: user.team,
        status: user.status,
        on_leave: user.on_leave,
        shift_status: user.shift_status,
        daily_call_target: user.daily_call_target,
        daily_conversion_target: user.daily_conversion_target
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
    res.json({ user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auth/shift - Toggle Shift Status (Clocked In / On Break / Clocked Out)
router.patch('/shift', authenticateToken, async (req, res) => {
  try {
    const { shift_status } = req.body;
    if (!['Clocked In', 'On Break', 'Clocked Out'].includes(shift_status)) {
      return res.status(400).json({ error: 'Invalid shift status' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.shift_status = shift_status;
    user.last_active_at = new Date();
    if (shift_status === 'Clocked In') {
      user.last_clock_in = new Date();
      user.on_leave = false;
    } else if (shift_status === 'Clocked Out') {
      user.last_clock_out = new Date();
    }
    await user.save();

    res.json({
      message: `Shift status updated to ${shift_status}`,
      user: {
        id: user._id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        employee_id: user.employee_id,
        role: user.role,
        team: user.team,
        status: user.status,
        on_leave: user.on_leave,
        shift_status: user.shift_status,
        daily_call_target: user.daily_call_target,
        daily_conversion_target: user.daily_conversion_target
      }
    });
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

    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout - Secure logout session invalidation
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user) {
      user.last_active_at = new Date();
      user.last_clock_out = new Date();
      await user.save();
    }
    res.json({ message: 'Session logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/verify-session - Fast token validity check
router.get('/verify-session', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user || user.status === 'disabled') {
      return res.status(401).json({ valid: false, error: 'Session expired or deactivated' });
    }
    res.json({ valid: true, user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
