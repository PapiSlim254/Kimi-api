const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { generateToken } = require('../lib/jwt');
const { success, error } = require('../lib/response');
const AppError = require('../lib/AppError');
const logger = require('../lib/logger');
const { auditLog, AUDIT_ACTIONS } = require('../lib/audit');

const SALT_ROUNDS = 12;

// Rider registration
const riderRegister = async (req, res, next) => {
  try {
    const { phone, name, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new AppError('PHONE_TAKEN', 'Phone number already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { phone, name, password: passwordHash },
      select: { id: true, phone: true, name: true, createdAt: true },
    });

    const token = generateToken({ id: user.id, role: 'rider', phone: user.phone });

    auditLog(AUDIT_ACTIONS.RIDER_REGISTERED, user.id, { phone: user.phone });
    logger.info('Rider registered', { userId: user.id, phone: user.phone });

    return success(res, { token, user }, 'Registration successful', 201);
  } catch (err) {
    next(err);
  }
};

// Driver registration
const driverRegister = async (req, res, next) => {
  try {
    const { phone, name, password, idNumber, licenseNumber, saccoId } = req.body;

    const existing = await prisma.driver.findUnique({ where: { phone } });
    if (existing) {
      throw new AppError('PHONE_TAKEN', 'Phone number already registered', 409);
    }

    const idExists = await prisma.driver.findUnique({ where: { idNumber } });
    if (idExists) {
      throw new AppError('ID_TAKEN', 'National ID already registered', 409);
    }

    const licenseExists = await prisma.driver.findUnique({ where: { licenseNumber } });
    if (licenseExists) {
      throw new AppError('LICENSE_TAKEN', 'License number already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const driver = await prisma.driver.create({
      data: { 
        phone, 
        name, 
        password: passwordHash, 
        idNumber, 
        licenseNumber,
        saccoId: saccoId || null,
      },
      select: { 
        id: true, 
        phone: true, 
        name: true, 
        idNumber: true,
        licenseNumber: true,
        isVerified: true,
        createdAt: true,
      },
    });

    const token = generateToken({ id: driver.id, role: 'driver', phone: driver.phone });

    auditLog(AUDIT_ACTIONS.DRIVER_REGISTERED, driver.id, { phone: driver.phone });
    logger.info('Driver registered', { driverId: driver.id, phone: driver.phone });

    return success(res, { token, driver }, 'Driver registration successful. Verification pending.', 201);
  } catch (err) {
    next(err);
  }
};

// Rider login
const riderLogin = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, null, { phone, reason: 'user_not_found' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401);
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, user.id, { phone, reason: 'invalid_password' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401);
    }

    if (!user.isActive) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, user.id, { phone, reason: 'account_suspended' });
      throw new AppError('ACCOUNT_SUSPENDED', 'Account has been suspended', 403);
    }

    const token = generateToken({ id: user.id, role: 'rider', phone: user.phone });

    auditLog(AUDIT_ACTIONS.RIDER_LOGIN, user.id, { phone: user.phone });
    logger.info('Rider logged in', { userId: user.id });

    return success(res, { 
      token, 
      user: { id: user.id, phone: user.phone, name: user.name } 
    });
  } catch (err) {
    next(err);
  }
};

// Driver login
const driverLogin = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    const driver = await prisma.driver.findUnique({ where: { phone } });
    if (!driver) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, null, { phone, reason: 'driver_not_found' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401);
    }

    const valid = await bcrypt.compare(password, driver.password);
    if (!valid) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, driver.id, { phone, reason: 'invalid_password' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401);
    }

    if (!driver.isActive) {
      auditLog(AUDIT_ACTIONS.LOGIN_FAILED, driver.id, { phone, reason: 'account_suspended' });
      throw new AppError('ACCOUNT_SUSPENDED', 'Account has been suspended', 403);
    }

    const token = generateToken({ id: driver.id, role: 'driver', phone: driver.phone });

    auditLog(AUDIT_ACTIONS.DRIVER_LOGIN, driver.id, { phone: driver.phone });
    logger.info('Driver logged in', { driverId: driver.id });

    return success(res, { 
      token, 
      driver: { 
        id: driver.id, 
        phone: driver.phone, 
        name: driver.name,
        isVerified: driver.isVerified,
        isOnline: driver.isOnline,
      } 
    });
  } catch (err) {
    next(err);
  }
};

// Get current user profile
const getMe = async (req, res, next) => {
  try {
    const { id, role } = req.user;

    if (role === 'rider') {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, phone: true, name: true, createdAt: true },
      });
      return success(res, { ...user, role });
    } else {
      const driver = await prisma.driver.findUnique({
        where: { id },
        select: { 
          id: true, 
          phone: true, 
          name: true, 
          ratingAvg: true,
          isVerified: true,
          isOnline: true,
          sacco: { select: { name: true } },
          createdAt: true,
        },
      });
      return success(res, { ...driver, role });
    }
  } catch (err) {
    next(err);
  }
};

module.exports = {
  riderRegister,
  driverRegister,
  riderLogin,
  driverLogin,
  getMe,
};
