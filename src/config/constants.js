module.exports = {
  GOOGLE_SEARCH_URL: "https://www.google.com/search",
  CACHE_DURATION: 60 * 60 * 1000, // 1 hour cache
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX: 100, // limit each IP to 100 requests per windowMs
  ALLOWED_FILE_TYPES: [
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "pfe",
    "txt",
    "rtf",
  ],
  SUPPORTED_LANGUAGES: [
    "en",
    "fr",
    "es",
    "de",
    "it",
    "pt",
    "ru",
    "zh",
    "ja",
    "ar",
  ],
  DEFAULT_LANGUAGE: "fr",
  DEFAULT_COUNTRY: "tn",
};
