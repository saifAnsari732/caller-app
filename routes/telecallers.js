const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Lead = require('../models/Lead');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.use(authenticateToken, requireAdmin);

// GET /api/telecallers  — list with basic stats
router.get('/', async (req, res) => {
  try {
    const callers = await User.find({ role: 'telecaller' }).select('-password').lean();

    // Attach lead stats per caller
    const enriched = await Promise.all(callers.map(async (c) => {
      const [assigned, interested, closed] = await Promise.all([
        Lead.countDocuments({ assigned_to: c._id }),
        Lead.countDocuments({ assigned_to: c._id, status: { $in: ['Interested', 'Distributor Interested', 'Trader Interested'] } }),
        Lead.countDocuments({ assigned_to: c._id, status: 'Closed' })
      ]);
      return { ...c, id: c._id, assigned_leads_count: assigned, interested_leads_count: interested, closed_leads_count: closed };
    }));

    res.json({ telecallers: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telecallers  — add
router.post('/', async (req, res) => {
  try {
    const { name, mobile, email, employee_id, password } = req.body;
    if (!name || !mobile || !email || !employee_id || !password)
      return res.status(400).json({ error: 'All fields are required' });

    const user = await User.create({ name, mobile, email, employee_id, password, role: 'telecaller' });
    res.status(201).json({ message: 'Telecaller created successfully', telecallerId: user._id });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: `Already exists: ${JSON.stringify(err.keyValue)}` });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/telecallers/:id  — edit
router.put('/:id', async (req, res) => {
  try {
    const { name, mobile, email, employee_id, password } = req.body;
    if (!name || !mobile || !email || !employee_id)
      return res.status(400).json({ error: 'Name, Mobile, Email, and Employee ID are required' });

    const user = await User.findOne({ _id: req.params.id, role: 'telecaller' });
    if (!user) return res.status(404).json({ error: 'Telecaller not found' });

    user.name = name; user.mobile = mobile; user.email = email; user.employee_id = employee_id;
    if (password && password.trim()) user.password = password;
    await user.save();

    res.json({ message: 'Telecaller updated successfully' });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: `Already exists: ${JSON.stringify(err.keyValue)}` });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/telecallers/:id/leave
router.patch('/:id/leave', async (req, res) => {
  try {
    const { on_leave } = req.body;
    if (on_leave === undefined) return res.status(400).json({ error: 'on_leave (true/false) is required' });
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'telecaller' },
      { on_leave: Boolean(on_leave) },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Telecaller not found' });
    res.json({ message: `Leave status updated to ${on_leave ? 'On Leave' : 'Active'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/telecallers/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'disabled'].includes(status))
      return res.status(400).json({ error: 'Status must be active or disabled' });
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'telecaller' },
      { status },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Telecaller not found' });
    res.json({ message: `Status changed to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/telecallers/:id
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findOneAndDelete({ _id: req.params.id, role: 'telecaller' });
    if (!user) return res.status(404).json({ error: 'Telecaller not found' });

    // Re-mark assigned leads as Fresh
    await Lead.updateMany({ assigned_to: req.params.id }, { assigned_to: null, assigned_at: null, status: 'Fresh Lead' });
    res.json({ message: 'Telecaller deleted. Leads reverted to Fresh Lead.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
