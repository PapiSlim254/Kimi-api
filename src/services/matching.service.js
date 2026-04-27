const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

const BASE_FARE = 50;
const PER_KM_RATE = 30;
const MIN_FARE = 80;

// Haversine kept only for fare estimation (no DB needed, pure math)
const toRad = (deg) => (deg * Math.PI) / 180;

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const estimateRide = (pickupLat, pickupLng, dropoffLat, dropoffLng) => {
  const distanceM = haversineDistance(
    parseFloat(pickupLat),
    parseFloat(pickupLng),
    parseFloat(dropoffLat),
    parseFloat(dropoffLng)
  );
  const distanceKm = Math.round((distanceM / 1000) * 100) / 100;
  const fare = Math.max(MIN_FARE, Math.round(BASE_FARE + distanceKm * PER_KM_RATE));
  return { distanceKm, fare };
};

// Uses PostGIS ST_DWithin to filter inside the DB — no full table scan.
// ST_MakePoint(lng, lat)::geography measures distances in metres on the spheroid.
const findNearestDrivers = async (lat, lng, radiusMeters = 3000, limit = 5) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        d.id,
        d.name,
        d.phone,
        d.rating_avg  AS "ratingAvg",
        d.is_online   AS "isOnline",
        d.is_active   AS "isActive",
        ST_Distance(
          ST_MakePoint(dl.lng::float8, dl.lat::float8)::geography,
          ST_MakePoint(${parseFloat(lng)}::float8, ${parseFloat(lat)}::float8)::geography
        ) AS distance
      FROM driver_locations dl
      JOIN drivers d ON d.id = dl.driver_id
      WHERE
        d.is_online = true
        AND d.is_active = true
        AND ST_DWithin(
          ST_MakePoint(dl.lng::float8, dl.lat::float8)::geography,
          ST_MakePoint(${parseFloat(lng)}::float8, ${parseFloat(lat)}::float8)::geography,
          ${radiusMeters}
        )
      ORDER BY distance ASC
      LIMIT ${limit}
    `;

    // Convert Prisma BigInt/Decimal returns to plain JS numbers
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      ratingAvg: r.ratingAvg,
      isOnline: r.isOnline,
      isActive: r.isActive,
      distance: parseFloat(r.distance),
    }));
  } catch (err) {
    logger.error('findNearestDrivers failed', { error: err.message });
    return [];
  }
};

module.exports = { estimateRide, findNearestDrivers };
