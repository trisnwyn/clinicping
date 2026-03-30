/* ============================================================
   ClinicPing Chatbot — Express backend  (server.js)
   Holds the Groq API key securely; the frontend never sees it.

   Start:  node server.js
   Needs:  npm install express cors dotenv node-fetch
   ============================================================ */

import express  from "express";
import cors     from "cors";
import dotenv   from "dotenv";
import fetch    from "node-fetch";   // built-in in Node 18+; kept for Node 16 compat

dotenv.config();   // loads GROQ_API_KEY from .env

// ── Config ─────────────────────────────────────────────────
const PORT         = process.env.PORT || 3001;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.1-8b-instant";   // fast + cheap

// ── System prompt ───────────────────────────────────────────
// This is the "personality" of the bot. It is sent with every
// request but is never exposed to the browser.
const SYSTEM_PROMPT = `
Bạn là trợ lý ảo chính thức của ClinicPing — hệ thống nhắc lịch hẹn tự động bằng AI dành cho các phòng khám nhỏ tại Việt Nam.
You are the official virtual assistant for ClinicPing — an AI-powered appointment reminder system for small clinics in Vietnam.

## Ngôn ngữ / Language
- Nếu người dùng viết tiếng Việt → trả lời hoàn toàn bằng tiếng Việt.
- If the user writes in English → reply entirely in English.
- If mixed, match the dominant language.

## Về ClinicPing / About ClinicPing
- ClinicPing là hệ thống tự động gửi nhắc lịch hẹn qua Zalo và SMS cho bệnh nhân.
- ClinicPing automatically sends appointment reminders via Zalo and SMS to patients.
- Nhắc nhở được gửi 24 giờ và 2 giờ trước lịch hẹn.
- Reminders are sent 24 h and 2 h before the appointment.
- Bệnh nhân nhắn "1" để xác nhận, "2" để huỷ lịch.
- Patients reply "1" to confirm or "2" to cancel.
- Khi hủy, hệ thống tự động điền slot từ danh sách chờ (waitlist).
- Cancelled slots are automatically filled from the waitlist.
- Không cần cài phần mềm — hệ thống chạy trên Google Sheets + Make.com.
- No software installation needed — runs on Google Sheets + Make.com.

## Khách hàng mục tiêu / Target customers
- Phòng khám nha khoa, thẩm mỹ, da liễu, spa nhỏ tại Hà Nội.
- Small dental, beauty, skincare, and spa clinics in Hanoi.

## Bảng giá / Pricing (VND/tháng — per month)
| Gói / Plan | Giá / Price |
|------------|-------------|
| Starter    | 299.000 đ   |
| Growth     | 599.000 đ   |
| Pro        | 999.000 đ   |
- Tất cả các gói đều có **dùng thử miễn phí 2 tuần** và cài đặt miễn phí.
- All plans include a **free 2-week trial** with full setup included.

## Liên hệ đăng ký / Sign-up contact
- Zalo / Email: [your Zalo/email here]
  (Replace this placeholder before going live!)

## Quy tắc trả lời / Answer rules
1. Chỉ trả lời các câu hỏi liên quan đến ClinicPing hoặc vấn đề quản lý lịch hẹn phòng khám.
   Only answer questions about ClinicPing or clinic appointment management.
2. Nếu câu hỏi nằm ngoài phạm vi, lịch sự từ chối và gợi ý liên hệ trực tiếp.
   If a question is out of scope, politely decline and suggest direct contact.
3. Giữ câu trả lời ngắn gọn, thân thiện, rõ ràng.
   Keep answers concise, friendly, and clear.
4. Không bịa thêm tính năng hoặc mức giá không được liệt kê ở trên.
   Do not invent features or prices not listed above.
`.trim();

// ── Validate env ────────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error(
    "❌  GROQ_API_KEY is missing.\n" +
    "    Create a .env file with:  GROQ_API_KEY=your_key_here"
  );
  process.exit(1);
}

// ── Express app ─────────────────────────────────────────────
const app = express();

// Allow your landing page origin. In production, replace "*" with
// your actual domain, e.g. "https://clinicping.vn"
app.use(cors({ origin: "*" }));

app.use(express.json());

// ── POST /api/chat ──────────────────────────────────────────
// Body: { messages: [{role, content}, ...] }
// The frontend sends the full conversation history so the bot has context.
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  // Basic validation.
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // Validate each message shape to prevent prompt injection via the body.
  const isValidRole = (r) => r === "user" || r === "assistant";
  const clean = messages
    .filter((m) => m && isValidRole(m.role) && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));  // cap length

  if (clean.length === 0) {
    return res.status(400).json({ error: "No valid messages provided" });
  }

  try {
    // Forward to Groq — prepend the system prompt every time.
    const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,  // key stays on server
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...clean,
        ],
        temperature: 0.5,       // slightly creative but mostly factual
        max_tokens: 512,        // enough for a helpful FAQ answer
        stream: false,
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error("[Groq error]", groqRes.status, errBody);
      return res.status(502).json({ error: "Groq API error", detail: errBody });
    }

    const data = await groqRes.json();

    // Extract the assistant's reply text.
    const reply = data.choices?.[0]?.message?.content ?? "";

    return res.json({ reply });

  } catch (err) {
    console.error("[server error]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Health check (optional) ─────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  ClinicPing chat backend running at http://localhost:${PORT}`);
});
