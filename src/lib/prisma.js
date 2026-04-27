const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Connection pool settings for production
  ...(process.env.NODE_ENV === 'production' && {
    connectionLimit: 20,
    poolTimeout: 10,
    idleTimeout: 300,
  }),
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});

// Monitor connection pool health
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.error('Database health check failed:', err.message);
    }
  }, 30000); // Every 30 seconds
}

module.exports = prisma;
