const prisma = require('../lib/prisma');
const { success, error } = require('../lib/response');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');
const { auditLog, AUDIT_ACTIONS } = require('../lib/audit');
const matchingService = require('../services/matching.service');
const darajaService = require('../services/daraja.service');
const { emitToUser, emitToRide } = require('../services/socket.service');

const VALID_TRANSITIONS = {
  requested: ['accepted', 'cancelled'],
  accepted: ['driver_arriving', 'cancelled'],
  driver_arriving: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

const validateTransition = (currentStatus, newStatus) => {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new AppError(
      'RIDE_WRONG_STATUS',
      `Cannot move ride from '${currentStatus}' to '${newStatus}'`,
      422
    );
  }
};

// Create a new ride request
const createRide = async (req, res, next) => {
  try {
    const riderId = req.user.id;
    const { pickupLat, pickupLng, pickupAddress, dropoffLat, dropoffLng, dropoffAddress } = req.body;

    // Check if rider has active ride
    const activeRide = await prisma.ride.findFirst({
      where: {
        riderId,
        status: { in: ['requested', 'accepted', 'driver_arriving', 'in_progress'] },
      },
    });

    if (activeRide) {
      throw new AppError('ACTIVE_RIDE_EXISTS', 'You already have an active ride', 409);
    }

    // Calculate fare estimate
    const estimate = matchingService.estimateRide(pickupLat, pickupLng, dropoffLat, dropoffLng);

    // Create ride
    const ride = await prisma.ride.create({
      data: {
        riderId,
        pickupLat: pickupLat.toString(),
        pickupLng: pickupLng.toString(),
        pickupAddress,
        dropoffLat: dropoffLat.toString(),
        dropoffLng: dropoffLng.toString(),
        dropoffAddress,
        distanceKm: estimate.distanceKm.toString(),
        fareAmount: estimate.fare,
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
      },
    });

    auditLog(AUDIT_ACTIONS.RIDE_CREATED, riderId, {
      rideId: ride.id,
      fare: estimate.fare,
      distance: estimate.distanceKm,
    });

    logger.info('Ride created', { rideId: ride.id, riderId, fare: estimate.fare });

    // Find nearest drivers
    const nearbyDrivers = await matchingService.findNearestDrivers(pickupLat, pickupLng, 3000, 5);

    if (nearbyDrivers.length === 0) {
      await prisma.ride.update({
        where: { id: ride.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'No drivers available' },
      });

      emitToUser(riderId, 'no_drivers_found', { rideId: ride.id });
      return success(res, { rideId: ride.id, status: 'no_drivers_found', message: 'No drivers available nearby' });
    }

    // Send ride request to nearest driver
    const nearestDriver = nearbyDrivers[0];
    emitToUser(nearestDriver.id, 'ride_requested', {
      rideId: ride.id,
      pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
      dropoff: { lat: dropoffLat, lng: dropoffLng, address: dropoffAddress },
      estimatedFare: estimate.fare,
      estimatedDistance: estimate.distanceKm,
      riderId,
      riderName: ride.rider.name,
    });

    // Set timeout to try next driver
    setTimeout(async () => {
      try {
        const current = await prisma.ride.findUnique({ where: { id: ride.id } });
        if (current && current.status === 'requested') {
          const nextDrivers = nearbyDrivers.slice(1);
          if (nextDrivers.length > 0) {
            const nextDriver = nextDrivers[0];
            emitToUser(nextDriver.id, 'ride_requested', {
              rideId: ride.id,
              pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
              dropoff: { lat: dropoffLat, lng: dropoffLng, address: dropoffAddress },
              estimatedFare: estimate.fare,
              riderId,
            });
          } else {
            await prisma.ride.update({
              where: { id: ride.id },
              data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'No drivers available' },
            });
            emitToUser(riderId, 'no_drivers_found', { rideId: ride.id });
          }
        }
      } catch (err) {
        logger.error('Ride timeout handling failed', { rideId: ride.id, error: err.message });
      }
    }, 30000);

    return success(res, { 
      rideId: ride.id, 
      status: 'requested',
      estimatedFare: estimate.fare,
      estimatedDistance: estimate.distanceKm,
    }, 'Ride request created', 201);
  } catch (err) {
    next(err);
  }
};

// Driver accepts ride
const acceptRide = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { rideId } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { rider: { select: { id: true, name: true, phone: true } } },
    });

    if (!ride) {
      throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    }

    if (ride.status !== 'requested') {
      throw new AppError('RIDE_NOT_AVAILABLE', 'Ride is no longer available', 409);
    }

    const updated = await prisma.ride.update({
      where: { id: rideId },
      data: { 
        driverId, 
        status: 'accepted', 
        acceptedAt: new Date() 
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true, ratingAvg: true } },
      },
    });

    auditLog(AUDIT_ACTIONS.RIDE_ACCEPTED, driverId, {
      rideId: ride.id,
      riderId: ride.riderId,
    });

    logger.info('Ride accepted', { rideId, driverId, riderId: ride.riderId });

    emitToUser(ride.riderId, 'ride_accepted', {
      rideId: ride.id,
      driver: {
        id: updated.driver.id,
        name: updated.driver.name,
        phone: updated.driver.phone,
        ratingAvg: updated.driver.ratingAvg,
      },
    });

    emitToUser(driverId, 'join_ride_room', { rideId: ride.id });

    return success(res, { ride: updated });
  } catch (err) {
    next(err);
  }
};

// Driver marks as arriving
const driverArriving = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { rideId } = req.params;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);

    if (ride.driverId !== driverId) {
      throw new AppError('FORBIDDEN', 'You are not assigned to this ride', 403);
    }

    validateTransition(ride.status, 'driver_arriving');

    await prisma.ride.update({
      where: { id: rideId },
      data: { status: 'driver_arriving' },
    });

    emitToUser(ride.riderId, 'driver_arriving', { rideId });
    logger.info('Driver arriving', { rideId, driverId });

    return success(res, { status: 'driver_arriving' });
  } catch (err) {
    next(err);
  }
};

// Start ride
const startRide = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { rideId } = req.params;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);

    if (ride.driverId !== driverId) {
      throw new AppError('FORBIDDEN', 'You are not assigned to this ride', 403);
    }

    validateTransition(ride.status, 'in_progress');

    await prisma.ride.update({
      where: { id: rideId },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    auditLog(AUDIT_ACTIONS.RIDE_STARTED, driverId, { rideId });
    emitToRide(rideId, 'ride_started', { rideId, startedAt: new Date() });
    logger.info('Ride started', { rideId, driverId });

    return success(res, { status: 'in_progress' });
  } catch (err) {
    next(err);
  }
};

// Complete ride and initiate payment
const completeRide = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { rideId } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { rider: { select: { phone: true } } },
    });

    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);

    if (ride.driverId !== driverId) {
      throw new AppError('FORBIDDEN', 'You are not assigned to this ride', 403);
    }

    validateTransition(ride.status, 'completed');

    const updated = await prisma.ride.update({
      where: { id: rideId },
      data: { status: 'completed', completedAt: new Date() },
    });

    const payment = await prisma.payment.create({
      data: {
        rideId,
        riderId: ride.riderId,
        driverId,
        amount: ride.fareAmount,
        status: 'pending',
      },
    });

    auditLog(AUDIT_ACTIONS.RIDE_COMPLETED, driverId, {
      rideId,
      paymentId: payment.id,
      amount: ride.fareAmount,
    });

    logger.info('Ride completed, payment pending', { rideId, paymentId: payment.id, amount: ride.fareAmount });

    // Initiate M-Pesa STK Push
    try {
      const stkResult = await darajaService.initiateSTKPush({
        phone: ride.rider.phone,
        amount: ride.fareAmount,
        rideId,
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { checkoutReqId: stkResult.checkoutRequestId },
      });

      auditLog(AUDIT_ACTIONS.PAYMENT_INITIATED, ride.riderId, {
        rideId,
        paymentId: payment.id,
        amount: ride.fareAmount,
      });

      emitToUser(ride.riderId, 'payment_initiated', { 
        rideId, 
        amount: ride.fareAmount,
        phone: ride.rider.phone,
      });
    } catch (err) {
      logger.error('STK Push failed', { rideId, error: err.message });
      emitToUser(ride.riderId, 'payment_failed', { 
        rideId, 
        reason: 'Payment initiation failed. Please pay the driver directly.' 
      });
    }

    emitToRide(rideId, 'ride_completed', { 
      rideId, 
      fare: ride.fareAmount,
      distance: ride.distanceKm,
    });

    return success(res, { status: 'completed', fare: ride.fareAmount });
  } catch (err) {
    next(err);
  }
};

// Cancel ride
const cancelRide = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { rideId } = req.params;
    const { reason } = req.body;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);

    const isRider = userRole === 'rider' && ride.riderId === userId;
    const isDriver = userRole === 'driver' && ride.driverId === userId;

    if (!isRider && !isDriver) {
      throw new AppError('FORBIDDEN', 'You are not part of this ride', 403);
    }

    if (['completed', 'cancelled'].includes(ride.status)) {
      throw new AppError('RIDE_WRONG_STATUS', `Ride is already ${ride.status}`, 422);
    }

    await prisma.ride.update({
      where: { id: rideId },
      data: { 
        status: 'cancelled', 
        cancelledAt: new Date(), 
        cancelReason: reason || `${userRole} cancelled` 
      },
    });

    auditLog(AUDIT_ACTIONS.RIDE_CANCELLED, userId, {
      rideId,
      cancelledBy: userRole,
      reason: reason || `${userRole} cancelled`,
    });

    const notifyId = isRider ? ride.driverId : ride.riderId;
    if (notifyId) {
      emitToUser(notifyId, 'ride_cancelled', { 
        rideId, 
        reason: reason || `${userRole} cancelled`,
        cancelledBy: userRole,
      });
    }

    logger.info('Ride cancelled', { rideId, cancelledBy: userRole, reason });
    return success(res, { status: 'cancelled' });
  } catch (err) {
    next(err);
  }
};

// Get ride details
const getRide = async (req, res, next) => {
  try {
    const { rideId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true, ratingAvg: true } },
        payment: { select: { status: true, amount: true, mpesaRef: true } },
      },
    });

    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);

    const isRider = userRole === 'rider' && ride.riderId === userId;
    const isDriver = userRole === 'driver' && ride.driverId === userId;

    if (!isRider && !isDriver) {
      throw new AppError('FORBIDDEN', 'You are not part of this ride', 403);
    }

    return success(res, { ride });
  } catch (err) {
    next(err);
  }
};

// Get rider's ride history
const getRiderRides = async (req, res, next) => {
  try {
    const riderId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const where = { riderId };
    if (status) where.status = status;

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, phone: true, ratingAvg: true } },
          payment: { select: { status: true, amount: true } },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.ride.count({ where }),
    ]);

    return success(res, { rides, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) {
    next(err);
  }
};

// Get driver's ride history
const getDriverRides = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const where = { driverId };
    if (status) where.status = status;

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: {
          rider: { select: { id: true, name: true, phone: true } },
          payment: { select: { status: true, amount: true } },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.ride.count({ where }),
    ]);

    return success(res, { rides, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createRide,
  acceptRide,
  driverArriving,
  startRide,
  completeRide,
  cancelRide,
  getRide,
  getRiderRides,
  getDriverRides,
};
