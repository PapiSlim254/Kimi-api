# Boda Moja — Database Reference

**Engine:** PostgreSQL 16 + PostGIS 3.4
**Name:** `bodamoja`
**ORM:** Prisma 5

---

## Tables

### `saccos` — Boda boda associations

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | text | e.g. "Westlands Boda Association" |
| zone | text | Area they operate in |
| chairman | text | Optional |
| isActive | boolean | Default true |

---

### `users` — Riders (the people booking)

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| phone | text | Unique, format `254XXXXXXXXX` |
| name | text | |
| password | text | bcrypt hashed (12 rounds) |
| isActive | boolean | Can be suspended by admin |
| createdAt / updatedAt | timestamp | |

---

### `drivers` — Boda boda drivers

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| phone | text | Unique |
| password | text | bcrypt hashed (12 rounds) |
| idNumber | text | National ID — unique |
| licenseNumber | text | Unique |
| saccoId | UUID | Optional FK → saccos |
| ratingAvg | decimal(3,2) | Starts at 5.00, updated after each rated ride |
| isOnline | boolean | Whether they are currently taking rides |
| isVerified | boolean | Must be verified by admin before working |
| isActive | boolean | Can be suspended |
| createdAt / updatedAt | timestamp | |

---

### `rides` — Each trip

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| riderId | UUID | FK → users |
| driverId | UUID | FK → drivers (null until accepted) |
| status | enum | See lifecycle below |
| pickupLat / pickupLng | decimal(10,8) / (11,8) | GPS coordinates |
| pickupAddress | text | Optional human-readable |
| dropoffLat / dropoffLng | decimal | |
| dropoffAddress | text | Optional |
| distanceKm | decimal(6,2) | Calculated at booking via haversine |
| fareAmount | integer | KES, calculated at booking |
| requestedAt | timestamp | When rider booked |
| acceptedAt | timestamp | When driver accepted |
| startedAt | timestamp | When driver picked up rider |
| completedAt | timestamp | When ride ended |
| cancelledAt | timestamp | If cancelled |
| cancelReason | text | Optional |

**Ride status lifecycle:**
```
requested → accepted → driver_arriving → in_progress → completed
                ↓                              ↓
            cancelled                      cancelled
```

**Indexes:** rider_id, driver_id, status, requested_at

---

### `payments` — M-Pesa payments

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| rideId | UUID | Unique FK → rides (one payment per ride) |
| riderId | UUID | FK → users |
| driverId | UUID | FK → drivers |
| amount | integer | KES |
| mpesaRef | text | Safaricom receipt number e.g. `QJH7K2L3M1` |
| checkoutReqId | text | STK push request ID from Daraja |
| status | enum | See statuses below |
| initiatedAt | timestamp | When STK push was sent |
| confirmedAt | timestamp | When M-Pesa callback confirmed |

**Payment statuses:**
- `pending` — STK push sent, waiting for user to enter PIN
- `completed` — M-Pesa confirmed payment
- `failed` — User cancelled or timed out
- `refunded` — Manual refund processed
- `flagged` — Amount mismatch detected, needs manual review

---

### `ratings` — Ride ratings

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| rideId | UUID | FK → rides |
| raterId | text | UUID of who gave the rating |
| ratedId | text | UUID of who received the rating |
| score | integer | 1–5 |
| comment | text | Optional |

> **Note:** `raterId` and `ratedId` have no foreign key constraints by design.
> A rider rates a driver (different tables), so a FK pointing to only `users`
> would fail. Both are stored as plain UUIDs.

---

### `driver_locations` — Live GPS of every driver

| Column | Type | Notes |
|---|---|---|
| driverId | UUID | Primary key — one row per driver |
| lat | decimal(10,8) | Updated via WebSocket as driver moves |
| lng | decimal(11,8) | |
| updatedAt | timestamp | |

> Driver search uses **PostGIS `ST_DWithin`** via raw SQL — columns are cast
> to `geography` on the fly. No separate geometry column needed.

---

## Enums

```sql
RideStatus:    requested | accepted | driver_arriving | in_progress | completed | cancelled
PaymentStatus: pending | completed | failed | refunded | flagged
```

---

## Seed Data (loaded automatically on first Docker run)

| Type | Phone | Password | Details |
|---|---|---|---|
| Rider | `254712345678` | `password123` | Test rider |
| Driver | `254723456789` | `password123` | Verified, online, located in Westlands |
| Driver | `254734567890` | `password123` | Unverified, offline |

**3 Saccos created:** Westlands Boda Association, Kasarani Riders Sacco, CBD Express Riders

---

## Migrations

| Migration | What it does |
|---|---|
| `20260427212452_init` | Creates all 7 tables, enums, indexes, and foreign keys |
| `20260427212922_fix_rating_relations` | Drops FK constraints on `ratings.rater_id` and `ratings.rated_id` (polymorphic IDs) |

---

## Recreating the Database

### With Docker (recommended)
```bash
# Start everything — migrations + seed run automatically
docker compose up
```

### Manually
```bash
# 1. Create the database
createdb bodamoja

# 2. Enable PostGIS
psql -d bodamoja -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 3. Run migrations
npx prisma migrate deploy

# 4. Seed test data
node prisma/seed.js
```

### Environment variable required
```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/bodamoja
```
