// routes/users.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const bcrypt = require("bcrypt");
const { logActivity } = require("../helpers/activity");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// กำหนด storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads/profile");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

router.get("/", authMiddleware(["admin"]), async (req, res) => {
  try {
    const [users] = await pool.execute(`
      SELECT id, username, fullname, email, profile_image, role, created_at
      FROM users
      ORDER BY FIELD(role, 'admin', 'owner', 'staff', 'tenant', 'guest'), id
    `);

    const userIds = users.map((u) => u.id);
    let ownerProps = [];
    let staffProps = [];
    let tenantBookings = [];

    if (userIds.length) {
      // Owner properties
      [ownerProps] = await pool.query(
        `SELECT u.id AS user_id, p.id AS prop_id, p.name, p.image, p.created_at
         FROM property_owners po
         JOIN properties p ON p.id = po.property_id
         JOIN users u ON u.id = po.owner_id
         WHERE u.id IN (?)`,
        [userIds]
      );

      // Staff properties
      [staffProps] = await pool.query(
        `SELECT u.id AS user_id, p.id AS prop_id, p.name, p.image, p.created_at
         FROM property_staff ps
         JOIN properties p ON p.id = ps.property_id
         JOIN users u ON u.id = ps.staff_id
         WHERE u.id IN (?)`,
        [userIds]
      );

      // Tenant bookings - ปรับ SQL เพื่อดึงข้อมูลหอและห้อง
      [tenantBookings] = await pool.query(
        `SELECT 
     u.id AS user_id,
     b.id AS booking_id,
     b.status AS booking_status,
     b.start_date,
     b.end_date,
     r.id AS room_id,
     r.name AS room_name,
     r.code AS room_code,
     p.id AS property_id,
     p.name AS property_name,
     p.image AS property_image
   FROM users u
   JOIN bookings b ON b.user_id = u.id
   JOIN rooms r ON r.id = b.room_id
   JOIN properties p ON p.id = r.property_id
   WHERE u.role = 'tenant' AND u.id IN (?)`,
        [userIds]
      );
    }

    const result = users.map((u) => {
      const properties = [
        ...ownerProps
          .filter((p) => p.user_id === u.id)
          .map((p) => ({
            id: p.prop_id,
            name: p.name,
            image: p.image,
            created_at: p.created_at,
            role: "owner",
          })),
        ...staffProps
          .filter((p) => p.user_id === u.id)
          .map((p) => ({
            id: p.prop_id,
            name: p.name,
            image: p.image,
            created_at: p.created_at,
            role: "staff",
          })),
      ];

      // จัดกลุ่มข้อมูล tenant bookings ตามหอและห้อง
      if (u.role === "tenant") {
        const bookingsByProperty = {};

        tenantBookings
          .filter((b) => b.user_id === u.id)
          .forEach((b) => {
            if (!bookingsByProperty[b.property_id]) {
              bookingsByProperty[b.property_id] = {
                property: {
                  id: b.property_id,
                  name: b.property_name,
                  image: b.property_image,
                },
                rooms: [],
              };
            }

            bookingsByProperty[b.property_id].rooms.push({
              booking_id: b.booking_id,
              status: b.status,
              start_date: b.start_date,
              end_date: b.end_date,
              id: b.room_id,
              name: b.room_name,
              code: b.room_code,
              status: b.room_status,
            });
          });

        const tenantProperties = Object.values(bookingsByProperty).map(
          (bp) => ({
            ...bp.property,
            role: "tenant",
            rooms: bp.rooms,
          })
        );

        return {
          ...u,
          properties: tenantProperties,
          // เก็บข้อมูล bookings ไว้สำหรับการใช้งานอื่นถ้าต้องการ
          bookings: tenantProperties,
        };
      }

      return { ...u, properties };
    });

    res.json(result);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: err.message });
  }
});
router.get("/me", authMiddleware(), async (req, res) => {
  try {
    // req.user.id มาจาก authMiddleware
    const [rows] = await pool.execute(
      "SELECT id, username, fullname, email, role FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!rows.length) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
});
// get owner by admin
router.get("/owners", authMiddleware(["admin"]), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, username FROM users WHERE role = 'owner'"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Get package receivers based on role
router.get(
  "/package-receivers",
  authMiddleware(["owner", "staff"]),
  async (req, res) => {
    const { role, id: userId } = req.user;

    try {
      let rows;

      if (role === "owner") {
        [rows] = await pool.execute(
          `
        SELECT DISTINCT u.id, u.fullname
        FROM users u
        JOIN bookings b ON b.user_id = u.id
        JOIN rooms r ON r.id = b.room_id
        JOIN properties p ON p.id = r.property_id
        JOIN property_owners po ON po.property_id = p.id
        WHERE po.owner_id = ?
      `,
          [userId]
        );
      } else if (role === "staff") {
        [rows] = await pool.execute(
          `
        SELECT DISTINCT u.id, u.fullname
        FROM users u
        JOIN bookings b ON b.user_id = u.id
        JOIN rooms r ON r.id = b.room_id
        JOIN properties p ON p.id = r.property_id
        JOIN property_staff ps ON ps.property_id = p.id
        WHERE ps.staff_id = ?
      `,
          [userId]
        );
      } else {
        rows = [];
      }

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);

// Get user by ID (any logged-in user)
router.get("/:id", authMiddleware(), async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, fullname, email, line, id_line, phone, age, role, profile_image 
       FROM users WHERE id=?`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ message: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /users/:id/property
router.get(
  "/:id/property",
  authMiddleware(["owner", "staff"]),
  async (req, res) => {
    const userId = req.params.id;

    try {
      // ตรวจสอบว่าผู้ใช้มีอยู่จริง
      const [user] = await pool.query("SELECT * FROM users WHERE id = ?", [
        userId,
      ]);
      if (!user.length) {
        return res.status(404).json({ message: "ไม่พบผู้ใช้" });
      }

      // ดึง property ของ user จาก bookings ล่าสุด
      const [props] = await pool.query(
        `SELECT p.id, p.name
         FROM properties p
         JOIN rooms r ON r.property_id = p.id
         JOIN bookings b ON b.room_id = r.id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC
         LIMIT 1`,
        [userId]
      );

      // ถ้าไม่เจอ property
      if (props.length === 0) {
        return res.json(null);
      }

      // ส่งกลับ property ล่าสุดของผู้ใช้
      res.json(props[0]); // { id, name }
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงหอของผู้ใช้" });
    }
  }
);

// ตรวจสอบ username แบบเรียลไทม์
router.get(
  "/check-username/:username",
  authMiddleware(["admin", "owner", "staff"]),
  async (req, res) => {
    try {
      const { username } = req.params;
      const { userId } = req.query; // รับ userId จาก query string

      // ตรวจสอบรูปแบบ username (ภาษาอังกฤษ/ตัวเลขเท่านั้น, ไม่มีช่องว่าง, ความยาวอย่างน้อย 4 ตัว)
      const usernameRegex = /^[a-zA-Z0-9]{4,}$/;
      if (!usernameRegex.test(username)) {
        return res.status(400).json({
          valid: false,
          message:
            "Username ต้องเป็นภาษาอังกฤษหรือตัวเลขเท่านั้น ไม่มีช่องว่าง และมีความยาวอย่างน้อย 4 ตัวอักษร",
        });
      }

      // ตรวจสอบ username ซ้ำ โดยไม่นับ userId ตัวเอง (ถ้ามีการส่งมา)
      let query = "SELECT id FROM users WHERE username = ?";
      let params = [username];

      if (userId) {
        query += " AND id != ?";
        params.push(userId);
      }

      const [exist] = await pool.execute(query, params);

      if (exist.length > 0) {
        return res.status(200).json({
          valid: false,
          message: "Username ถูกใช้แล้ว",
        });
      }

      return res.status(200).json({
        valid: true,
        message: "Username ใช้ได้",
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
// check mail
router.get("/check-email", async (req, res) => {
  const { email, excludeUserId } = req.query;
  try {
    let query = "SELECT id FROM users WHERE email = ?";
    const params = [email];

    if (excludeUserId) {
      query += " AND id != ?";
      params.push(excludeUserId);
    }

    const [rows] = await pool.execute(query, params);
    res.json({ exists: rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
// check phone
router.get("/check-phone", async (req, res) => {
  const { phone, excludeUserId } = req.query;
  try {
    let query = "SELECT id FROM users WHERE phone = ?";
    const params = [phone];

    if (excludeUserId) {
      query += " AND id != ?";
      params.push(excludeUserId);
    }

    const [rows] = await pool.execute(query, params);
    res.json({ exists: rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
// ฟังก์ชัน hash รหัสผ่าน
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};
// Create user (admin)
router.post("/", authMiddleware(["admin"]), async (req, res) => {
  try {
    const {
      username,
      fullname,
      email,
      password,
      role,
      property_ids = [],
    } = req.body;

    // hash password ก่อน insert
    const hashedPassword = await hashPassword(password);

    const [result] = await pool.execute(
      "INSERT INTO users (username, fullname, email, password_hash, role) VALUES (?,?,?,?,?)",
      [username, fullname, email, hashedPassword, role]
    );
    const userId = result.insertId;

    // ถ้า role = owner → ใส่ property_owners
    if (role === "owner" && property_ids.length > 0) {
      for (let propId of property_ids) {
        await pool.execute(
          "INSERT INTO property_owners (property_id, owner_id) VALUES (?, ?)",
          [propId, userId]
        );
      }
    }

    // ถ้า role = staff → ใส่ property_staff
    if (role === "staff" && property_ids.length > 0) {
      for (let propId of property_ids) {
        await pool.execute(
          "INSERT INTO property_staff (property_id, staff_id) VALUES (?, ?)",
          [propId, userId]
        );
      }
    }

    await logActivity(
      req.user.id,
      "create_user",
      "users",
      userId,
      `${req.user.username || "ไม่ทราบผู้ใช้"} สร้างผู้ใช้ใหม่ ${username}`
    );

    res.json({ message: "User created", id: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// อัปเดตโปรไฟล์ตัวเอง + อัพโหลดรูป หรือใส่ url ได้
router.put(
  "/profile/:id",
  authMiddleware(["guest", "tenant", "owner", "staff", "admin"]),
  upload.single("profile_image"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        username,
        fullname,
        email,
        line,
        id_line,
        phone,
        age,
        password,
        profile_image_url, // ✅ รับจาก body
      } = req.body;

      let profileImagePath = null;

      // ถ้ามีไฟล์ upload
      if (req.file) {
        profileImagePath = `/uploads/profile/${req.file.filename}`;
      }
      // ถ้าไม่ได้อัพไฟล์ แต่ส่ง url มาแทน
      else if (profile_image_url) {
        profileImagePath = profile_image_url;
      }
      // ถ้าไม่กรอกค่า -> เซ็ตเป็น null
      const safeFullname = fullname && fullname.trim() !== "" ? fullname : null;
      const safeEmail = email && email.trim() !== "" ? email : null;
      const safePhone = phone && phone.trim() !== "" ? phone : null;
      const safeLine = line && line.trim() !== "" ? line : null;
      const safeIdLine = id_line && id_line.trim() !== "" ? id_line : null;
      const safeAge = age && age !== "" ? age : null;

      // --- Build Query ---
      let query = `
        UPDATE users 
        SET username=?, fullname=?, email=?, line=?, id_line=?, phone=?, age=? 
        ${password ? ", password_hash=?" : ""}
        ${profileImagePath ? ", profile_image=?" : ""}
        WHERE id=?`;

      const params = [
        username,
        safeFullname,
        safeEmail,
        safeLine,
        safeIdLine,
        safePhone,
        safeAge,
      ];

      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        params.push(hashedPassword);
      }
      if (profileImagePath) {
        params.push(profileImagePath);
      }
      params.push(id);

      await pool.execute(query, params);
      await logActivity(
        req.user.id,
        "edit_profile",
        "user",
        id,
        `${req.user.username || "ไม่ทราบผู้ใช้"} ได้แก้ไขโปรไฟล์ของตนเอง`
      );

      res.json({
        message: "อัปเดตโปรไฟล์สำเร็จ",
        profile_image: profileImagePath,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์" });
    }
  }
);
// Update user by admin
router.put("/:id", authMiddleware(["admin"]), async (req, res) => {
  try {
    const { username, password, fullname, email, role, property_ids = [] } = req.body;
    const { id } = req.params;

    // เช็ค username ซ้ำ
    const [exist] = await pool.execute(
      "SELECT id FROM users WHERE username = ? AND id != ?",
      [username, id]
    );
    if (exist.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // ดึง role เดิมของ user
    const [oldUser] = await pool.execute("SELECT role FROM users WHERE id = ?", [id]);
    const oldRole = oldUser.length ? oldUser[0].role : null;

    // Update user (รวม role)
    let query = "UPDATE users SET username=?, fullname=?, email=?, role=? WHERE id=?";
    let params = [username, fullname, email, role, id];

    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      query = "UPDATE users SET username=?, fullname=?, email=?, role=?, password_hash=? WHERE id=?";
      params = [username, fullname, email, role, password_hash, id];
    }

    await pool.execute(query, params);

    // ถ้า role เปลี่ยนจาก owner/staff เป็น tenant/guest → ลบ mapping เดิม
    const oldIsOwnerOrStaff = oldRole === "owner" || oldRole === "staff";
    const newIsTenantOrGuest = role === "tenant" || role === "guest";

    if (oldIsOwnerOrStaff && newIsTenantOrGuest) {
      if (oldRole === "owner") {
        await pool.execute("DELETE FROM property_owners WHERE owner_id = ?", [id]);
      } else if (oldRole === "staff") {
        await pool.execute("DELETE FROM property_staff WHERE staff_id = ?", [id]);
      }
    }

    // ถ้า role = owner/staff → insert mapping ใหม่ (ไม่ลบเก่า)
    if ((role === "owner" || role === "staff") && Array.isArray(property_ids) && property_ids.length > 0) {
      const table = role === "owner" ? "property_owners" : "property_staff";
      const column = role === "owner" ? "owner_id" : "staff_id";

      for (const property_id of property_ids) {
        await pool.execute(
          `INSERT IGNORE INTO ${table} (property_id, ${column}, created_at) VALUES (?, ?, NOW())`,
          [property_id, id]
        );
      }
    }

    // Log activity
    await logActivity(
      req.user.id,
      "update_user",
      "user",
      id,
      `${req.user.username || "ไม่ทราบชื่อ"} อัปเดตข้อมูลผู้ใช้ ${username}`
    );

    res.json({ message: "User updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ✅ Delete user (admin)
router.delete("/:id", authMiddleware(["admin"]), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.beginTransaction();

    // 1. ดึงข้อมูล user
    const [[user]] = await connection.execute(
      "SELECT id, username, role FROM users WHERE id = ?",
      [id]
    );

    if (!user) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    // 🔒 2. เช็คเงื่อนไขตาม role
    if (user.role === "owner") {
      const [[{ count }]] = await connection.execute(
        "SELECT COUNT(*) AS count FROM property_owners WHERE owner_id = ?",
        [id]
      );
      if (count > 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "ไม่สามารถลบได้: ผู้ใช้นี้ยังเป็นเจ้าของหอพักอยู่",
        });
      }
    }

    if (user.role === "staff") {
      const [[{ count }]] = await connection.execute(
        "SELECT COUNT(*) AS count FROM property_staff WHERE staff_id = ?",
        [id]
      );
      if (count > 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "ไม่สามารถลบได้: ผู้ใช้นี้ยังถูกผูกกับหอพักอยู่",
        });
      }
    }

    if (user.role === "tenant") {
      const [[{ count }]] = await connection.execute(
        `
        SELECT COUNT(*) AS count
        FROM bookings
        WHERE user_id = ?
          AND status IN ('pending', 'confirmed')
        `,
        [id]
      );
      if (count > 0) {
        await connection.rollback();
        return res.status(400).json({
          message: "ไม่สามารถลบได้: ผู้เช่ายังมีการเช่าอยู่",
        });
      }
    }

    // 3. ลบ mapping ที่เหลือ (กรณีไม่มี dependency)
    await connection.execute(
      "DELETE FROM property_owners WHERE owner_id = ?",
      [id]
    );
    await connection.execute(
      "DELETE FROM property_staff WHERE staff_id = ?",
      [id]
    );

    // 4. ลบ user
    await connection.execute("DELETE FROM users WHERE id = ?", [id]);

    // 5. log
    await logActivity(
      req.user.id,
      "delete_user",
      "user",
      id,
      `${req.user.username} ลบผู้ใช้ ${user.username}`
    );

    await connection.commit();
    res.json({ message: `ลบผู้ใช้ ${user.username} สำเร็จ` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
});


module.exports = router;
