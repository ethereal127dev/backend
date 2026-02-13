// routes/reviews.js
const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const router = express.Router();

// ดึง reviews ของตัวเอง
router.get("/tenant", authMiddleware(["tenant"]), async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.execute(
      `
      SELECT 
        p.id AS property_id,
        p.name AS property_name,
        p.address AS property_address,
        p.description AS property_description,
        p.image AS property_image,
        r.id AS review_id,
        r.rating,
        r.comment,
        r.created_at AS review_created_at,
        r.updated_at AS review_updated_at,
        u.fullname AS user_fullname
      FROM reviews r
      JOIN properties p ON r.property_id = p.id
      JOIN users u ON r.user_id = u.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      `,
      [userId]
    );

    const result = rows.map((row) => ({
      property: {
        id: row.property_id,
        name: row.property_name,
        address: row.property_address,
        description: row.property_description,
        image: row.property_image,
      },
      review: {
        id: row.review_id,
        rating: row.rating,
        comment: row.comment,
        created_at: row.review_created_at,
        updated_at: row.review_updated_at,
      },
      user_fullname: row.user_fullname,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// ดึง reviews ของ admin (ดูทั้งหมด)
router.get("/admin", authMiddleware(["admin"]), async (req, res) => {
  try {
    console.log("Admin User ID:", req.user.id);
    console.log("Admin Role:", req.user.role);
    const [rows] = await pool.execute(
      `
      SELECT 
        r.id AS review_id,
        r.rating,
        r.comment,
        r.created_at AS review_created_at,
        r.updated_at AS review_updated_at,
        p.id AS property_id,
        p.name AS property_name,
        u.fullname AS user_fullname
      FROM reviews r
      JOIN properties p ON r.property_id = p.id
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
      `
    );

    const result = rows.map((row) => ({
      property: {
        id: row.property_id,
        name: row.property_name,
      },
      review: {
        id: row.review_id,
        rating: row.rating,
        comment: row.comment,
        created_at: row.review_created_at,
        updated_at: row.review_updated_at,
      },
      user_fullname: row.user_fullname,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ดึง reviews ของ owner/staff (ดูเฉพาะหอตัวเอง)
router.get(
  "/property",
  authMiddleware(["owner", "staff"]),
  async (req, res) => {
    try {
      const userId = req.user.id;

      // ดึง property ของ owner/staff
      let properties = [];
      if (req.user.role === "owner") {
        const [ownerProps] = await pool.execute(
          `SELECT property_id FROM property_owners WHERE owner_id = ?`,
          [userId]
        );
        properties = ownerProps;
      } else if (req.user.role === "staff") {
        const [staffProps] = await pool.execute(
          `SELECT property_id FROM property_staff WHERE staff_id = ?`,
          [userId]
        );
        properties = staffProps;
      }

      const propertyIds = properties.map((p) => p.property_id);

      console.log("UserId:", userId);
      console.log("Property IDs:", propertyIds);

      if (propertyIds.length === 0) {
        return res.json([]);
      }

      const placeholders = propertyIds.map(() => "?").join(",");

      const [rows] = await pool.execute(
        `
        SELECT 
          r.id AS review_id,
          r.rating,
          r.comment,
          r.created_at AS review_created_at,
          r.updated_at AS review_updated_at,
          p.id AS property_id,
          p.name AS property_name,
          u.fullname AS user_fullname
        FROM reviews r
        JOIN properties p ON r.property_id = p.id
        JOIN users u ON r.user_id = u.id
        WHERE r.property_id IN (${placeholders})
        ORDER BY r.created_at DESC
        `,
        propertyIds
      );

      const result = rows.map((row) => ({
        property: {
          id: row.property_id,
          name: row.property_name,
        },
        review: {
          id: row.review_id,
          rating: row.rating,
          comment: row.comment,
          created_at: row.review_created_at,
          updated_at: row.review_updated_at,
        },
        user_fullname: row.user_fullname,
      }));

      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// เพิ่มรีวิว
router.post("/", authMiddleware(["tenant"]), async (req, res) => {
  try {
    const { property_id, rating, comment } = req.body;
    const userId = req.user.id;

    await pool.execute(
      `
      INSERT INTO reviews (property_id, user_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [property_id, userId, rating, comment]
    );

    res.json({ message: "Review added" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// แก้ไขรีวิวของตัวเอง
router.put("/:id", authMiddleware(["tenant"]), async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user.id;
    const { property_id, rating, comment } = req.body;

    const [rows] = await pool.execute(
      `SELECT id FROM reviews WHERE id = ? AND user_id = ?`,
      [reviewId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ message: "ไม่สามารถแก้ไขรีวิวนี้ได้" });
    }

    await pool.execute(
      `
      UPDATE reviews
      SET property_id = ?, rating = ?, comment = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
      `,
      [property_id, rating, comment, reviewId, userId]
    );

    res.json({ message: "Review updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// ลบรีวิวของตัวเอง
router.delete("/:id", authMiddleware(["tenant"]), async (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user.id;

    // ตรวจสอบว่า review นี้เป็นของ user หรือไม่
    const [rows] = await pool.execute(
      `SELECT id FROM reviews WHERE id = ? AND user_id = ?`,
      [reviewId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ message: "ไม่สามารถลบรีวิวนี้ได้" });
    }

    await pool.execute(`DELETE FROM reviews WHERE id = ? AND user_id = ?`, [
      reviewId,
      userId,
    ]);

    res.json({ message: "Review deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
