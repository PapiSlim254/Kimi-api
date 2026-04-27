const prisma = require('../lib/prisma');
const { success, error } = require('../lib/response');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');
const { auditLog, AUDIT_ACTIONS } = require('../lib/audit');
const darajaService = require('../services/daraja.service');
const { emitToUser } = require('../services/socket.service');
const crypto = require('crypto');

// Safaricom IP whitelist
const SAFARICOM_IPS = [
  '196.201.214.200', '196.201.214.206', '196.201.213.114',
  '196.201.214.207', '196.201.214.208', '196.201.213.44',
  '196.201.212.127', '196.201.212.138', '196.201.212.129',
  '196.201.212.136', '196.201.212.74', '196.201.212.69',
];

// Callback URL secret token for additional verification
const CALLBACK_SECRET = process.env.DARAJA_CALLBACK_SECRET || process.env.JWT_SECRET;

const safaricomOnly = (req, res, next) => {
  // ALWAYS enforce IP check - never skip in any environment
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.headers['x-real-ip'] || 
             req.socket.remoteAddress;

  // Check if IP is in whitelist
  const isSafaricom = SAFARICOM_IPS.includes(ip);

  // Additional check: verify request has valid callback secret in header
  const callbackToken = req.headers['x-callback-secret'];
  const secretBuf = Buffer.from(CALLBACK_SECRET);
  const tokenBuf = callbackToken ? Buffer.from(callbackToken) : null;
  const hasValidSecret = tokenBuf !== null &&
    tokenBuf.length === secretBuf.length &&
    crypto.timingSafeEqual(tokenBuf, secretBuf);

  if (!isSafaricom && !hasValidSecret) {
    logger.warn('Blocked callback attempt', { 
      ip, 
      path: req.path,
      headers: Object.keys(req.headers),
      timestamp: new Date().toISOString()
    });
    return res.status(403).json({ message: 'Forbidden' });
  }

  next();
};

// Handle M-Pesa callback
const handleCallback = async (req, res) => {
  // Step 1: Acknowledge Safaricom immediately
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      logger.warn('Invalid callback payload received', { 
        body: req.body,
        ip: req.ip 
      });
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc } = callback;

    logger.info('M-Pesa callback received', { 
      checkoutRequestId: CheckoutRequestID, 
      resultCode: ResultCode,
      ip: req.ip
    });

    // Step 2: Verify CheckoutRequestID exists in our database
    const payment = await prisma.payment.findUnique({
      where: { checkoutReqId: CheckoutRequestID },
      include: { ride: { select: { riderId: true, driverId: true } } },
    });

    if (!payment) {
      logger.error('Payment not found for callback - possible fraud attempt', { 
        checkoutRequestId: CheckoutRequestID,
        ip: req.ip
      });
      return;
    }

    // Step 3: Handle failed payment
    if (ResultCode !== 0) {
      await prisma.payment.update({
        where: { checkoutReqId: CheckoutRequestID },
        data: { status: 'failed' },
      });

      auditLog(AUDIT_ACTIONS.PAYMENT_FAILED, payment.riderId, {
        rideId: payment.rideId,
        paymentId: payment.id,
        reason: ResultDesc,
      });

      emitToUser(payment.riderId, 'payment_failed', { 
        rideId: payment.rideId, 
        reason: ResultDesc 
      });
      emitToUser(payment.driverId, 'payment_failed', { 
        rideId: payment.rideId, 
        reason: ResultDesc 
      });

      logger.info('Payment marked as failed', { paymentId: payment.id, reason: ResultDesc });
      return;
    }

    // Step 4: Extract metadata
    const items = callback.CallbackMetadata?.Item || [];
    const getValue = (name) => items.find(i => i.Name === name)?.Value;

    const mpesaRef = getValue('MpesaReceiptNumber');
    const amount = getValue('Amount');

    if (!mpesaRef) {
      logger.error('Missing MpesaReceiptNumber in callback', { 
        checkoutRequestId: CheckoutRequestID 
      });
      return;
    }

    // Step 5: Idempotency check - CRITICAL
    const existing = await prisma.payment.findUnique({
      where: { mpesaRef },
    });

    if (existing?.status === 'completed') {
      logger.warn('Duplicate callback received', {
        mpesaRef,
        checkoutRequestId: CheckoutRequestID,
        existingPaymentId: existing.id
      });
      return;
    }

    // Step 6: Verify amount matches expected
    if (parseInt(amount) !== payment.amount) {
      logger.error('Amount mismatch', { 
        paymentId: payment.id,
        expected: payment.amount,
        received: amount,
        mpesaRef,
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'flagged' },
      });

      auditLog(AUDIT_ACTIONS.PAYMENT_FLAGGED, payment.riderId, {
        rideId: payment.rideId,
        paymentId: payment.id,
        expected: payment.amount,
        received: amount,
        mpesaRef,
      });

      logger.warn('PAYMENT_FLAGGED: Amount mismatch - requires manual review', {
        paymentId: payment.id,
        expected: payment.amount,
        received: amount,
        mpesaRef
      });
      return;
    }

    // Step 7: Cross-reference with Safaricom (async, don't block response)
    setImmediate(async () => {
      try {
        const statusCheck = await darajaService.querySTKStatus(CheckoutRequestID);
        if (statusCheck.ResultCode !== '0') {
          logger.warn('Safaricom status query mismatch', {
            paymentId: payment.id,
            callbackResult: ResultCode,
            queryResult: statusCheck.ResultCode
          });
        }
      } catch (err) {
        logger.error('Status query failed', { error: err.message });
      }
    });

    // Step 8: Confirm payment
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        mpesaRef,
        status: 'completed',
        confirmedAt: new Date(),
      },
    });

    auditLog(AUDIT_ACTIONS.PAYMENT_CONFIRMED, payment.riderId, {
      rideId: payment.rideId,
      paymentId: payment.id,
      mpesaRef,
      amount: payment.amount,
    });

    // Step 9: Notify both parties
    const eventData = {
      rideId: payment.rideId,
      mpesaRef,
      amount: payment.amount,
    };

    emitToUser(payment.riderId, 'payment_confirmed', eventData);
    emitToUser(payment.driverId, 'payment_confirmed', eventData);

    logger.info('Payment confirmed', { 
      paymentId: payment.id, 
      mpesaRef, 
      amount: payment.amount,
      rideId: payment.rideId
    });

  } catch (err) {
    logger.error('Callback processing error', { 
      error: err.message, 
      stack: err.stack,
      body: req.body 
    });
  }
};

// Get payment status
const getPaymentStatus = async (req, res, next) => {
  try {
    const { rideId } = req.params;
    const userId = req.user.id;

    const payment = await prisma.payment.findUnique({
      where: { rideId },
    });

    if (!payment) {
      throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    }

    if (payment.riderId !== userId && payment.driverId !== userId) {
      throw new AppError('FORBIDDEN', 'Access denied', 403);
    }

    return success(res, { payment });
  } catch (err) {
    next(err);
  }
};

// Retry failed payment (rider initiates)
const retryPayment = async (req, res, next) => {
  try {
    const { rideId } = req.params;
    const riderId = req.user.id;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { 
        rider: { select: { phone: true } },
        payment: true,
      },
    });

    if (!ride) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    if (ride.riderId !== riderId) throw new AppError('FORBIDDEN', 'Access denied', 403);
    if (ride.status !== 'completed') throw new AppError('RIDE_NOT_COMPLETED', 'Ride not completed', 422);

    if (ride.payment && ride.payment.status === 'pending') {
      try {
        const status = await darajaService.querySTKStatus(ride.payment.checkoutReqId);
        if (status.ResultCode === '0') {
          return success(res, { message: 'Payment already completed' });
        }
      } catch (err) {
        logger.warn('STK query failed during retry', { error: err.message });
      }
    }

    let payment;
    if (ride.payment) {
      payment = await prisma.payment.update({
        where: { rideId },
        data: { status: 'pending', initiatedAt: new Date() },
      });
    } else {
      payment = await prisma.payment.create({
        data: {
          rideId,
          riderId,
          driverId: ride.driverId,
          amount: ride.fareAmount,
          status: 'pending',
        },
      });
    }

    const stkResult = await darajaService.initiateSTKPush({
      phone: ride.rider.phone,
      amount: ride.fareAmount,
      rideId,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutReqId: stkResult.checkoutRequestId },
    });

    auditLog(AUDIT_ACTIONS.PAYMENT_INITIATED, riderId, {
      rideId,
      paymentId: payment.id,
      amount: ride.fareAmount,
      retry: true,
    });

    emitToUser(riderId, 'payment_initiated', { 
      rideId, 
      amount: ride.fareAmount 
    });

    return success(res, { message: 'Payment retry initiated' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  handleCallback,
  safaricomOnly,
  getPaymentStatus,
  retryPayment,
};
