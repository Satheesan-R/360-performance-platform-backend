const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const User = require('../modules/auth/models/usermodel');

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  try {
    req.user = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  if (req.user.purpose || !/^[a-f\d]{24}$/i.test(String(req.user.id || ''))) {
    return res.status(401).json({ message: 'Login required' });
  }
  try {
    // Read on every request: revocation must work across processes and restarts.
    const user = await User.findOne({ _id: req.user.id, status: 'active', role: req.user.role }).select('sessionVersion').lean();
    if (!user || (user.sessionVersion || 0) !== (req.user.sessionVersion ?? 0)) {
      return res.status(401).json({ message: 'Your session has ended. Please sign in again' });
    }
    return next();
  } catch (error) { return next(error); }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission' });
    }
    next();
  };
}

module.exports = { authenticate, allowRoles };
