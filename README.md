# Boda Moja API

> Ride-hailing platform backend for Nairobi — Node.js, PostgreSQL, Redis, Socket.io, M-Pesa Daraja

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16 with PostGIS extension
- Redis 7

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Set up database
```bash
# Create PostgreSQL extension (one-time)
psql -U postgres -d bodamoja -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run migrations
npx prisma migrate dev --name init

# Seed test data
npm run db:seed
```

### 4. Start development server
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/rider/register` | Register new rider |
| POST | `/auth/driver/register` | Register new driver |
| POST | `/auth/rider/login` | Rider login |
| POST | `/auth/driver/login` | Driver login |
| GET | `/auth/me` | Get current user |

### Rides
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/rides` | Rider | Create ride request |
| GET | `/rides/history` | Rider | Get rider ride history |
| GET | `/rides/driver/history` | Driver | Get driver ride history |
| GET | `/rides/:rideId` | Both | Get ride details |
| PATCH | `/rides/:rideId/accept` | Driver | Accept ride request |
| PATCH | `/rides/:rideId/arriving` | Driver | Mark as arriving |
| PATCH | `/rides/:rideId/start` | Driver | Start ride |
| PATCH | `/rides/:rideId/complete` | Driver | Complete ride & initiate payment |
| PATCH | `/rides/:rideId/cancel` | Both | Cancel ride |

### Drivers
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/drivers/nearby` | Both | Find nearby drivers |
| PATCH | `/drivers/me/status` | Driver | Toggle online/offline |
| GET | `/drivers/me/earnings` | Driver | Get earnings summary |
| GET | `/drivers/me/profile` | Driver | Get driver profile |

### Payments
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/payments/callback` | Public | M-Pesa callback (IP-whitelisted) |
| GET | `/payments/:rideId/status` | Both | Get payment status |
| POST | `/payments/:rideId/retry` | Rider | Retry failed payment |

### Ratings
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/ratings` | Both | Submit rating |
| GET | `/ratings/driver/:driverId` | Both | Get driver ratings |

## WebSocket Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `location_update` | `{ lat, lng }` | Driver GPS update |
| `go_online` | — | Driver goes online |
| `go_offline` | — | Driver goes offline |
| `join_ride_room` | `{ rideId }` | Join ride-specific room |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `ride_requested` | `{ rideId, pickup, dropoff, estimatedFare }` | New ride request to driver |
| `ride_accepted` | `{ rideId, driver }` | Driver accepted ride |
| `ride_cancelled` | `{ rideId, reason }` | Ride cancelled |
| `driver_arriving` | `{ rideId }` | Driver arriving at pickup |
| `ride_started` | `{ rideId, startedAt }` | Ride started |
| `ride_completed` | `{ rideId, fare, distance }` | Ride completed |
| `driver_location` | `{ lat, lng }` | Live driver location |
| `no_drivers_found` | `{ rideId }` | No drivers available |
| `payment_initiated` | `{ rideId, amount }` | M-Pesa prompt sent |
| `payment_confirmed` | `{ rideId, mpesaRef, amount }` | Payment successful |
| `payment_failed` | `{ rideId, reason }` | Payment failed |

## Deployment

### Docker (local/production)
```bash
docker compose up -d
```

### CI/CD (GitHub Actions)
Push to `main` branch triggers automatic build and deploy to DigitalOcean.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Min 32 chars, random |
| `DARAJA_CONSUMER_KEY` | Safaricom developer portal |
| `DARAJA_CONSUMER_SECRET` | Safaricom developer portal |
| `DARAJA_SHORTCODE` | M-Pesa paybill number |
| `DARAJA_PASSKEY` | Daraja passkey |
| `DARAJA_CALLBACK_URL` | Public callback endpoint |
| `NODE_ENV` | development / production |
| `PORT` | Server port (default 3000) |

## Architecture

```
Rider/Driver Apps
       ↓ HTTPS / WebSocket
    Nginx (TLS, rate limit)
       ↓
   Node.js API (stateless)
       ↓              ↓
   PostgreSQL      Redis
   + PostGIS      (locations,
   (trips,         cache,
    payments,      queues)
    users)
       ↓
   Daraja API (M-Pesa)
```

## License

MIT
