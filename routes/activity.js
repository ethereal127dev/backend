// routes/activity.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware(["admin", "owner", "staff"]), async (req, res) => {
    const role = req.user.role;
    const userId = req.user.id;

    let sql = `
        SELECT al.*, u.fullname AS user_fullname, u.username AS user_username
        FROM activity_log al
        JOIN users u ON u.id = al.user_id
        ORDER BY al.created_at DESC
        LIMIT 50
    `;

    if (role === "owner") {
        sql = `
            SELECT al.*, u.fullname AS user_fullname, u.username AS user_username
            FROM activity_log al
            JOIN users u ON u.id = al.user_id
            LEFT JOIN properties p ON al.target_type='property' AND al.target_id=p.id
            LEFT JOIN property_owners po ON po.property_id=p.id
            WHERE po.owner_id = ?
            ORDER BY al.created_at DESC
            LIMIT 50
        `;
        const [rows] = await pool.execute(sql, [userId]);
        return res.json(rows);
    } else if (role === "staff") {
        sql = `
            SELECT al.*, u.fullname AS user_fullname, u.username AS user_username
            FROM activity_log al
            JOIN users u ON u.id = al.user_id
            LEFT JOIN properties p ON al.target_type='property' AND al.target_id=p.id
            LEFT JOIN property_staff ps ON ps.property_id=p.id
            WHERE ps.staff_id = ?
            ORDER BY al.created_at DESC
            LIMIT 50
        `;
        const [rows] = await pool.execute(sql, [userId]);
        return res.json(rows);
    }

    const [rows] = await pool.execute(sql);
    res.json(rows);
});

module.exports = router;
