const prisma = require('../lib/prisma');
const darajaService = require('../services/daraja.service');
const { emitToUser } = require('../services/socket.service');
const logger = require('../lib/logger');

// Reconcile pending payments that haven't received callbacks
const reconcilePendingPayments = async () => {
  try {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

    const stalePayments = await prisma.payment.findMany({
      where: {
        status: 'pending',
        initiatedAt: { lt: threeMinutesAgo },
      },
      include: {
        ride: { select: { riderId: true, driverId: true } },
      },
    });

    logger.info(`Reconciling ${stalePayments.length} stale payments`);

    for (const payment of stalePayments) {
      try {
        const result = await darajaService.querySTKStatus(payment.checkoutReqId);

        if (result.ResultCode === '0') {
          // Payment actually succeeded - callback was lost
          const mpesaRef = result.CallbackMetadata?.Item?.find(
            i => i.Name === 'MpesaReceiptNumber'
          )?.Value;

          if (mpesaRef) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                mpesaRef,
                status: 'completed',
                confirmedAt: new Date(),
              },
            });

            emitToUser(payment.ride.riderId, 'payment_confirmed', {
              rideId: payment.rideId,
              mpesaRef,
              amount: payment.amount,
            });
            emitToUser(payment.ride.driverId, 'payment_confirmed', {
              rideId: payment.rideId,
              mpesaRef,
              amount: payment.amount,
            });

            logger.info('Stale payment reconciled as completed', { 
              paymentId: payment.id, 
              mpesaRef 
            });
          }
        } else if (['1032', '1037'].includes(result.ResultCode)) {
          // Cancelled or timeout
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'failed' },
          });

          emitToUser(payment.ride.riderId, 'payment_failed', {
            rideId: payment.rideId,
            reason: result.ResultDesc,
          });

          logger.info('Stale payment reconciled as failed', { 
            paymentId: payment.id, 
            reason: result.ResultDesc 
          });
        }
        // If still pending, leave it for next reconciliation cycle
      } catch (err) {
        logger.error('Reconciliation failed for payment', { 
          paymentId: payment.id, 
          error: err.message 
        });
      }
    }
  } catch (err) {
    logger.error('Reconciliation job error', { error: err.message });
  }
};

// Start reconciliation interval
const startReconciliationJob = () => {
  logger.info('Starting payment reconciliation job (every 5 minutes)');
  setInterval(reconcilePendingPayments, 5 * 60 * 1000);
};

module.exports = { startReconciliationJob, reconcilePendingPayments };
