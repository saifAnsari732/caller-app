const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'oilflow_secret_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decodedUser) => {
    if (err) {
      // 401 Unauthorized for invalid or expired token so client can trigger automatic refresh/logout
      return res.status(401).json({ error: 'Token is invalid or expired' });
    }

    try {
      // Security: Verify user has not been deactivated or deleted since token issue
      const activeUser = await User.findById(decodedUser.id).select('status role shift_status on_leave');
      if (!activeUser || activeUser.status === 'disabled') {
        return res.status(401).json({ error: 'User account is deactivated or no longer exists' });
      }
      req.user = {
        ...decodedUser,
        status: activeUser.status,
        role: activeUser.role,
        shift_status: activeUser.shift_status,
        on_leave: activeUser.on_leave
      };
      next();
    } catch {
      req.user = decodedUser;
      next();
    }
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET
};
