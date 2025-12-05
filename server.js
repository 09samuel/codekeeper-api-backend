require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const documentRoutes = require("./routes/documentRoutes");
const collaboratorRoutes = require("./routes/collaboratorRoutes");
const aiRoutes = require("./routes/aiRoutes");
const codeRoutes = require("./routes/codeRoutes");
require("./config/db");

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/collaborators", collaboratorRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/code", codeRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
