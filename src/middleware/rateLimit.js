const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../lib/redis');
const { error } = require('../lib/response');

// Shared Redis store — limits survive restarts and work across multiple containers
const makeStore = (prefix) =>
  new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });

// Global rate limiter - 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:global:'),
  handler: (req, res) => {
    return error(res, 'RATE_LIMITED', 'Too many requests, please slow down', 429);
  },
});

// Login rate limiter - 10 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:login:'),
  handler: (req, res) => {
    return error(res, 'TOO_MANY_ATTEMPTS', 'Too many login attempts. Please try again in 15 minutes.', 429);
  },
});

// Strict rate limiter for sensitive operations - 5 per minute
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:strict:'),
  handler: (req, res) => {
    return error(res, 'RATE_LIMITED', 'Too many requests for this operation', 429);
  },
});

module.exports = { globalLimiter, loginLimiter, strictLimiter };
