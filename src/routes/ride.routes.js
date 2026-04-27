const express = require('express');
const router = express.Router();
const rideController = require('../controllers/ride.controller');
const { authenticate, requireRider, requireDriver } = require('../middleware/authenticate');
const { validate, validateQuery } = require('../middleware/validate');
const { createRideSchema, cancelRideSchema } = require('../validators');

// Rider routes
router.post('/', authenticate, requireRider, validate(createRideSchema), rideController.createRide);
router.get('/history', authenticate, requireRider, rideController.getRiderRides);

// Driver routes
router.get('/driver/history', authenticate, requireDriver, rideController.getDriverRides);
router.patch('/:rideId/accept', authenticate, requireDriver, rideController.acceptRide);
router.patch('/:rideId/arriving', authenticate, requireDriver, rideController.driverArriving);
router.patch('/:rideId/start', authenticate, requireDriver, rideController.startRide);
router.patch('/:rideId/complete', authenticate, requireDriver, rideController.completeRide);

// Shared routes
router.get('/:rideId', authenticate, rideController.getRide);
router.patch('/:rideId/cancel', authenticate, validate(cancelRideSchema), rideController.cancelRide);

module.exports = router;
