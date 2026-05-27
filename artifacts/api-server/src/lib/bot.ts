import TelegramBot from "node-telegram-bot-api";
import Groq from "groq-sdk";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { botUsersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const groqApiKey = process.env["GROQ_API_KEY"];
if (!groqApiKey) throw new Error("GROQ_API_KEY environment variable is required.");
const groq = new Groq({ apiKey: groqApiKey });

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");

const bot = new TelegramBot(token, { polling: true });
logger.info("NexusBot_777_bot запускается...");

// ─── Levels ───────────────────────────────────────────────────────────────────
function getLevel(points: number): { name: string; emoji: string; next: number | null } {
  if (points >= 1000) return { name: "Легенда", emoji: "🏆", next: null };
  if (points >= 500)  return { name: "Эксперт", emoji: "💎", next: 1000 };
  if (points >= 100)  return { name: "Продвинутый", emoji: "⚡", next: 500 };
  return { name: "Новичок", emoji: "🌱", next: 100 };
}

// ─── Achievements ──────────────────────────────────────────────────────────────
const ACHIEVEMENTS: Record<string, { emoji: string; desc: string; condition: (u: { points: number; messageCount: number }) => boolean }> = {
  "first_message":  { emoji: "💬", desc: "Первое сообщение",      condition: u => u.messageCount >= 1 },
  "ten_messages":   { emoji: "🗣️",  desc: "10 сообщений отправлено", condition: u => u.messageCount >= 10 },
  "fifty_messages": { emoji: "📢", desc: "50 сообщений отправлено", condition: u => u.messageCount >= 50 },
  "hundred_points": { emoji: "💯", desc: "100 очков заработано",   condition: u => u.points >= 100 },
  "expert_rank":    { emoji: "💎", desc: "Достиг ранга Эксперт",   condition: u => u.points >= 500 },
  "legend_rank":    { emoji: "🏆", desc: "Достиг ранга Легенда",   condition: u => u.points >= 1000 },
};

function checkNewAchievements(user: { points: number; messageCount: number; achievements: string[] }): string[] {
  const newOnes: string[] = [];
  for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
    if (!user.achievements.includes(key) && ach.condition(user)) {
      newOnes.push(key);
    }
  }
  return newOnes;
}

// ─── Groq AI response ─────────────────────────────────────────────────────────
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
          `Не упоминай, что ты языковая модель или ИИ — просто отвечай как умный бот-помощник. ` +
          `Если спрашивают про очки, уровни или рейтинг — направь к командам /profile, /top, /rewards.`,
      },
      { role: "user", content: userMessage },
    ],
    max_tokens: 512,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не смог придумать ответ, попробуй ещё раз!";
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function getOrCreateUser(msg: TelegramBot.Message) {
  const telegramId = msg.from!.id;
  const existing = await db.select().from(botUsersTable).where(eq(botUsersTable.telegramId, telegramId)).limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await db.insert(botUsersTable).values({
    telegramId,
    username: msg.from?.username ?? null,
    firstName: msg.from?.first_name ?? null,
    points: 0,
    messageCount: 0,
    achievements: [],
  }).returning();
  return created;
}

async function addPoints(telegramId: number, pts: number) {
  const [user] = await db.select().from(botUsersTable).where(eq(botUsersTable.telegramId, telegramId));
  const newPoints = (user?.points ?? 0) + pts;
  const newCount = (user?.messageCount ?? 0) + 1;

  const newAchievements = checkNewAchievements({
    points: newPoints,
    messageCount: newCount,
    achievements: user?.achievements ?? [],
  });

  const allAchievements = [...(user?.achievements ?? []), ...newAchievements];

  const [updated] = await db.update(botUsersTable)
    .set({ points: newPoints, messageCount: newCount, achievements: allAchievements, updatedAt: new Date() })
    .where(eq(botUsersTable.telegramId, telegramId))
    .returning();

  return { user: updated, newAchievements };
}

async function getRank(telegramId: number): Promise<number> {
  const all = await db.select().from(botUsersTable).orderBy(desc(botUsersTable.points));
  return all.findIndex(u => u.telegramId === telegramId) + 1;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "друг";
  await getOrCreateUser(msg);

  await bot.sendMessage(chatId,
    `🌟 *Добро пожаловать в NexusBot\\_777!* 🌟\n\n` +
    `Привет, *${name}*! Я твой умный помощник с системой наград! 🎮\n\n` +
    `✨ *Как это работает:*\n` +
    `• Каждое сообщение = +10 очков\n` +
    `• Копи очки и повышай уровень\n` +
    `• Зарабатывай достижения\n\n` +
    `🏅 *Уровни:*\n` +
    `🌱 Новичок — 0–100 очков\n` +
    `⚡ Продвинутый — 100–500 очков\n` +
    `💎 Эксперт — 500–1000 очков\n` +
    `🏆 Легенда — 1000+ очков\n\n` +
    `📋 *Команды:*\n` +
    `/profile — мой профиль и статистика\n` +
    `/top — топ 10 пользователей\n` +
    `/rewards — достижения и награды\n` +
    `/help — помощь\n\n` +
    `🚀 Начнём? Просто напиши мне что-нибудь!`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId,
    `🤖 *Справка NexusBot\\_777*\n\n` +
    `📋 *Доступные команды:*\n\n` +
    `/start — приветственное сообщение\n` +
    `/profile — твой профиль, очки и уровень\n` +
    `/top — таблица лидеров (топ 10)\n` +
    `/rewards — все достижения и награды\n` +
    `/help — эта справка\n\n` +
    `💡 *Совет:* Просто пиши мне — за каждое сообщение ты получаешь *+10 очков*!\n\n` +
    `❓ Можешь спросить меня о чём угодно — время, дату, анекдот или интересный факт!`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getOrCreateUser(msg);
  const rank = await getRank(user.telegramId);
  const level = getLevel(user.points);
  const name = user.firstName ?? user.username ?? "Пользователь";

  const progressBar = level.next
    ? buildProgressBar(user.points, level.next)
    : "🏆 Максимальный уровень достигнут!";

  const achCount = user.achievements.length;

  await bot.sendMessage(chatId,
    `👤 *Профиль ${escapeMarkdown(name)}*\n\n` +
    `${level.emoji} *Уровень:* ${level.name}\n` +
    `🏅 *Очки:* ${user.points}\n` +
    `💬 *Сообщений:* ${user.messageCount}\n` +
    `🏆 *Место в рейтинге:* #${rank}\n` +
    `🎖️ *Достижений:* ${achCount} из ${Object.keys(ACHIEVEMENTS).length}\n\n` +
    `${level.next ? `📊 *Прогресс до следующего уровня:*\n${progressBar}\n${user.points} / ${level.next} очков` : progressBar}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/top/, async (msg) => {
  const chatId = msg.chat.id;
  const top = await db.select().from(botUsersTable).orderBy(desc(botUsersTable.points)).limit(10);

  if (top.length === 0) {
    await bot.sendMessage(chatId, "🏆 Рейтинг пока пуст. Будь первым!");
    return;
  }

  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const lines = top.map((u, i) => {
    const lvl = getLevel(u.points);
    const uname = u.firstName ?? u.username ?? "Аноним";
    return `${medals[i]} *${escapeMarkdown(uname)}* — ${u.points} очков ${lvl.emoji}`;
  });

  await bot.sendMessage(chatId,
    `🏆 *Таблица лидеров*\n\n${lines.join("\n")}\n\n💪 Пиши больше — попади в топ!`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/rewards/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getOrCreateUser(msg);

  const lines = Object.entries(ACHIEVEMENTS).map(([key, ach]) => {
    const unlocked = user.achievements.includes(key);
    return `${unlocked ? ach.emoji : "🔒"} *${ach.desc}* — ${unlocked ? "Получено! ✅" : "Заблокировано"}`;
  });

  await bot.sendMessage(chatId,
    `🎖️ *Достижения и награды*\n\n` +
    lines.join("\n") +
    `\n\n💡 Пиши сообщения и зарабатывай очки, чтобы открыть все достижения!`,
    { parse_mode: "Markdown" }
  );
});

// ─── Main message handler ─────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;

  await getOrCreateUser(msg);
  const { user, newAchievements } = await addPoints(msg.from!.id, 10);
  const level = getLevel(user.points);

  const userName = msg.from?.first_name ?? msg.from?.username ?? "друг";
  let reply: string;
  try {
    reply = await getAIResponse(msg.text, userName);
  } catch (err) {
    logger.error({ err }, "Groq API error");
    reply = "😅 Что-то пошло не так с ИИ, попробуй ещё раз!";
  }
  await bot.sendMessage(chatId, reply);

  await bot.sendMessage(chatId, `✨ *+10 очков!* Итого: *${user.points}* | Уровень: ${level.emoji} ${level.name}`, { parse_mode: "Markdown" });

  for (const key of newAchievements) {
    const ach = ACHIEVEMENTS[key];
    await bot.sendMessage(chatId,
      `🎉 *Новое достижение разблокировано!*\n${ach.emoji} *${ach.desc}*`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.on("polling_error", (err) => logger.error({ err }, "Telegram polling error"));
bot.on("error", (err) => logger.error({ err }, "Telegram bot error"));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildProgressBar(current: number, max: number): string {
  const filled = Math.round((current / max) * 10);
  const empty = 10 - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export default bot;
