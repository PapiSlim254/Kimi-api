const { z } = require('zod');

const phoneSchema = z
  .string()
  .regex(/^254[17]\d{8}$/, 'Phone must be in format 254XXXXXXXXX (Safaricom/Airtel KE)');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters');

const riderRegisterSchema = z.object({
  phone: phoneSchema,
  name: z.string().min(2).max(100).trim(),
  password: passwordSchema,
});

const driverRegisterSchema = z.object({
  phone: phoneSchema,
  name: z.string().min(2).max(100).trim(),
  password: passwordSchema,
  idNumber: z.string().min(6).max(20).trim(),
  licenseNumber: z.string().min(5).max(20).trim(),
  saccoId: z.string().uuid().optional(),
});

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
});

const createRideSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().max(300).optional(),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().max(300).optional(),
});

const cancelRideSchema = z.object({
  reason: z.string().max(300).optional(),
});

const driverStatusSchema = z.object({
  isOnline: z.boolean(),
});

const nearbyDriversSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(100).max(50000).optional().default(3000),
});

const createRatingSchema = z.object({
  rideId: z.string().uuid(),
  ratedId: z.string().uuid(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

module.exports = {
  riderRegisterSchema,
  driverRegisterSchema,
  loginSchema,
  createRideSchema,
  cancelRideSchema,
  driverStatusSchema,
  nearbyDriversSchema,
  createRatingSchema,
};
