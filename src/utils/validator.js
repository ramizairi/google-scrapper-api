function isValidSearchQuery(query) {
  if (typeof query !== "string") return false;
  if (query.trim().length === 0) return false;
  if (query.length > 200) return false; // prevent very long queries
  return true;
}

module.exports = {
  isValidSearchQuery,
};
