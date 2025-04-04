const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("../utils/logger");
const fs = require("fs").promises;
const path = require("path");
const { GOOGLE_SEARCH_URL } = require("../config/constants");

class GoogleApiService {
  constructor() {
    this.lastRequest = 0;
    this.requestDelay = 5000; // 5 seconds between requests
    this.userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
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

      const url = "https://www.googleapis.com/customsearch/v1";
      const params = {
        q: query,
        cx:
          process.env.GOOGLE_SEARCH_ENGINE_ID ||
          "engine id:omuauf_lfve", // You'll need a custom search engine ID
        key: process.env.GOOGLE_API_KEY || "api key", // You'll need an API key
        lr: `lang_${language}`,
        cr: country.toUpperCase(),
        fileType: fileType,
        num: 10, // Max 10 results per query with free tier
      };

      logger.info(`Searching for: ${query} via Google API`);

      // Try the official Google API first
      try {
        if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
          const response = await axios.get(url, { params });
          const items = response.data.items || [];

          logger.info(`Found ${items.length} results from Google API`);

          return items.map((item) => ({
            title: item.title,
            link: item.link,
            fileType: fileType.toLowerCase(),
            description: item.snippet || "",
          }));
        } else {
          logger.warn(
            "Google API credentials not configured, falling back to scraping"
          );
          return await this.fallbackSearch(query, fileType, language, country);
        }
      } catch (apiError) {
        logger.warn(`Google API error: ${apiError.message}`);
        return await this.fallbackSearch(query, fileType, language, country);
      }
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  async fallbackSearch(query, fileType, language, country) {
    try {
      await this.throttleRequest();

      // Build the search URL
      const params = new URLSearchParams({
        q: query,
        hl: language,
        gl: country,
        lr: `lang_${language}`,
        num: 20,
      });

      const searchUrl = `${GOOGLE_SEARCH_URL}?${params.toString()}`;
      logger.debug(`Fallback search URL: ${searchUrl}`);

      // Make the request with randomized headers
      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.google.com/",
          DNT: "1",
        },
      });

      // Make sure logs directory exists
      const logsDir = path.join(__dirname, "../logs");
      await fs.mkdir(logsDir, { recursive: true }).catch(() => {});

      // Save the HTML for debugging
      await fs
        .writeFile(
          path.join(logsDir, "google-search-response.html"),
          response.data
        )
        .catch((err) =>
          logger.debug(`Could not save response: ${err.message}`)
        );

      // Parse with cheerio
      const $ = cheerio.load(response.data);
      const results = [];

      // Look for search results
      const resultElements = $(".g, .tF2Cxc, .yuRUbf");
      logger.debug(`Found ${resultElements.length} result elements`);

      resultElements.each((i, el) => {
        const link = $(el).find('a[href^="http"]').first().attr("href");
        const title = $(el).find("h3").first().text().trim();

        if (link && title) {
          // Check if the link matches the file type
          if (
            link.toLowerCase().endsWith(`.${fileType}`) ||
            link.toLowerCase().includes(`filetype%3a${fileType}`) ||
            $(el).text().toLowerCase().includes(`[${fileType}]`)
          ) {
            results.push({
              title: title,
              link: link,
              fileType: fileType.toLowerCase(),
              description:
                $(el).find(".VwiC3b, .yXK7lf").first().text().trim() || "",
            });
          }
        }
      });

      logger.info(
        `Found ${results.length} results after filtering for ${fileType}`
      );
      return results;
    } catch (error) {
      logger.error(`Fallback search failed: ${error.message}`);
      return [];
    }
  }
}

module.exports = new GoogleApiService();
