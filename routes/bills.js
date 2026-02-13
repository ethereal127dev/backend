// routes/bills.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { sendLineFlexMessage } = require("../utils/lineBot");

// ดึงราคาห้องทั้งหมด (สำหรับ owner/staff)
router.get("/prices", authMiddleware(["owner", "staff"]), async (req, res) => {
  try {
    const { id: userId, role } = req.user;

    let query = `
      SELECT 
        r.id AS room_id,
        r.name,
        r.code,
        r.price_monthly,
        r.price_term,
        r.deposit,
        p.name AS property_name,
        b.id AS booking_id,
        b.billing_cycle,
        u.fullname AS user_fullname,
        bl.id AS bill_id,
        bl.status AS bill_status
      FROM rooms r
      JOIN properties p ON p.id = r.property_id
      JOIN bookings b ON b.room_id = r.id AND b.status='confirmed'
      JOIN users u ON u.id = b.user_id
      LEFT JOIN bills bl ON bl.booking_id = b.id
    `;

    const params = [];
    if (role === "owner") {
      query +=
        " WHERE p.id IN (SELECT property_id FROM property_owners WHERE owner_id = ?)";
      params.push(userId);
    } else if (role === "staff") {
      query +=
        " WHERE p.id IN (SELECT property_id FROM property_staff WHERE staff_id = ?)";
      params.push(userId);
    }

    query += " ORDER BY p.name ASC, r.name ASC";

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching room prices" });
  }
});

// ดึงบิลทั้งหมดของ booking
router.get("/byBooking/:booking_id", async (req, res) => {
  try {
    const { booking_id } = req.params;
    const [bills] = await pool.execute(
      `SELECT *
       FROM bills
       WHERE booking_id = ?
       ORDER BY billing_date DESC, id DESC`,
      [booking_id]
    );
    res.json(bills);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching bills" });
  }
});

// เพิ่มบิลใหม่
router.post("/add", async (req, res) => {
  try {
    let {
      booking_id,
      water_units,
      electric_units,
      other_charges,
      note,
      include_room_price,
    } = req.body;

    // ✅ บังคับเป็น Number
    water_units = parseFloat(water_units) || 0;
    electric_units = parseFloat(electric_units) || 0;
    other_charges = parseFloat(other_charges) || 0;

    // ดึงข้อมูล booking + room + property
    const [[booking]] = await pool.execute(
      `SELECT b.billing_cycle, b.room_id, r.price_monthly, r.price_term, p.id AS property_id
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE b.id = ?`,
      [booking_id]
    );

    if (!booking) return res.status(404).json({ message: "Booking ไม่พบ" });

    // ดึงค่า rate น้ำ/ไฟ
    const [[electric]] = await pool.execute(
      `SELECT rate FROM property_utilities WHERE property_id = ? AND type='electric' LIMIT 1`,
      [booking.property_id]
    );
    const [[water]] = await pool.execute(
      `SELECT rate FROM property_utilities WHERE property_id = ? AND type='water' LIMIT 1`,
      [booking.property_id]
    );

    // ✅ แปลง rate ให้เป็น number
    const water_rate = parseFloat(water?.rate) || 0;
    const electric_rate = parseFloat(electric?.rate) || 0;

    // คำนวณค่าห้องเฉพาะถ้าติ้ก
    const room_price = include_room_price
      ? booking.billing_cycle === "term"
        ? parseFloat(booking.price_term) || 0
        : parseFloat(booking.price_monthly) || 0
      : 0;

    const water_total = water_units * water_rate;
    const electric_total = electric_units * electric_rate;
    const other_total = other_charges;

    // ✅ บังคับรวมเป็นเลขทศนิยม 2 ตำแหน่ง
    const total_amount = parseFloat(
      (room_price + water_total + electric_total + other_total).toFixed(2)
    );

    // บันทึกลง bills
    const [result] = await pool.execute(
      `INSERT INTO bills
       (booking_id, billing_date, billing_cycle, room_price, water_units, electric_units, other_charges, note, total_amount)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking_id,
        booking.billing_cycle,
        room_price,
        water_units,
        electric_units,
        other_total,
        note || null,
        total_amount,
      ]
    );

    res.json({ message: "บันทึกบิลสำเร็จ", bill_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// ส่งบิลไปยังผู้เช่าทาง LINE
router.post("/send/:id", async (req, res) => {
  try {
    const billId = req.params.id;

    const [[bill]] = await pool.execute(
      `
      SELECT 
        b.id, b.total_amount, b.room_price, b.water_units, b.electric_units, 
        b.other_charges, b.note, b.billing_date,
        u.fullname, u.id_line,
        r.name AS room_name, r.code AS room_code,
        p.name AS property_name, p.id AS property_id
      FROM bills b
      JOIN bookings bk ON bk.id = b.booking_id
      JOIN users u ON u.id = bk.user_id
      JOIN rooms r ON r.id = bk.room_id
      JOIN properties p ON p.id = r.property_id
      WHERE b.id = ?
      `,
      [billId]
    );

    if (!bill) return res.status(404).json({ message: "ไม่พบบิล" });
    if (!bill.id_line)
      return res.status(400).json({ message: "ผู้ใช้ยังไม่ได้ผูก LINE" });

    const [utilities] = await pool.execute(
      `SELECT type, rate FROM property_utilities WHERE property_id = ?`,
      [bill.property_id]
    );

    const waterRate = utilities.find((u) => u.type === "water")?.rate || 0;
    const electricRate =
      utilities.find((u) => u.type === "electric")?.rate || 0;

    const formatNumber = (num) =>
      Number(num).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const formattedDate = new Date(bill.billing_date).toLocaleDateString(
      "th-TH",
      { year: "numeric", month: "long", day: "numeric" }
    );

    const waterCharge = bill.water_units * waterRate;
    const electricCharge = bill.electric_units * electricRate;

    // ✅ Flex Message JSON
    const flexMessage = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📢 แจ้งบิลค่าห้องเช่า",
            weight: "bold",
            size: "lg",
            color: "#d32f2f",
          },
          {
            type: "text",
            text: `${bill.property_name} • ห้อง ${bill.room_name} (${bill.room_code})`,
            size: "sm",
            color: "#555555",
            margin: "sm",
          },
          {
            type: "text",
            text: `ผู้เช่า: ${bill.fullname}`,
            size: "sm",
            margin: "sm",
          },
          {
            type: "text",
            text: `วันที่ออกบิล: ${formattedDate}`,
            size: "sm",
            margin: "sm",
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "baseline",
                contents: [
                  { type: "text", text: "ค่าห้อง", flex: 2, size: "sm" },
                  {
                    type: "text",
                    text: `${formatNumber(bill.room_price)} บาท`,
                    flex: 3,
                    size: "sm",
                    align: "end",
                  },
                ],
              },
              ...(bill.water_units
                ? [
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: `ค่าน้ำ (${bill.water_units} หน่วย)`,
                          flex: 2,
                          size: "sm",
                          wrap: true,
                          align: "start",
                        },
                        {
                          type: "text",
                          text: `${formatNumber(waterCharge)} บาท`,
                          flex: 3,
                          size: "sm",
                          align: "end",
                          weight: "bold",
                          wrap: true,
                        },
                      ],
                    },
                  ]
                : []),
              ...(bill.electric_units
                ? [
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: `ค่าไฟ (${bill.electric_units} หน่วย)`,
                          flex: 2,
                          size: "sm",
                          wrap: true,
                          align: "start",
                        },
                        {
                          type: "text",
                          text: `${formatNumber(electricCharge)} บาท`,
                          flex: 3,
                          size: "sm",
                          align: "end",
                          weight: "bold",
                          wrap: true,
                        },
                      ],
                    },
                  ]
                : []),
              ...(bill.other_charges
                ? [
                    {
                      type: "box",
                      layout: "baseline",
                      contents: [
                        { type: "text", text: "ค่าอื่นๆ", flex: 2, size: "sm" },
                        {
                          type: "text",
                          text: `${formatNumber(bill.other_charges)} บาท`,
                          flex: 3,
                          size: "sm",
                          align: "end",
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "baseline",
            margin: "md",
            contents: [
              {
                type: "text",
                text: "💰 ยอดรวม",
                weight: "bold",
                size: "sm",
                flex: 2,
              },
              {
                type: "text",
                text: `${formatNumber(bill.total_amount)} บาท`,
                weight: "bold",
                size: "sm",
                flex: 3,
                align: "end",
                color: "#d32f2f",
              },
            ],
          },
          {
            type: "text",
            text: "✅ ชำระแล้วกรุณายืนยันในระบบ",
            size: "sm",
            color: "#1976d2",
            wrap: true,
            margin: "sm",
            weight: "bold",
          },
          ...(bill.note
            ? [
                {
                  type: "text",
                  text: `หมายเหตุ: ${bill.note}`,
                  size: "xs",
                  color: "#777777",
                  wrap: true,
                  margin: "sm",
                },
              ]
            : []),
        ],
      },
    };

    await sendLineFlexMessage(bill.id_line, flexMessage);

    res.json({ message: "ส่งบิล (Flex Message) เรียบร้อยแล้ว" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// แก้ไขบิลที่มีอยู่
router.put("/:id", async (req, res) => {
  try {
    const billId = req.params.id;
    let {
      booking_id,
      water_units,
      electric_units,
      other_charges,
      note,
      include_room_price,
    } = req.body;

    // ✅ บังคับเป็น Number
    water_units = parseFloat(water_units) || 0;
    electric_units = parseFloat(electric_units) || 0;
    other_charges = parseFloat(other_charges) || 0;

    // ดึงข้อมูล booking + room + property
    const [[booking]] = await pool.execute(
      `SELECT b.billing_cycle, b.room_id, r.price_monthly, r.price_term, p.id AS property_id
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE b.id = ?`,
      [booking_id]
    );

    if (!booking) return res.status(404).json({ message: "Booking ไม่พบ" });

    // ดึงค่า rate น้ำ/ไฟ
    const [[electric]] = await pool.execute(
      `SELECT rate FROM property_utilities WHERE property_id = ? AND type='electric' LIMIT 1`,
      [booking.property_id]
    );
    const [[water]] = await pool.execute(
      `SELECT rate FROM property_utilities WHERE property_id = ? AND type='water' LIMIT 1`,
      [booking.property_id]
    );

    // ✅ แปลง rate ให้เป็น number
    const water_rate = parseFloat(water?.rate) || 0;
    const electric_rate = parseFloat(electric?.rate) || 0;

    // คำนวณค่าห้องเฉพาะถ้าติ้ก
    const room_price = include_room_price
      ? booking.billing_cycle === "term"
        ? parseFloat(booking.price_term) || 0
        : parseFloat(booking.price_monthly) || 0
      : 0;

    const water_total = water_units * water_rate;
    const electric_total = electric_units * electric_rate;
    const other_total = other_charges;

    const total_amount = parseFloat(
      (room_price + water_total + electric_total + other_total).toFixed(2)
    );

    // อัปเดตบิล
    const [result] = await pool.execute(
      `UPDATE bills 
       SET booking_id=?, billing_cycle=?, room_price=?, water_units=?, electric_units=?, other_charges=?, note=?, total_amount=?,status='unpaid', paid_at=NULL, updated_at=NOW() 
       WHERE id=?`,
      [
        booking_id,
        booking.billing_cycle,
        room_price,
        water_units,
        electric_units,
        other_total,
        note || null,
        total_amount,
        billId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบบิลที่ต้องการแก้ไข" });
    }

    res.json({ message: "อัปเดตบิลสำเร็จ", bill_id: billId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// ยืนยันการชำระเงิน (เปลี่ยน status เป็น paid)
router.put("/confirm/:id", async (req, res) => {
  try {
    const billId = req.params.id;

    const [result] = await pool.execute(
      `UPDATE bills 
       SET status='paid', created_at=NOW()
       WHERE id=?`,
      [billId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบบิลที่ต้องการยืนยัน" });
    }

    res.json({ message: "ยืนยันการชำระเงินเรียบร้อยแล้ว", bill_id: billId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการยืนยันการชำระเงิน" });
  }
});
// ✅ ลบบิลตาม id
router.delete("/:id", authMiddleware(["owner", "staff"]), async (req, res) => {
  try {
    const billId = req.params.id;

    // ตรวจสอบว่าบิลมีอยู่จริง
    const [[bill]] = await pool.execute(`SELECT * FROM bills WHERE id = ?`, [
      billId,
    ]);
    if (!bill) {
      return res.status(404).json({ message: "ไม่พบบิลที่ต้องการลบ" });
    }

    // ลบบิล
    const [result] = await pool.execute(`DELETE FROM bills WHERE id = ?`, [
      billId,
    ]);

    if (result.affectedRows === 0) {
      return res.status(400).json({ message: "ลบบิลไม่สำเร็จ" });
    }

    res.json({ message: "ลบบิลเรียบร้อยแล้ว", bill_id: billId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบบิล" });
  }
});

module.exports = router;
