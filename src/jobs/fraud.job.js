const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { auditLog, AUDIT_ACTIONS } = require('../lib/audit');

/**
 * Fraud Detection System
 * Runs periodically to detect suspicious patterns
 */

// Detect rapid ride completion (possible fake rides)
const detectRapidRides = async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const rapidRiders = await prisma.$queryRaw`
    SELECT rider_id, COUNT(*) as ride_count
    FROM rides
    WHERE completed_at > ${oneHourAgo}
      AND status = 'completed'
    GROUP BY rider_id
    HAVING COUNT(*) > 5
  `;

  for (const row of rapidRiders) {
    logger.warn('FRAUD_ALERT: Rapid ride pattern detected', {
      riderId: row.rider_id,
      rideCount: row.ride_count,
      period: '1 hour',
    });

    auditLog(AUDIT_ACTIONS.SUSPICIOUS_ACTIVITY, row.rider_id, {
      type: 'rapid_rides',
      rideCount: row.ride_count,
      period: '1 hour',
    });
  }
};

// Detect drivers with no GPS movement during rides
const detectStaticDrivers = async () => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const suspiciousDrivers = await prisma.$queryRaw`
    SELECT r.driver_id, COUNT(*) as ride_count
    FROM rides r
    JOIN driver_locations dl ON r.driver_id = dl.driver_id
    WHERE r.status = 'completed'
      AND r.completed_at > ${oneDayAgo}
      AND r.distance_km < 0.1
    GROUP BY r.driver_id
    HAVING COUNT(*) > 3
  `;

  for (const row of suspiciousDrivers) {
    logger.warn('FRAUD_ALERT: Static driver pattern detected', {
      driverId: row.driver_id,
      rideCount: row.ride_count,
      period: '24 hours',
    });

    auditLog(AUDIT_ACTIONS.SUSPICIOUS_ACTIVITY, row.driver_id, {
      type: 'static_driver',
      rideCount: row.ride_count,
      period: '24 hours',
    });
  }
};

// Detect duplicate device registrations
const detectDuplicateDevices = async () => {
  // This would require device fingerprinting in the mobile app
  // Placeholder for when device IDs are collected
  logger.info('Duplicate device detection: requires mobile app device fingerprinting');
};

// Detect payments from non-Kenyan numbers
const detectForeignPayments = async () => {
  const foreignPayments = await prisma.payment.findMany({
    where: {
      status: 'completed',
      initiatedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
    include: {
      rider: { select: { phone: true } },
    },
  });

  for (const payment of foreignPayments) {
    if (!payment.rider.phone.startsWith('254')) {
      logger.warn('FRAUD_ALERT: Payment from non-Kenyan number', {
        paymentId: payment.id,
        phone: payment.rider.phone,
        amount: payment.amount,
      });

      auditLog(AUDIT_ACTIONS.SUSPICIOUS_ACTIVITY, payment.riderId, {
        type: 'foreign_payment',
        phone: payment.rider.phone,
        amount: payment.amount,
      });
    }
  }
};

// Main fraud detection runner
const runFraudDetection = async () => {
  logger.info('Starting fraud detection scan');

  try {
    await detectRapidRides();
    await detectStaticDrivers();
    await detectForeignPayments();
    // await detectDuplicateDevices(); // Requires mobile app changes

    logger.info('Fraud detection scan completed');
  } catch (err) {
    logger.error('Fraud detection error', { error: err.message });
  }
};

// Start fraud detection job
const startFraudDetectionJob = () => {
  logger.info('Starting fraud detection job (every 30 minutes)');
  setInterval(runFraudDetection, 30 * 60 * 1000);

  // Run immediately on startup
  runFraudDetection();
};

module.exports = { startFraudDetectionJob, runFraudDetection };
