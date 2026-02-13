// utils/lineBot.js
const axios = require("axios");
require("dotenv").config();

const sendLineFlexMessage = async (userId, contents) => {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [
          {
            type: "flex",
            altText: "📢 แจ้งบิลค่าห้องเช่า",
            contents, // JSON ของ Flex Message
          },
        ],
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
    console.error(
      "❌ LINE Messaging API error:",
      err.response?.data || err.message
    );
  }
};

module.exports = { sendLineFlexMessage };
