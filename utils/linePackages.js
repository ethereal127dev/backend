// utils/linePackeages.js
const axios = require("axios");
require("dotenv").config();

// ส่ง Flex Message
const sendLineFlexMessage = async (userId, flexMessage) => {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [{ type: "flex", altText: "แจ้งพัสดุใหม่", contents: flexMessage }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    console.log("✅ ส่ง Flex Message สำเร็จ");
  } catch (err) {
    console.error("❌ LINE Messaging API error:", err.response?.data || err.message);
  }
};

module.exports = { sendLineFlexMessage };
