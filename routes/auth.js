// routes/auth.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/authMiddleware");
require("dotenv").config();

// GET /auth/me
router.get("/me", authMiddleware(), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token expired" });
      }
      return res.status(403).json({ message: "Invalid token" });
    }

    const [rows] = await pool.execute(
      "SELECT id, username, fullname, email, role, profile_image FROM users WHERE id = ?",
      [decoded.id]
    );

    if (!rows.length)
      return res.status(404).json({ message: "User not found" });

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE username=?", [
      username,
    ]);
    if (!rows.length)
      return res.status(400).json({ message: "User not found" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    // ✅ ใช้ token เดียว
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        fullname: user.fullname,
        username: user.username,
      },
      process.env.JWT_SECRET,
      { expiresIn: "3h" }
    );

    res.json({
      token,
      userId: user.id,
      role: user.role,
      fullname: user.fullname,
      username: user.username,
      profile_image: user.profile_image,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// logout
router.post("/logout", async (req, res) => {
  const { userId } = req.body;
  await pool.execute("UPDATE users SET refresh_token=NULL WHERE id=?", [
    userId,
  ]);
  res.json({ message: "Logged out" });
});

// Register user
router.post("/register", async (req, res) => {
  try {
    const { username, fullname, email, password, id_line } = req.body;

    // เช็คว่า email หรือ username ซ้ำหรือไม่
    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email=? OR username=?",
      [email, username]
    );
    if (existing.length) {
      return res
        .status(400)
        .json({ message: "Email หรือ username ถูกใช้แล้ว" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      "INSERT INTO users (username, fullname, email, id_line, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'guest', NOW())",
      [username, fullname, email, id_line || null, password_hash]
    );
    await logActivity(
      result.insertId, // user ที่เพิ่งสร้าง
      "register_user",
      "user",
      result.insertId,
      `${username} สมัครบัญชีเรียบร้อย`
    );

    res.json({ message: "สมัครเรียบร้อย", userId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
});
// POST /auth/check-username
router.post("/check-username", async (req, res) => {
  const { username } = req.body;
  const [rows] = await pool.execute("SELECT id FROM users WHERE username=?", [
    username,
  ]);
  res.json({ exists: rows.length > 0 });
});

// POST /auth/check-email
router.post("/check-email", async (req, res) => {
  const { email } = req.body;
  const [rows] = await pool.execute("SELECT id FROM users WHERE email=?", [
    email,
  ]);
  res.json({ exists: rows.length > 0 });
});

module.exports = router;
