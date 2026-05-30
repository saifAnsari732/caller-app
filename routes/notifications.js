const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/notifications
router.get('/', async (req, res) => {
  try {
    // Admin sees admin broadcasts (user=null) and their own.
    // Telecaller sees broadcasts (user=null) and their own.
    const notifications = await Notification.find({
      $or: [
        { user: null },
        { user: req.user.id }
      ]
    }).sort({ createdAt: -1 }).limit(50).lean();

    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    
    // Simple permission check
    if (notif.user && notif.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    notif.read = true;
    await notif.save();
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/mark-all-read
router.patch('/mark-all-read', async (req, res) => {
  try {
    await Notification.updateMany(
      { 
        $or: [{ user: null }, { user: req.user.id }],
        read: false 
      },
      { read: true }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
