const googleSearchService = require("../services/googleSearchService"); // Import the new service
const cacheService = require("../services/cacheService");
const { ALLOWED_FILE_TYPES } = require("../config/constants");
const logger = require("../utils/logger");

class SearchController {
  async search(req, res, next) {
    try {
      const {
        keywords,
        fileType = "pdf",
        language = "fr",
        country = "tn",
      } = req.query;

      if (!keywords || keywords.trim().length === 0) {
        return res.status(400).json({ error: "Keywords are required" });
      }

      // Default to PDF if not valid filetype
      const safeFileType = ALLOWED_FILE_TYPES.includes(fileType.toLowerCase())
        ? fileType.toLowerCase()
        : "pdf";

      logger.debug(
        `Starting search for: ${keywords} with filetype: ${safeFileType}`
      );

      // Check cache first
      let cachedResults = null;
      let cacheKey = null;

      try {
        if (
          cacheService &&
          typeof cacheService.generateCacheKey === "function"
        ) {
          cacheKey = cacheService.generateCacheKey(
            keywords,
            safeFileType,
            language,
            country
          );
          cachedResults = cacheService.get(cacheKey);
        }
      } catch (cacheError) {
        logger.error(`Cache error: ${cacheError.message}`);
        // Continue without cache
      }

      if (cachedResults) {
        return res.json({
          fromCache: true,
          query: { keywords, fileType: safeFileType, language, country },
          results: cachedResults,
        });
      }

      // Use our new googlethis-based service
      const results = await googleSearchService.search(
        keywords,
        safeFileType,
        language,
        country
      );

      // Store in cache if available
      if (results.length > 0 && cacheService && cacheKey) {
        try {
          cacheService.set(cacheKey, results);
        } catch (cacheError) {
          logger.error(`Cache set error: ${cacheError.message}`);
        }
      }

      res.json({
        fromCache: false,
        query: { keywords, fileType: safeFileType, language, country },
        results,
      });
    } catch (error) {
      logger.error(`Controller error: ${error.message}`);
      logger.error(error.stack);

      // Handle specific errors
      if (error.message.includes("CAPTCHA") || error.message.includes("429")) {
        return res.status(429).json({
          error: "Google is limiting requests. Please try again later.",
        });
      }

      res.status(500).json({
        error: "Failed to perform search",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
}

module.exports = new SearchController();
