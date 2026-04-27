const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { loginLimiter } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/authenticate');
const { validate } = require('../middleware/validate');
const { riderRegisterSchema, driverRegisterSchema, loginSchema } = require('../validators');

router.post('/rider/register', validate(riderRegisterSchema), authController.riderRegister);
router.post('/driver/register', validate(driverRegisterSchema), authController.driverRegister);
router.post('/rider/login', loginLimiter, validate(loginSchema), authController.riderLogin);
router.post('/driver/login', loginLimiter, validate(loginSchema), authController.driverLogin);
router.get('/me', authenticate, authController.getMe);

module.exports = router;
