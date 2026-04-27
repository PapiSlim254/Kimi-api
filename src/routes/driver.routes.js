const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driver.controller');
const { authenticate, requireDriver, requireVerifiedDriver } = require('../middleware/authenticate');
const { validate, validateQuery } = require('../middleware/validate');
const { driverStatusSchema, nearbyDriversSchema } = require('../validators');

router.get('/nearby', authenticate, validateQuery(nearbyDriversSchema), driverController.getNearbyDrivers);
router.patch('/me/status', authenticate, requireDriver, validate(driverStatusSchema), driverController.updateStatus);
router.get('/me/earnings', authenticate, requireDriver, driverController.getEarnings);
router.get('/me/profile', authenticate, requireDriver, driverController.getProfile);

module.exports = router;
