const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '30d';

// Validate JWT secret strength
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

if (JWT_SECRET.length < 64) {
  throw new Error('JWT_SECRET must be at least 64 characters (per security.md)');
}

// Check entropy - reject low-entropy secrets
const uniqueChars = new Set(JWT_SECRET).size;
if (uniqueChars < 16) {
  throw new Error('JWT_SECRET has insufficient entropy. Use a cryptographically random string.');
}

// Verify it's hex or base64-like (not dictionary words)
if (!/^[a-f0-9]+$/i.test(JWT_SECRET) && !/^[A-Za-z0-9+/=]+$/.test(JWT_SECRET)) {
  console.warn('JWT_SECRET should be a hex or base64 encoded random string');
}

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'bodamoja.com',
    audience: 'bodamoja-app',
  });
};

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET, {
    issuer: 'bodamoja.com',
    audience: 'bodamoja-app',
  });
};

module.exports = { generateToken, verifyToken };
