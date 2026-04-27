# ─── Stage 1: Dependencies ───────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production

# ─── Stage 2: Production Image ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Security: don't run as root
RUN addgroup -S bodamoja && adduser -S bodamoja -G bodamoja

# Copy dependencies from Stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy application source
COPY src ./src
COPY package*.json ./

# Create logs directory
RUN mkdir -p logs && chown -R bodamoja:bodamoja /app

# Switch to non-root user
USER bodamoja

EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
