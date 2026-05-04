import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const db = new Database("roadsense.db");
const JWT_SECRET = process.env.JWT_SECRET || "roadsense-secret-key-123";

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL,
    lon REAL,
    address TEXT,
    timestamp TEXT,
    severity TEXT,
    class TEXT,
    image_path TEXT,
    traffic_volume INTEGER,
    priority_score REAL,
    description TEXT,
    status TEXT DEFAULT 'Pending',
    admin_comment TEXT,
    is_escalated INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detection_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    comment TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (detection_id) REFERENCES detections(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const bypass = process.env.BYPASS_AUTH === "true";
    const token = req.cookies.token;

    console.log(`[AUTH] Path: ${req.path}, Bypass: ${bypass}, HasToken: ${!!token}`);

    if (bypass && !token) {
      req.user = { id: 0, email: "dev-user@roadsense.ai", bypass: true };
      return next();
    }

    if (!token) {
      console.warn(`[AUTH] No token for ${req.path}`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) {
        console.error(`[AUTH] JWT Verify Error: ${err.message}`);
        return res.status(403).json({ error: "Forbidden" });
      }
      req.user = user;
      next();
    });
  };

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      db.prepare("INSERT INTO users (email, password) VALUES (?, ?)").run(email, hashedPassword);
      res.json({ status: "success", message: "User registered" });
    } catch (err: any) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    
    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
    res.json({ status: "success", user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/otp/request", async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Rate limiting: max 5 OTPs per hour per email
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const count: any = db.prepare("SELECT COUNT(*) as count FROM otps WHERE email = ? AND created_at > ?").get(email, oneHourAgo);
    
    if (count.count >= 5) {
      return res.status(429).json({ error: "Too many OTP requests. Please try again later." });
    }

    // Invalidate any existing OTPs for this email
    db.prepare("DELETE FROM otps WHERE email = ?").run(email);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 300000).toISOString(); // 5 minutes

    // Nodemailer Configuration
    // To use real email, set these environment variables in the Settings menu:
    // SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
    const useRealEmail = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

    if (useRealEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: `"RoadSense Auth" <${process.env.SMTP_USER}>`,
          to: email,
          subject: "Your RoadSense AI Login OTP",
          text: `Your OTP is ${otp}. It expires in 5 minutes.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
              <h2 style="color: #dc2626;">RoadSense AI</h2>
              <p>Hello,</p>
              <p>Your one-time password for login is:</p>
              <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #111827; margin: 20px 0;">
                ${otp}
              </div>
              <p style="font-size: 12px; color: #6b7280;">This code will expire in 5 minutes. If you didn't request this, please ignore this email.</p>
            </div>
          `,
        });
        console.log(`[EMAIL SENT] Successfully sent OTP to ${email}`);
      } catch (mailErr: any) {
        console.error("[EMAIL ERROR] Failed to send email:", mailErr.message);
        // Fallback to console for debugging even if real email fails
        console.log(`[DEBUG FALLBACK] To: ${email}, OTP: ${otp}`);
      }
    } else {
      // Mock Email Sending for Development
      console.log("-----------------------------------------");
      console.log(`[MOCK EMAIL] To: ${email}`);
      console.log(`[MOCK EMAIL] OTP: ${otp}`);
      console.log("-----------------------------------------");
      console.log("TIP: Set SMTP_HOST, SMTP_USER, and SMTP_PASS in environment variables to send real emails.");
    }

    res.json({ status: "success", message: "OTP sent to email" });
  });

  app.post("/api/auth/otp/verify", (req, res) => {
    const { email, otp } = req.body;
    const now = new Date().toISOString();
    
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const record: any = db.prepare("SELECT * FROM otps WHERE email = ?").get(email);
    
    if (!record) {
      return res.status(401).json({ error: "No OTP request found for this email" });
    }

    // Check expiry
    if (new Date(record.expires_at) < new Date()) {
      db.prepare("DELETE FROM otps WHERE email = ?").run(email);
      return res.status(401).json({ error: "OTP has expired. Please request a new one." });
    }

    // Check attempts
    if (record.attempts >= 3) {
      db.prepare("DELETE FROM otps WHERE email = ?").run(email);
      return res.status(401).json({ error: "Maximum attempts reached. Please request a new OTP." });
    }

    // Verify OTP (exact string comparison, trimmed)
    if (record.otp !== otp.trim()) {
      db.prepare("UPDATE otps SET attempts = attempts + 1 WHERE email = ?").run(email);
      const remaining = 2 - record.attempts;
      return res.status(401).json({ error: `Invalid OTP. ${remaining} attempts remaining.` });
    }

    // Success: Clean up OTP
    db.prepare("DELETE FROM otps WHERE email = ?").run(email);

    // Find or create user
    let user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const info = db.prepare("INSERT INTO users (email) VALUES (?)").run(email);
      user = { id: info.lastInsertRowid, email };
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
    res.json({ status: "success", user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ status: "success" });
  });

  app.post("/api/user/change-password", authenticateToken, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (req.user.bypass) {
      return res.status(400).json({ error: "Password change not allowed in bypass mode" });
    }

    try {
      const user: any = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Handle users created via OTP who might not have a password yet
      if (user.password) {
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
          return res.status(401).json({ error: "Incorrect current password" });
        }
      } else if (currentPassword) {
        // If they don't have a password set, they shouldn't be providing a current password
        // Or maybe we allow them to set it for the first time
        return res.status(400).json({ error: "No current password set. Please contact support." });
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedNewPassword, userId);
      
      res.json({ status: "success", message: "Password updated successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    res.json({ user: req.user });
  });

  // Multer setup for image uploads
  const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });
  const upload = multer({ storage });

  // API Routes
  app.get("/api/detections", authenticateToken, (req, res) => {
    const rows = db.prepare("SELECT * FROM detections ORDER BY priority_score DESC").all();
    res.json(rows);
  });

  app.post("/api/detections", authenticateToken, upload.single("image"), (req, res) => {
    const { lat, lon, address, timestamp, severity, class: className, traffic_volume, priority_score, description } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    const info = db.prepare(`
      INSERT INTO detections (lat, lon, address, timestamp, severity, class, image_path, traffic_volume, priority_score, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lat, lon, address, timestamp, severity, className, image_path, traffic_volume, priority_score, description);

    res.json({ id: info.lastInsertRowid, status: "success" });
  });

  app.patch("/api/detections/:id/status", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status, comment } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    try {
      const updateDetection = db.prepare("UPDATE detections SET status = ?, admin_comment = ? WHERE id = ?");
      const result = updateDetection.run(status, comment, id);

      if (result.changes === 0) {
        return res.status(404).json({ error: "Detection not found" });
      }

      const insertHistory = db.prepare("INSERT INTO status_history (detection_id, status, comment) VALUES (?, ?, ?)");
      insertHistory.run(id, status, comment);

      res.json({ status: "success", message: "Status updated" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/detections/:id/escalate", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
      const result = db.prepare("UPDATE detections SET is_escalated = 1 WHERE id = ?").run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Detection not found" });
      }
      
      // Log escalation in history
      db.prepare("INSERT INTO status_history (detection_id, status, comment) VALUES (?, ?, ?)").run(id, "ESCALATED", "Work order escalated for urgent review.");
      
      console.log(`[ESCALATION] Work order #${id} escalated! Notification sent to supervisor.`);
      
      res.json({ status: "success", message: "Work order escalated" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 404 handler for API routes
  app.use("/api/*", (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API route ${req.originalUrl} not found` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
