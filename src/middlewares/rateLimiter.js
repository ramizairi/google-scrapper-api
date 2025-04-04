const rateLimit = require("express-rate-limit");
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } = require("../config/constants");
const logger = require("../utils/logger");

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests, please try again later.",
    });
  },
});

module.exports = limiter;
