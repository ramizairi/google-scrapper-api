const cache = require("memory-cache");
const { CACHE_DURATION } = require("../config/constants");
const logger = require("../utils/logger");

class CacheService {
  get(key) {
    return cache.get(key);
  }

  set(key, value, duration = CACHE_DURATION) {
    cache.put(key, value, duration);
    logger.debug(`Cache set for key: ${key}`);
  }

  clear(key) {
    cache.del(key);
    logger.debug(`Cache cleared for key: ${key}`);
  }

  generateCacheKey(keywords, fileType) {
    return `search:${keywords}:${fileType}`.toLowerCase();
  }
}

module.exports = new CacheService();
