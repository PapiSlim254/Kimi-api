const prisma = require('../lib/prisma');
const { success, error } = require('../lib/response');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');

const createRating = async (req, res, next) => {
  try {
    const { id: raterId, role: raterRole } = req.user;
    const { rideId, score, comment } = req.body;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        ratings: true,
      },
    });

    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    if (ride.status !== 'completed') {
      throw new AppError('RIDE_NOT_COMPLETED', 'Can only rate completed rides', 422);
    }

    // Determine who is being rated
    let ratedId;
    if (raterRole === 'rider') {
      if (ride.riderId !== raterId) {
        throw new AppError('FORBIDDEN', 'You are not part of this ride', 403);
      }
      ratedId = ride.driverId;
    } else {
      if (ride.driverId !== raterId) {
        throw new AppError('FORBIDDEN', 'You are not part of this ride', 403);
      }
      ratedId = ride.riderId;
    }

    if (!ratedId) {
      throw new AppError('INVALID_RATING', 'Cannot rate - other party not found', 422);
    }

    // Check if already rated
    const existing = ride.ratings.find(r => r.raterId === raterId);
    if (existing) {
      throw new AppError('ALREADY_RATED', 'You have already rated this ride', 409);
    }

    // Create rating
    const rating = await prisma.rating.create({
      data: {
        rideId,
        raterId,
        ratedId,
        score,
        comment,
      },
    });

    // Update driver's average rating if driver was rated
    if (raterRole === 'rider') {
      const avgResult = await prisma.rating.aggregate({
        where: { ratedId: ride.driverId },
        _avg: { score: true },
      });

      await prisma.driver.update({
        where: { id: ride.driverId },
        data: { ratingAvg: avgResult._avg.score || 5 },
      });
    }

    logger.info('Rating created', { ratingId: rating.id, rideId, score });
    return success(res, { rating }, 'Rating submitted', 201);
  } catch (err) {
    next(err);
  }
};

// Get ratings for a driver
const getDriverRatings = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where: { ratedId: driverId },
        include: {
          ride: {
            select: {
              pickupAddress: true,
              dropoffAddress: true,
              completedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.rating.count({ where: { ratedId: driverId } }),
    ]);

    return success(res, { ratings, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createRating,
  getDriverRatings,
};
