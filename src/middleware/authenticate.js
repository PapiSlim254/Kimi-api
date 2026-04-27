const { verifyToken } = require('../lib/jwt');
const prisma = require('../lib/prisma');
const { error } = require('../lib/response');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'UNAUTHORIZED', 'Authentication required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    // Fetch user based on role
    let user;
    if (decoded.role === 'rider') {
      user = await prisma.user.findUnique({ 
        where: { id: decoded.id },
        select: { id: true, phone: true, name: true, isActive: true }
      });
    } else if (decoded.role === 'driver') {
      user = await prisma.driver.findUnique({ 
        where: { id: decoded.id },
        select: { id: true, phone: true, name: true, isActive: true, isVerified: true, isOnline: true }
      });
    }

    if (!user || !user.isActive) {
      return error(res, 'UNAUTHORIZED', 'User not found or inactive', 401);
    }

    req.user = { ...user, role: decoded.role };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'TOKEN_EXPIRED', 'Token has expired', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      return error(res, 'INVALID_TOKEN', 'Invalid token', 401);
    }
    return error(res, 'UNAUTHORIZED', 'Authentication failed', 401);
  }
};

const requireRider = (req, res, next) => {
  if (req.user.role !== 'rider') {
    return error(res, 'FORBIDDEN', 'Rider access required', 403);
  }
  next();
};

const requireDriver = (req, res, next) => {
  if (req.user.role !== 'driver') {
    return error(res, 'FORBIDDEN', 'Driver access required', 403);
  }
  next();
};

const requireVerifiedDriver = (req, res, next) => {
  if (req.user.role !== 'driver') {
    return error(res, 'FORBIDDEN', 'Driver access required', 403);
  }
  if (!req.user.isVerified) {
    return error(res, 'NOT_VERIFIED', 'Driver verification pending', 403);
  }
  next();
};

module.exports = { authenticate, requireRider, requireDriver, requireVerifiedDriver };
