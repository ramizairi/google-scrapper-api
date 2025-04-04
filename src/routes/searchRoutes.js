const express = require("express");
const router = express.Router();
const searchController = require("../controllers/searchController");
const rateLimiter = require("../middlewares/rateLimiter");

router.get("/search", rateLimiter, searchController.search);

module.exports = router;
