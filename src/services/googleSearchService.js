const google = require("googlethis");
const logger = require("../utils/logger");
const fs = require("fs").promises;
const path = require("path");

class GoogleSearchService {
  constructor() {
    this.lastRequest = 0;
    this.requestDelay = 3000;
  }

  async throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < this.requestDelay) {
      const delay = this.requestDelay - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequest = Date.now();
  }

  async search(keywords, fileType = "pdf", language = "fr", country = "tn") {
    try {
      await this.throttleRequest();

      // Format the query specifically for file type search
      const query = `${keywords} filetype:${fileType}`;

      const options = {
        page: 0,
        safe: false,
        parse_ads: false,
        additional_params: {
          hl: language,
          gl: country,
          lr: `lang_${language}`,
          cr: country.toUpperCase(),
          num: 20,
        },
      };

      logger.info(`Searching for: ${query}`);
      const response = await google.search(query, options);

      // Debug: Save the raw response to inspect what's being returned
      try {
        // Make sure logs directory exists
        const logsDir = path.join(__dirname, "../logs");
        await fs.mkdir(logsDir, { recursive: true });

        await fs.writeFile(
          path.join(logsDir, "googlethis-response.json"),
          JSON.stringify(response, null, 2)
        );
        logger.debug("Saved raw response for debugging");
      } catch (e) {
        logger.debug(`Could not save response: ${e.message}`);
      }

      // Log total results received
      logger.debug(
        `Raw response has ${
          response.results ? response.results.length : 0
        } general results`
      );

      // Process results to match your expected format
      const formattedResults = this.processResults(response, fileType);

      logger.info(
        `Found ${formattedResults.length} results after filtering for ${fileType}`
      );
      return formattedResults;
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  processResults(response, fileType) {
    const results = [];

    // Process regular results
    if (response.results && Array.isArray(response.results)) {
      response.results.forEach((result) => {
        logger.debug(`Checking URL: ${result.url}`);

        // More flexible check for file type
        const isFileTypeMatch =
          result.url &&
          (result.url.toLowerCase().endsWith(`.${fileType}`) ||
            result.url.toLowerCase().includes(`filetype%3a${fileType}`) ||
            result.url.toLowerCase().includes(`/viewerng/viewer?url=`) || // For PDF viewers
            result.url.toLowerCase().includes(`.${fileType.toLowerCase()}`) ||
            (result.description &&
              result.description.toLowerCase().includes(`[${fileType}]`)));

        if (isFileTypeMatch) {
          logger.debug(`Found matching result: ${result.title}`);
          results.push({
            title: result.title || "No Title",
            link: result.url,
            fileType: fileType.toLowerCase(),
            description: result.description || "",
          });
        }
      });
    }

    // Also look for any result that might contain file links
    if (response.results && Array.isArray(response.results)) {
      response.results.forEach((result) => {
        // Sometimes PDFs are linked in the description with [PDF] tag
        if (
          result.description &&
          result.description.toLowerCase().includes(`[${fileType}]`)
        ) {
          // This is a best effort attempt - not guaranteed to work in all cases
          if (!results.some((r) => r.link === result.url)) {
            results.push({
              title: result.title || "No Title",
              link: result.url,
              fileType: fileType.toLowerCase(),
              description: result.description || "",
              note: "Inferred from description",
            });
          }
        }
      });
    }

    return results;
  }
}

module.exports = new GoogleSearchService();
