const logger = require('./logger');

/**
 * Structured audit logging for security-sensitive operations
 * These logs are immutable records of who did what and when
 */
const auditLog = (action, userId, details = {}) => {
  logger.info('AUDIT', {
    action,
    userId,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

// Pre-defined audit actions
const AUDIT_ACTIONS = {
  // Auth
  RIDER_REGISTERED: 'RIDER_REGISTERED',
  DRIVER_REGISTERED: 'DRIVER_REGISTERED',
  RIDER_LOGIN: 'RIDER_LOGIN',
  DRIVER_LOGIN: 'DRIVER_LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',

  // Rides
  RIDE_CREATED: 'RIDE_CREATED',
  RIDE_ACCEPTED: 'RIDE_ACCEPTED',
  RIDE_STARTED: 'RIDE_STARTED',
  RIDE_COMPLETED: 'RIDE_COMPLETED',
  RIDE_CANCELLED: 'RIDE_CANCELLED',

  // Payments
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_FLAGGED: 'PAYMENT_FLAGGED',

  // Driver
  DRIVER_ONLINE: 'DRIVER_ONLINE',
  DRIVER_OFFLINE: 'DRIVER_OFFLINE',

  // Ratings
  RATING_SUBMITTED: 'RATING_SUBMITTED',

  // Security
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
};

module.exports = { auditLog, AUDIT_ACTIONS };
