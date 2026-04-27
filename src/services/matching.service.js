const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const BASE_FARE = 50;
const PER_KM_RATE = 30;
const MIN_FARE = 80;

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

const findNearestDrivers = async (lat, lng, radiusMeters = 3000, limit = 5) => {
  try {
    const locations = await prisma.driverLocation.findMany({
      include: {
        driver: {
          select: { id: true, name: true, phone: true, ratingAvg: true, isOnline: true, isActive: true },
        },
      },
    });

    const available = locations.filter(
      (loc) => loc.driver.isOnline && loc.driver.isActive
    );

    const withDistance = available.map((loc) => ({
      ...loc.driver,
      distance: haversineDistance(
        parseFloat(lat),
        parseFloat(lng),
        parseFloat(loc.lat),
        parseFloat(loc.lng)
      ),
    }));

    return withDistance
      .filter((d) => d.distance <= radiusMeters)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  } catch (err) {
    logger.error('findNearestDrivers failed', { error: err.message });
    return [];
  }
};

module.exports = { estimateRide, findNearestDrivers };
