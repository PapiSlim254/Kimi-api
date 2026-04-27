require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { initSocket } = require('./services/socket.service');
const logger = require('./lib/logger');
const { startReconciliationJob } = require('./jobs/reconcile.job');

const PORT = process.env.PORT || 3000;

// ── Environment Variable Validation ──────────────────────────────────────────
const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL', 
  'JWT_SECRET',
  'DARAJA_CONSUMER_KEY',
  'DARAJA_CONSUMER_SECRET',
  'DARAJA_SHORTCODE',
  'DARAJA_PASSKEY',
  'DARAJA_CALLBACK_URL',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please check your .env file and ensure all variables are set.');
  process.exit(1);
}

// Validate JWT_SECRET meets security requirements
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret.length < 64) {
  console.error('❌ JWT_SECRET must be at least 64 characters');
  process.exit(1);
}

const uniqueChars = new Set(jwtSecret).size;
if (uniqueChars < 16) {
  console.error('❌ JWT_SECRET has insufficient entropy');
  process.exit(1);
}

console.log('✅ Environment variables validated');

// ── Create HTTP Server ───────────────────────────────────────────────────────
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://bodamoja.com', 'https://www.bodamoja.com']
      : ['http://localhost:3000', 'http://localhost:19006'],
    methods: ['GET', 'POST'],
  },
  pingTimeout: 30000,
  pingInterval: 10000,
  // Connection limits
  maxHttpBufferSize: 1e6, // 1MB max message size
  perMessageDeflate: {
    threshold: 1024, // Only compress messages > 1KB
  },
});

initSocket(io);

// Start background jobs
startReconciliationJob();

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      const prisma = require('./lib/prisma');
      await prisma.$disconnect();
      logger.info('Database disconnected');

      const redis = require('./lib/redis');
      await redis.quit();
      logger.info('Redis disconnected');

      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

// ── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  logger.info(`🚀 Boda Moja API running on port ${PORT}`, {
    port: PORT,
    env: process.env.NODE_ENV,
    nodeVersion: process.version,
  });
});
