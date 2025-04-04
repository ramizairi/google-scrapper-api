const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { GOOGLE_SEARCH_URL } = require("../config/constants");
const logger = require("../utils/logger");
const fs = require("fs").promises;
const path = require("path");
const https = require("https");

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

class GoogleScraper {
  constructor() {
    this.axiosInstance = axios.create({
      headers: this.generateHeaders(),
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
      }),
    });
    this.browser = null;
    this.browserLaunchPromise = null;
    this.lastRequest = 0;
    this.requestDelay = 10000; // 2 seconds between requests
  }

  generateHeaders() {
    return {
      "User-Agent": this.getRandomUserAgent(),
      "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://www.google.com/",
      DNT: "1",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    };
  }

  getRandomUserAgent() {
    const agents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ];
    return agents[Math.floor(Math.random() * agents.length)];
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

  async ensureBrowser() {
    if (!this.browserLaunchPromise) {
      this.browserLaunchPromise = puppeteer
        .launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-features=site-per-process",
            "--disable-web-security",
            "--proxy-server='direct://'",
            "--proxy-bypass-list=*",
          ],
          ignoreHTTPSErrors: true,
        })
        .then((browser) => {
          this.browser = browser;
          return browser;
        });
    }
    return this.browserLaunchPromise;
  }

  async search(keywords, fileType = "pdf", language = "fr", country = "tn") {
    let results = [];

    try {
      // Try HTTP request first
      results = await this.httpSearch(keywords, fileType, language, country);
      if (results.length > 0) {
        logger.info(`Found ${results.length} results via HTTP`);
        return results;
      }

      // Then try Puppeteer
      results = await this.puppeteerSearch(
        keywords,
        fileType,
        language,
        country
      );
      if (results.length > 0) {
        logger.info(`Found ${results.length} results via Puppeteer`);
        return results;
      }

      // Final fallback to alternative search method
      results = await this.alternativeSearch(
        keywords,
        fileType,
        language,
        country
      );
      if (results.length > 0) {
        logger.info(`Found ${results.length} results via Alternative method`);
      } else {
        logger.warn("No results found with any method");
      }
      return results;
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  async httpSearch(keywords, fileType, language, country) {
    try {
      await this.throttleRequest();

      const query = `${keywords} filetype:${fileType}`;
      const params = new URLSearchParams({
        q: query,
        num: 20,
        hl: language,
        gl: country,
        lr: `lang_${language}`,
        cr: country.toUpperCase(),
        as_filetype: fileType,
        pws: 0,
        safe: "off",
      });

      logger.debug(
        `HTTP search URL: ${GOOGLE_SEARCH_URL}?${params.toString()}`
      );

      const response = await this.axiosInstance.get(
        `${GOOGLE_SEARCH_URL}?${params.toString()}`
      );

      if (response.status !== 200) {
        throw new Error(`HTTP status ${response.status}`);
      }

      const $ = cheerio.load(response.data);

      if ($("#captcha-form").length > 0 || response.data.includes("CAPTCHA")) {
        throw new Error("CAPTCHA detected in HTTP request");
      }

      // For debugging purposes, save the HTML response
      try {
        await fs.writeFile(
          path.join(__dirname, "../logs/http-response.html"),
          response.data
        );
        logger.debug("Saved HTTP response for debugging");
      } catch (e) {
        logger.debug(`Could not save HTTP response: ${e.message}`);
      }

      return this.parseResults($, fileType);
    } catch (error) {
      logger.warn(`HTTP search failed: ${error.message}`);
      return [];
    }
  }

  async puppeteerSearch(keywords, fileType, language, country) {
    let page;
    try {
      await this.throttleRequest();

      const browser = await this.ensureBrowser();
      page = await browser.newPage();

      // Configure page
      await page.setExtraHTTPHeaders(this.generateHeaders());
      await page.setUserAgent(this.getRandomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });
      await page.setJavaScriptEnabled(true);

      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (["image", "font", "media"].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      const query = `${keywords} filetype:${fileType}`;
      const params = new URLSearchParams({
        q: query,
        hl: language,
        gl: country,
        num: 20,
      });

      const searchUrl = `${GOOGLE_SEARCH_URL}?${params.toString()}`;
      logger.debug(`Puppeteer search URL: ${searchUrl}`);

      const response = await page.goto(searchUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      if (!response) {
        throw new Error("No response from page");
      }

      if (response.status() !== 200) {
        throw new Error(`HTTP status ${response.status()}`);
      }

      // Check for CAPTCHA
      const hasCaptcha = await page.evaluate(() => {
        return (
          document.body.innerText.includes("CAPTCHA") ||
          document.querySelector("#captcha-form") !== null
        );
      });

      if (hasCaptcha) {
        throw new Error("CAPTCHA detected in Puppeteer");
      }

      // Wait for results to load
      await Promise.race([
        page.waitForSelector("div.g, div.tF2Cxc", { timeout: 5000 }),
        page.waitForFunction(
          "document.querySelectorAll('div.g, div.tF2Cxc, div.yuRUbf').length > 0",
          { timeout: 5000 }
        ),
      ]).catch(() => {
        logger.warn("Timeout waiting for search results selectors");
      });

      // Give a bit more time for results to render
      await page.waitForTimeout(1000);

      // For debugging purposes, save the HTML and screenshot
      try {
        const html = await page.content();
        await fs.writeFile(
          path.join(__dirname, "../logs/puppeteer-response.html"),
          html
        );
        await page.screenshot({
          path: path.join(__dirname, "../logs/search-screenshot.png"),
        });
        logger.debug("Saved Puppeteer response for debugging");
      } catch (e) {
        logger.debug(`Could not save Puppeteer debug info: ${e.message}`);
      }

      const content = await page.content();
      const $ = cheerio.load(content);

      const results = this.parseResults($, fileType);

      // Try alternative selectors if no results found
      if (results.length === 0) {
        logger.debug("Trying alternative selectors");
        const alternativeResults = await this.extractResultsDirectly(
          page,
          fileType
        );
        return alternativeResults;
      }

      return results;
    } catch (error) {
      logger.warn(`Puppeteer search failed: ${error.message}`);
      return [];
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (err) {
          logger.error(`Error closing page: ${err.message}`);
        }
      }
    }
  }

  async extractResultsDirectly(page, fileType) {
    try {
      return await page.evaluate((fileType) => {
        const results = [];

        // Try different selectors that Google might be using
        const linkSelectors = [
          'a[href^="http"]:not([href*="google"])',
          'div.g a[href^="http"]:not([href*="google"])',
          "div.yuRUbf a",
          ".rc .r a",
          "h3.LC20lb a",
          "h3 a",
        ];

        // Get unique links with titles
        for (const selector of linkSelectors) {
          const links = document.querySelectorAll(selector);

          links.forEach((link) => {
            const url = link.href;

            if (url && !url.includes("google.com")) {
              // Find closest heading or use link text
              let title = "";
              const h3 = link.closest("div").querySelector("h3");

              if (h3) {
                title = h3.innerText.trim();
              } else {
                title = link.innerText.trim() || "No Title";
              }

              if (title && url && !results.some((r) => r.link === url)) {
                results.push({
                  title: title,
                  link: url,
                  fileType: fileType.toLowerCase(),
                });
              }
            }
          });
        }

        return results;
      }, fileType);
    } catch (error) {
      logger.warn(`Direct extraction failed: ${error.message}`);
      return [];
    }
  }

  async alternativeSearch(keywords, fileType, language, country) {
    try {
      // Try using a proxy API like SerpAPI or ScrapingBee if you have access to one
      // For now, fallback to a more direct method
      return await this.directSearch(keywords, fileType, language, country);
    } catch (error) {
      logger.warn(`Alternative search failed: ${error.message}`);
      return [];
    }
  }

  async directSearch(keywords, fileType, language, country) {
    let page;
    try {
      await this.throttleRequest();

      // Create a fresh browser instance for this request
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
        ignoreHTTPSErrors: true,
      });

      page = await browser.newPage();

      // Use a different user agent
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
      );

      // Go to Google homepage first
      await page.goto("https://www.google.com", { waitUntil: "networkidle2" });

      // Accept cookies if prompted
      try {
        const acceptButtonSelector = 'button:has-text("Accept all")';
        await page.waitForSelector(acceptButtonSelector, { timeout: 5000 });
        await page.click(acceptButtonSelector);
        await page.waitForTimeout(1000);
      } catch (e) {
        // No cookie banner or it has a different structure
      }

      // Type the search query
      await page.type('input[name="q"]', `${keywords} filetype:${fileType}`);

      // Submit the form
      await Promise.all([
        page.keyboard.press("Enter"),
        page.waitForNavigation({ waitUntil: "networkidle2" }),
      ]);

      // Wait for results
      await page.waitForTimeout(2000);

      // Extract results
      const results = await page.evaluate((fileType) => {
        const items = [];
        const links = document.querySelectorAll(
          'a[href^="http"]:not([href*="google"])'
        );

        links.forEach((link) => {
          const url = link.href;

          // Filter for PDF links based on URL or context
          if (
            url.toLowerCase().endsWith(`.${fileType}`) ||
            url.toLowerCase().includes(`filetype%3a${fileType}`)
          ) {
            // Find title - look for heading elements near the link
            let title = "";
            let parent = link.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
              const heading = parent.querySelector("h3");
              if (heading) {
                title = heading.innerText.trim();
                break;
              }
              parent = parent.parentElement;
            }

            // If no title found, use link text or URL as fallback
            if (!title) {
              title =
                link.innerText.trim() ||
                url.split("/").pop() ||
                "Untitled Document";
            }

            items.push({
              title: title,
              link: url,
              fileType: fileType.toLowerCase(),
            });
          }
        });

        return items;
      }, fileType);

      // Close browser
      await browser.close();

      return results;
    } catch (error) {
      logger.warn(`Direct search failed: ${error.message}`);
      if (page) {
        try {
          const browser = page.browser();
          await browser.close();
        } catch (e) {
          // Ignore browser close errors
        }
      }
      return [];
    }
  }

  parseResults($, fileType) {
    const results = [];
    const selectors = [
      { base: "div.g", link: 'a[href^="http"]', title: "h3" },
      { base: "div.tF2Cxc", link: 'a[href^="http"]', title: "h3" },
      { base: "div.yuRUbf", link: 'a[href^="http"]', title: "h3" },
      { base: "div.srg", link: 'a[href^="http"]', title: "h3" },
      { base: "div.rc", link: 'a[href^="http"]', title: "h3" },
      { base: "div", link: 'a[href^="http"]', title: "h3.LC20lb" },
    ];

    // Debug the HTML structure
    logger.debug(`HTML contains ${$("div.g").length} div.g elements`);
    logger.debug(`HTML contains ${$("div.tF2Cxc").length} div.tF2Cxc elements`);
    logger.debug(`HTML contains ${$("div.yuRUbf").length} div.yuRUbf elements`);
    logger.debug(`HTML contains ${$("h3").length} h3 elements`);

    // Try all selectors
    selectors.forEach(({ base, link, title }) => {
      $(base).each((i, el) => {
        const linkElement = $(el).find(link);
        const rawUrl = linkElement.attr("href");

        // Try to find title with different approaches
        let titleText = "";
        if ($(el).find(title).length > 0) {
          titleText = $(el).find(title).text().trim();
        } else if (linkElement.text().trim()) {
          titleText = linkElement.text().trim();
        }

        if (rawUrl && titleText && !rawUrl.includes("google.com")) {
          try {
            const url = rawUrl.startsWith("/url?")
              ? new URLSearchParams(rawUrl.split("?")[1]).get("q")
              : rawUrl;

            // Only include relevant file type URLs
            if (url && !results.some((r) => r.link === url)) {
              results.push({
                title: titleText,
                link: this.cleanUrl(url),
                fileType: fileType.toLowerCase(),
              });
            }
          } catch (e) {
            logger.debug(`URL parse error: ${e.message}`);
          }
        }
      });
    });

    // Fallback: direct link extraction for PDFs
    if (results.length === 0) {
      $(`a[href$=".${fileType.toLowerCase()}"]`).each((i, el) => {
        const url = $(el).attr("href");
        const titleText =
          $(el).text().trim() || url.split("/").pop() || "Untitled Document";

        if (
          url &&
          !url.includes("google.com") &&
          !results.some((r) => r.link === url)
        ) {
          results.push({
            title: titleText,
            link: this.cleanUrl(url),
            fileType: fileType.toLowerCase(),
          });
        }
      });
    }

    return results;
  }

  cleanUrl(url) {
    try {
      if (!url) return "";

      const urlObj = new URL(url);
      urlObj.searchParams.forEach((value, key) => {
        if (key.startsWith("utm_") || key.startsWith("_")) {
          urlObj.searchParams.delete(key);
        }
      });
      return urlObj.toString();
    } catch (e) {
      logger.debug(`Clean URL error: ${e.message}`);
      return url;
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        logger.error(`Error closing browser: ${err.message}`);
      }
      this.browser = null;
      this.browserLaunchPromise = null;
    }
  }
}

// Singleton instance with error handling
const scraperInstance = new GoogleScraper();

process.on("SIGINT", async () => {
  await scraperInstance.close();
  process.exit();
});

module.exports = scraperInstance;
