const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const { success, error } = require('../lib/response');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');
const matchingService = require('../services/matching.service');

// Get nearby drivers (for riders)
const getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius } = req.query;

    const drivers = await matchingService.findNearestDrivers(lat, lng, radius, 20);

    return success(res, { drivers, count: drivers.length });
  } catch (err) {
    next(err);
  }
};

// Update driver status (online/offline)
const updateStatus = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { isOnline } = req.body;

    // Only verified drivers can go online
    if (isOnline && !req.user.isVerified) {
      throw new AppError('NOT_VERIFIED', 'Driver verification pending. Cannot go online.', 403);
    }

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { isOnline },
      select: { id: true, isOnline: true, isVerified: true },
    });

    // If going offline, remove from Redis
    if (!isOnline) {
      await redis.del(`driver:${driverId}:location`);
    }

    logger.info(`Driver ${isOnline ? 'online' : 'offline'}`, { driverId });
    return success(res, { driver });
  } catch (err) {
    next(err);
  }
};

// Get driver earnings
const getEarnings = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { period = 'week' } = req.query; // week, month, all

    let dateFilter = {};
    const now = new Date();

    if (period === 'week') {
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      dateFilter = { completedAt: { gte: weekAgo } };
    } else if (period === 'month') {
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      dateFilter = { completedAt: { gte: monthAgo } };
    }

    const rides = await prisma.ride.findMany({
      where: {
        driverId,
        status: 'completed',
        ...dateFilter,
      },
      include: {
        payment: { select: { amount: true, status: true } },
      },
    });

    const totalEarnings = rides.reduce((sum, ride) => {
      return sum + (ride.payment?.amount || 0);
    }, 0);

    const completedRides = rides.length;
    const avgFare = completedRides > 0 ? Math.round(totalEarnings / completedRides) : 0;

    return success(res, {
      totalEarnings,
      completedRides,
      avgFare,
      period,
      rides: rides.slice(0, 10), // Last 10 rides
    });
  } catch (err) {
    next(err);
  }
};

// Get driver profile
const getProfile = async (req, res, next) => {
  try {
    const driverId = req.user.id;

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        phone: true,
        name: true,
        idNumber: true,
        licenseNumber: true,
        ratingAvg: true,
        isOnline: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        sacco: { select: { name: true, zone: true } },
        _count: {
          select: { rides: true },
        },
      },
    });

    return success(res, { driver });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNearbyDrivers,
  updateStatus,
  getEarnings,
  getProfile,
};
