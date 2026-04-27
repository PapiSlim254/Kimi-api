const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/authenticate');

// M-Pesa callback (public - protected by IP whitelist)
router.post('/callback', paymentController.safaricomOnly, paymentController.handleCallback);

// Protected routes
router.get('/:rideId/status', authenticate, paymentController.getPaymentStatus);
router.post('/:rideId/retry', authenticate, paymentController.retryPayment);

module.exports = router;
