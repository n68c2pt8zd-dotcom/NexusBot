import TelegramBot from "node-telegram-bot-api";
import Groq from "groq-sdk";
import { logger } from "./logger";

const groqApiKey = process.env["GROQ_API_KEY"];
if (!groqApiKey) throw new Error("GROQ_API_KEY environment variable is required.");
const groq = new Groq({ apiKey: groqApiKey });

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");

const bot = new TelegramBot(token, { polling: true });
logger.info("NexusBot_777_bot запускается...");

// ─── AI response ──────────────────────────────────────────────────────────────
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

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const name = msg.from?.first_name ?? "друг";
  await bot.sendMessage(
    msg.chat.id,
    `🌟 *Привет, ${escapeMarkdown(name)}!* Я *NexusBot\\_777* — твой умный помощник.\n\n` +
    `🤖 Спроси меня что угодно — я отвечу на русском языке.\n\n` +
    `📋 Команды:\n` +
    `/start — приветствие\n` +
    `/help — помощь\n\n` +
    `💬 Просто напиши мне сообщение и я отвечу!`,
    { parse_mode: "Markdown" },
  );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `🤖 *NexusBot\\_777 — Помощь*\n\n` +
    `Я умный бот на базе ИИ. Задай мне любой вопрос и я отвечу на русском языке.\n\n` +
    `📋 *Команды:*\n` +
    `/start — приветственное сообщение\n` +
    `/help — эта справка\n\n` +
    `💡 *Примеры вопросов:*\n` +
    `• Что такое чёрная дыра?\n` +
    `• Как приготовить борщ?\n` +
    `• Расскажи анекдот\n` +
    `• Переведи "hello world" на русский\n\n` +
    `✨ Просто напиши — и я отвечу!`,
    { parse_mode: "Markdown" },
  );
});

// ─── Main message handler ─────────────────────────────────────────────────────
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
