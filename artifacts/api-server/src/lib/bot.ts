import TelegramBot from "node-telegram-bot-api";
import Groq from "groq-sdk";
import https from "https";
import { logger } from "./logger";

const groqApiKey = process.env["GROQ_API_KEY"];
if (!groqApiKey) throw new Error("GROQ_API_KEY environment variable is required.");
const groq = new Groq({ apiKey: groqApiKey });

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");

const bot = new TelegramBot(token, { polling: true });
logger.info("NexusBot_777_bot запускается...");

// ─── Download image to base64 ─────────────────────────────────────────────────
async function downloadImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── AI text response ─────────────────────────────────────────────────────────
async function getAIResponse(userMessage: string, userName: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content:
          `Ты умный и дружелюбный Telegram-бот NexusBot_777. ` +
          `Отвечай ТОЛЬКО на русском языке. Будь полезным, кратким и позитивным. ` +
          `Используй эмодзи где уместно. Пользователя зовут ${userName}. ` +
          `Не упоминай, что ты языковая модель или ИИ — просто отвечай как умный бот-помощник.`,
      },
      { role: "user", content: userMessage },
    ],
    max_tokens: 512,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не смог придумать ответ, попробуй ещё раз!";
}

// ─── AI vision response ───────────────────────────────────────────────────────
async function getVisionResponse(base64Image: string, caption: string | undefined): Promise<string> {
  const userPrompt = caption
    ? `Опиши что изображено на фото. Также учти подпись пользователя: "${caption}"`
    : "Подробно опиши что изображено на этом фото на русском языке.";

  const completion = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${base64Image}` },
          },
          {
            type: "text",
            text: userPrompt,
          },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не удалось распознать изображение, попробуй ещё раз!";
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const name = msg.from?.first_name ?? "друг";
  await bot.sendMessage(
    msg.chat.id,
    `🌟 *Привет, ${escapeMarkdown(name)}\\!* Я *NexusBot\\_777* — твой умный ИИ\\-помощник\\.\n\n` +
    `🤖 Я умею:\n` +
    `• 💬 Отвечать на любые вопросы\n` +
    `• 🖼️ Анализировать и описывать фотографии\n\n` +
    `📋 *Команды:*\n` +
    `/start — приветствие\n` +
    `/help — помощь\n\n` +
    `✨ Напиши вопрос или отправь фото — я отвечу\\!`,
    { parse_mode: "MarkdownV2" },
  );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `🤖 *NexusBot\\_777 — Помощь*\n\n` +
    `Я умный бот на базе ИИ\\. Задай вопрос или отправь фото\\!\n\n` +
    `📋 *Команды:*\n` +
    `/start — приветственное сообщение\n` +
    `/help — эта справка\n\n` +
    `💬 *Примеры вопросов:*\n` +
    `• Что такое чёрная дыра\\?\n` +
    `• Как приготовить борщ\\?\n` +
    `• Расскажи анекдот\n\n` +
    `🖼️ *Распознавание изображений:*\n` +
    `Отправь мне любое фото и я подробно опишу что на нём изображено\\. Можешь добавить подпись к фото с уточняющим вопросом\\!`,
    { parse_mode: "MarkdownV2" },
  );
});

// ─── Photo handler ────────────────────────────────────────────────────────────
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, "typing");

    // Pick the highest-resolution photo
    const photos = msg.photo!;
    const bestPhoto = photos[photos.length - 1];
    const fileLink = await bot.getFileLink(bestPhoto.file_id);

    const base64 = await downloadImageAsBase64(fileLink);
    const reply = await getVisionResponse(base64, msg.caption);

    await bot.sendMessage(chatId, `🖼️ *Анализ изображения:*\n\n${reply}`, { parse_mode: "Markdown" });
  } catch (err: any) {
    logger.error({ err }, "Vision API error");
    const isModelError = err?.error?.error?.code === "model_decommissioned" || err?.status === 400;
    if (isModelError) {
      await bot.sendMessage(
        chatId,
        "🖼️ Распознавание изображений временно недоступно — Groq обновляет свои модели компьютерного зрения.\n\n⏳ Функция скоро вернётся! А пока можешь задать мне любой текстовый вопрос. 😊",
      );
    } else {
      await bot.sendMessage(chatId, "😅 Не удалось проанализировать изображение. Попробуй ещё раз позже!");
    }
  }
});

// ─── Text message handler ─────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? "друг";

  logger.info({ chatId, text: msg.text }, "Received message");

  try {
    await bot.sendChatAction(chatId, "typing");
    const reply = await getAIResponse(msg.text, userName);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    logger.error({ err }, "Groq API error");
    await bot.sendMessage(chatId, "😅 Что-то пошло не так, попробуй ещё раз!");
  }
});

bot.on("polling_error", (err) => logger.error({ err }, "Telegram polling error"));
bot.on("error", (err) => logger.error({ err }, "Telegram bot error"));

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export default bot;
