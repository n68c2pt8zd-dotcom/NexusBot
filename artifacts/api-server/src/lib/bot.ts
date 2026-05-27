import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const token = process.env["TELEGRAM_BOT_TOKEN"];

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");
}

const bot = new TelegramBot(token, { polling: true });

logger.info("NexusBot_777_bot starting in polling mode...");

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ?? "";
  const username = msg.from?.username ?? msg.from?.first_name ?? "there";

  logger.info({ chatId, text }, "Received message");

  if (text.startsWith("/start")) {
    await bot.sendMessage(
      chatId,
      `👋 Hey ${username}! I'm NexusBot_777_bot.\n\nHere's what I can do:\n/start — Show this welcome message\n/help — List available commands\n/echo <text> — Repeat your message back\n/ping — Check if I'm alive`,
    );
  } else if (text.startsWith("/help")) {
    await bot.sendMessage(
      chatId,
      `🤖 *NexusBot_777_bot Commands*\n\n/start — Welcome message\n/help — This help menu\n/echo <text> — Echo back your text\n/ping — Ping the bot`,
      { parse_mode: "Markdown" },
    );
  } else if (text.startsWith("/echo ")) {
    const echoed = text.slice(6).trim();
    await bot.sendMessage(chatId, echoed || "Nothing to echo!");
  } else if (text === "/ping") {
    await bot.sendMessage(chatId, "🏓 Pong! I'm alive and running.");
  } else if (text.startsWith("/")) {
    await bot.sendMessage(
      chatId,
      `Unknown command. Try /help to see what I can do.`,
    );
  } else {
    await bot.sendMessage(
      chatId,
      `You said: "${text}"\n\nUse /help to see available commands.`,
    );
  }
});

bot.on("polling_error", (err) => {
  logger.error({ err }, "Telegram polling error");
});

bot.on("error", (err) => {
  logger.error({ err }, "Telegram bot error");
});

export default bot;
