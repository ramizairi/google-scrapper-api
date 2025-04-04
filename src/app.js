const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const searchRoutes = require("./routes/searchRoutes");
const errorHandler = require("./middlewares/errorHandler");
const logger = require("./utils/logger");

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: logger.stream }));

// Routes
app.use("/api", searchRoutes);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Error handling
app.use(errorHandler);

module.exports = app;
