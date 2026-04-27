const logger = require('../lib/logger');
const { verifyToken } = require('../lib/jwt');

let io;

// Map userId -> Set of socket IDs (one user can have multiple connections)
const userSockets = new Map();

const initSocket = (ioInstance) => {
  io = ioInstance;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyToken(token);
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    logger.info('Socket connected', { userId, socketId: socket.id });

    socket.on('join_ride', ({ rideId }) => {
      if (rideId) {
        socket.join(`ride:${rideId}`);
        logger.info('Socket joined ride room', { userId, rideId });
      }
    });

    socket.on('update_location', ({ lat, lng }) => {
      if (socket.user?.role === 'driver' && lat && lng) {
        const prisma = require('../lib/prisma');
        prisma.driverLocation
          .upsert({
            where: { driverId: userId },
            update: { lat: lat.toString(), lng: lng.toString(), updatedAt: new Date() },
            create: { driverId: userId, lat: lat.toString(), lng: lng.toString() },
          })
          .catch((err) => logger.error('Location update failed', { error: err.message }));
      }
    });

    socket.on('disconnect', () => {
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
      logger.info('Socket disconnected', { userId, socketId: socket.id });
    });
  });

  logger.info('Socket.io initialized');
};

const emitToUser = (userId, event, data) => {
  if (!io) return;
  const sockets = userSockets.get(userId);
  if (sockets && sockets.size > 0) {
    sockets.forEach((socketId) => {
      io.to(socketId).emit(event, data);
    });
  }
};

const emitToRide = (rideId, event, data) => {
  if (!io) return;
  io.to(`ride:${rideId}`).emit(event, data);
};

module.exports = { initSocket, emitToUser, emitToRide };
