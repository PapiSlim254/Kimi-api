
================================================================================
                    BODA MOJA API - SECURITY & STABILITY AUDIT
================================================================================

AUDIT DATE: 2026-04-26
AUDITOR: Code Review (Automated + Manual)
STATUS: ⚠️ CONDITIONAL - Multiple issues must be fixed before public deployment

================================================================================
                              EXECUTIVE SUMMARY
================================================================================

OVERALL RATING: 🟡 MODERATE RISK - Not production-ready without fixes

The codebase implements most security controls from the Boda Moja documentation,
but has SEVERAL CRITICAL and HIGH severity issues that MUST be addressed before
any public deployment. Some issues could lead to immediate financial loss or 
data breaches.

CRITICAL ISSUES:     3 (must fix before launch)
HIGH ISSUES:         5 (fix within 48 hours of launch)
MEDIUM ISSUES:       4 (fix within 2 weeks)
LOW ISSUES:          3 (fix within 1 month)

================================================================================
                           CRITICAL ISSUES (Fix NOW)
================================================================================

[CRITICAL-1] ❌ JWT Secret Validation Too Weak
────────────────────────────────────────────────────────────────────────────────
FILE: src/lib/jwt.js
LINE: 5-7

  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

PROBLEM:
  - Only checks LENGTH, not RANDOMNESS or entropy
  - A secret like "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" passes validation
  - Documentation specifies "64+ characters" but code only enforces 32
  - No check that secret is actually hex/random

IMPACT: 
  Weak JWT secrets can be brute-forced, allowing complete account takeover
  of ALL users (riders AND drivers).

FIX:
  const crypto = require('crypto');

  // Validate entropy - reject low-entropy secrets
  const uniqueChars = new Set(JWT_SECRET).size;
  if (uniqueChars < 16) {
    throw new Error('JWT_SECRET has insufficient entropy');
  }

  // Enforce 64+ characters as documented
  if (!JWT_SECRET || JWT_SECRET.length < 64) {
    throw new Error('JWT_SECRET must be at least 64 characters');
  }

SEVERITY: 🔴 CRITICAL
DOCUMENT REF: security.md Section 2 ("JWT secret strength")


[CRITICAL-2] ❌ Missing Input Sanitization on Raw SQL Queries
────────────────────────────────────────────────────────────────────────────────
FILE: src/services/matching.service.js
LINES: 85-103 (findNearestFromDB fallback)

PROBLEM:
  The raw SQL query uses template literals with Prisma's $queryRaw, which 
  DOES parameterize values. However, the function falls back to this when
  Redis is unavailable, and there's NO validation that lat/lng are actually
  numbers before they reach the query.

  While Prisma's tagged template DOES parameterize, if someone bypasses
  validation and calls this directly with malicious input, it could cause
  issues.

  MORE SERIOUS: The nearbyDriversSchema validator uses z.coerce.number(),
  which means strings like "1; DROP TABLE users; --" would be coerced to NaN
  and potentially cause unexpected behavior.

IMPACT:
  Potential SQL injection if validation is bypassed or if coerce behavior
  changes. Could lead to data loss or unauthorized access.

FIX:
  1. Add explicit type checking before raw queries
  2. Use Prisma's queryRawUnsafe ONLY as last resort
  3. Add additional numeric range validation

SEVERITY: 🔴 CRITICAL
DOCUMENT REF: security.md Section 4 ("SQL injection")


[CRITICAL-3] ❌ Payment Callback Missing Signature Verification
────────────────────────────────────────────────────────────────────────────────
FILE: src/controllers/payment.controller.js
LINES: 12-32 (safaricomOnly middleware)

PROBLEM:
  The IP whitelist is the ONLY protection on the callback endpoint.
  However:
  - X-Forwarded-For headers can be SPOOFED if not properly configured
  - Safaricom's IPs could change without notice
  - In development mode, IP check is COMPLETELY DISABLED
  - There's NO cryptographic signature verification on callbacks

  The documentation mentions "Safaricom does not sign its callbacks" but 
  RECOMMENDS IP whitelisting as the primary defense. However, relying on
  IP alone is insufficient for financial transactions.

IMPACT:
  If an attacker discovers the callback URL, they could forge payment
  confirmations, marking rides as paid when no money was transferred.
  This is DIRECT FINANCIAL FRAUD.

FIX:
  1. Add a shared secret/token in callback URL (e.g., /payments/callback/:token)
  2. Verify CheckoutRequestID exists in database before processing
  3. Cross-reference with Safaricom's transaction status API
  4. Add callback nonce/timestamp validation to prevent replay attacks
  5. NEVER disable IP check in production - use a separate dev endpoint

SEVERITY: 🔴 CRITICAL
DOCUMENT REF: daraja.md Section 13 ("Validate callback origin")


================================================================================
                            HIGH ISSUES (Fix within 48h)
================================================================================

[HIGH-1] ⚠️ No HTTPS Enforcement in Development
────────────────────────────────────────────────────────────────────────────────
FILE: src/app.js
LINE: 14-20 (CORS configuration)

PROBLEM:
  In development, CORS allows ALL origins ('*'). While acceptable for local
  dev, there's no mechanism to BLOCK non-HTTPS connections in production.
  The app relies on Nginx for TLS termination, but if Nginx is misconfigured
  or bypassed, the API accepts plain HTTP.

FIX:
  Add HSTS header and HTTPS redirect middleware:

  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, 'https://' + req.headers.host + req.url);
      }
      next();
    });
  }

SEVERITY: 🟠 HIGH
DOCUMENT REF: security.md Section 4 ("HTTPS enforcement")


[HIGH-2] ⚠️ Missing Request Size Limits on Socket.io
────────────────────────────────────────────────────────────────────────────────
FILE: src/services/socket.service.js

PROBLEM:
  Socket.io events have NO payload size limits. A malicious client could
  send massive payloads causing memory exhaustion.

FIX:
  Add payload validation in socket middleware:

  io.use((socket, next) => {
    const originalEmit = socket.emit;
    socket.emit = function(event, ...args) {
      const payload = JSON.stringify(args);
      if (payload.length > 10000) { // 10KB limit
        logger.warn('Socket payload too large', { event, size: payload.length });
        return;
      }
      return originalEmit.apply(this, [event, ...args]);
    };
    next();
  });

SEVERITY: 🟠 HIGH
DOCUMENT REF: websockets.md Section 11 ("Connection Resilience")


[HIGH-3] ⚠️ No Rate Limiting on Socket.io Connections
────────────────────────────────────────────────────────────────────────────────
FILE: src/services/socket.service.js

PROBLEM:
  While HTTP routes have rate limiting, Socket.io connections do NOT.
  An attacker could open thousands of WebSocket connections, exhausting
  server resources.

FIX:
  Implement connection rate limiting per IP:

  const connectionCounts = new Map();

  io.use((socket, next) => {
    const ip = socket.handshake.address;
    const count = connectionCounts.get(ip) || 0;
    if (count > 10) { // Max 10 connections per IP
      return next(new Error('Too many connections'));
    }
    connectionCounts.set(ip, count + 1);
    socket.on('disconnect', () => {
      connectionCounts.set(ip, (connectionCounts.get(ip) || 1) - 1);
    });
    next();
  });

SEVERITY: 🟠 HIGH


[HIGH-4] ⚠️ Missing Database Connection Pooling Configuration
────────────────────────────────────────────────────────────────────────────────
FILE: src/lib/prisma.js

PROBLEM:
  PrismaClient is instantiated with default connection pool settings.
  Under high load, this could exhaust database connections.

FIX:
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Connection pool settings
    connectionLimit: 20,
    poolTimeout: 10,
    // Logging
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });

SEVERITY: 🟠 HIGH
DOCUMENT REF: devops.md Section 2 ("Production Image")


[HIGH-5] ⚠️ No Backup Verification or Monitoring
────────────────────────────────────────────────────────────────────────────────
FILE: docker-compose.yml, devops.md

PROBLEM:
  The documentation mentions automated backups but:
  - No backup verification job is implemented
  - No alerting if backups fail
  - No tested restore procedure
  - Database backups are NOT encrypted at rest

IMPACT:
  Data loss if backups are corrupt or unrecoverable.

FIX:
  1. Add backup verification script that restores to staging monthly
  2. Encrypt backups with GPG before storing
  3. Add monitoring/alerting for backup failures
  4. Document restore procedure

SEVERITY: 🟠 HIGH
DOCUMENT REF: security.md Section 5 ("Backups")


================================================================================
                           MEDIUM ISSUES (Fix within 2 weeks)
================================================================================

[MEDIUM-1] ⚠️ Missing Audit Logging on Sensitive Operations
────────────────────────────────────────────────────────────────────────────────
FILE: Multiple controllers

PROBLEM:
  While application errors are logged, there's no structured audit logging
  for:
  - Account logins (success AND failure)
  - Ride cancellations
  - Payment confirmations
  - Driver status changes
  - Admin actions

FIX:
  Add audit logger:

  const auditLog = (action, userId, details) => {
    logger.info('AUDIT', { action, userId, details, timestamp: new Date().toISOString() });
  };

  // Use in controllers:
  auditLog('RIDE_CANCELLED', req.user.id, { rideId, reason });

SEVERITY: 🟡 MEDIUM
DOCUMENT REF: security.md Section 10 ("Audit Logs")


[MEDIUM-2] ⚠️ No Fraud Detection Implementation
────────────────────────────────────────────────────────────────────────────────
FILE: N/A - Missing entirely

PROBLEM:
  The documentation describes fraud detection patterns (rapid rides, same
  device accounts, GPS anomalies) but NO implementation exists.

FIX:
  Implement fraud detection job:
  - Flag riders with >5 completed rides in 1 hour
  - Detect drivers completing rides with no GPS movement
  - Alert on payments from non-Kenyan numbers
  - Flag duplicate device registrations

SEVERITY: 🟡 MEDIUM
DOCUMENT REF: security.md Section 9 ("Fraud Prevention")


[MEDIUM-3] ⚠️ Missing Content Security Policy Headers
────────────────────────────────────────────────────────────────────────────────
FILE: src/app.js

PROBLEM:
  Helmet is used but CSP is not explicitly configured. The default Helmet
  CSP might be too permissive.

FIX:
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.safaricom.co.ke"],
        // Add other directives as needed
      },
    },
  }));

SEVERITY: 🟡 MEDIUM


[MEDIUM-4] ⚠️ Environment Variable Exposure Risk
────────────────────────────────────────────────────────────────────────────────
FILE: .env.example

PROBLEM:
  The .env.example file is safe, but there's no runtime validation that
  all required environment variables are set. Missing vars could cause
  crashes or fallback to insecure defaults.

FIX:
  Add startup validation:

  const requiredEnvVars = [
    'DATABASE_URL', 'JWT_SECRET', 'REDIS_URL',
    'DARAJA_CONSUMER_KEY', 'DARAJA_CONSUMER_SECRET',
    'DARAJA_SHORTCODE', 'DARAJA_PASSKEY', 'DARAJA_CALLBACK_URL'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

SEVERITY: 🟡 MEDIUM


================================================================================
                            LOW ISSUES (Fix within 1 month)
================================================================================

[LOW-1] ℹ️ No API Versioning
────────────────────────────────────────────────────────────────────────────────
FILE: src/app.js

PROBLEM:
  All routes are at root level. When v2 is needed, breaking changes
  will affect all clients.

FIX:
  Prefix all routes with /v1/:
  app.use('/v1/auth', authRoutes);
  app.use('/v1/rides', rideRoutes);
  // etc

SEVERITY: 🟢 LOW


[LOW-2] ℹ️ Missing API Documentation (OpenAPI/Swagger)
────────────────────────────────────────────────────────────────────────────────
FILE: N/A

PROBLEM:
  No machine-readable API documentation exists. Frontend developers must
  read source code to understand endpoints.

FIX:
  Add swagger-jsdoc and swagger-ui-express:

  const swaggerUi = require('swagger-ui-express');
  const swaggerDocument = require('./swagger.json');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

SEVERITY: 🟢 LOW


[LOW-3] ℹ️ No Request ID Tracing
────────────────────────────────────────────────────────────────────────────────
FILE: src/app.js

PROBLEM:
  No unique request IDs for tracing requests across logs, making debugging
  distributed issues difficult.

FIX:
  Add request ID middleware:

  const { v4: uuidv4 } = require('uuid');
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

SEVERITY: 🟢 LOW


================================================================================
                         STABILITY ASSESSMENT
================================================================================

POSITIVE INDICATORS:
✅ Graceful shutdown handling (SIGTERM/SIGINT)
✅ Database disconnect on shutdown
✅ Redis disconnect on shutdown
✅ Health check endpoint (/health)
✅ Docker multi-stage build for smaller images
✅ Non-root container user
✅ Internal Docker network isolation
✅ Connection retry logic for Redis
✅ Prisma connection pooling (default, could be tuned)

CONCERNS:
⚠️ No circuit breaker for Daraja API calls
⚠️ No queue for failed M-Pesa operations (rides complete even if payment fails)
⚠️ No auto-scaling configuration
⚠️ Single point of failure (one API container)
⚠️ No database read replicas configured
⚠️ Memory leaks possible in Socket.io if rooms aren't cleaned up
⚠️ No process memory monitoring

STABILITY RATING: 🟡 MODERATE - Works for soft launch (50 drivers, 500 riders)
                  Will need work before scaling to 500+ drivers

================================================================================
                         DEPLOYMENT READINESS CHECKLIST
================================================================================

BEFORE ANY PUBLIC DEPLOYMENT, ALL OF THESE MUST BE TRUE:

[ ] CRITICAL-1 fixed: JWT secret enforces 64+ chars and entropy check
[ ] CRITICAL-2 fixed: Raw SQL has additional input validation
[ ] CRITICAL-3 fixed: Callback has signature/nonce verification + never skips IP check
[ ] HIGH-1 fixed: HTTPS enforcement in production
[ ] HIGH-3 fixed: Socket.io connection rate limiting
[ ] Environment variables validated at startup
[ ] Database backups configured and tested
[ ] Sentry or similar error monitoring configured
[ ] Uptime monitoring on /health endpoint
[ ] Load testing completed (simulate 100 concurrent rides)
[ ] Penetration test by third party (recommended, not required for soft launch)
[ ] Kenya Data Protection Act compliance review
[ ] Incident response plan documented
[ ] Rollback procedure tested

================================================================================
                              FINAL VERDICT
================================================================================

🟡 CONDITIONAL PASS - NOT PRODUCTION-READY

The codebase is a SOLID FOUNDATION that implements most security controls
from the Boda Moja documentation. However, the 3 CRITICAL issues MUST be fixed
before any public deployment, as they could lead to:

1. Complete account takeover (weak JWT secrets)
2. Data breach or loss (SQL injection risk)
3. Financial fraud (forged payment callbacks)

For a SOFT LAUNCH with 10-50 trusted drivers and friends/family riders:
- Fix CRITICAL issues first
- Fix HIGH-1 and HIGH-3
- Deploy with monitoring
- Have rollback plan ready

For FULL PUBLIC LAUNCH:
- Fix ALL issues in this report
- Add fraud detection
- Conduct penetration testing
- Implement backup verification
- Set up 24/7 monitoring and alerting

ESTIMATED TIME TO FIX CRITICAL ISSUES: 2-4 hours
ESTIMATED TIME TO FIX ALL HIGH ISSUES: 1-2 days
ESTIMATED TIME TO PRODUCTION-READY: 1 week

================================================================================
