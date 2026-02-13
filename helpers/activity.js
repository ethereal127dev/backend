const pool = require("../db"); // import connection db

async function logActivity(userId, action, targetType, targetId, description) {
    const sql = `
        INSERT INTO activity_log (user_id, action, target_type, target_id, description)
        VALUES (?, ?, ?, ?, ?)
    `;
    await pool.execute(sql, [userId, action, targetType, targetId, description]);
}

module.exports = { logActivity };
