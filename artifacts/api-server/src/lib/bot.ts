import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { botUsersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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

// ─── Smart predefined responses ───────────────────────────────────────────────
function getSmartResponse(text: string): string {
  const t = text.toLowerCase();

  if (/привет|хай|hello|hi|здравствуй/.test(t))
    return "👋 Привет! Рад тебя видеть! Чем могу помочь?";
  if (/как дела|как ты|как жизнь/.test(t))
    return "😊 Всё отлично, спасибо что спрашиваешь! А у тебя как дела?";
  if (/что умеешь|что ты умеешь|что можешь/.test(t))
    return "🤖 Я умею отвечать на вопросы, вести статистику твоих сообщений и начислять очки! Используй /help чтобы узнать больше.";
  if (/кто ты|кто создал|кто тебя|чей бот/.test(t))
    return "🤖 Я — NexusBot_777! Умный бот с системой наград и уровней. Пиши мне почаще — зарабатывай очки!";
  if (/погода/.test(t))
    return "☁️ К сожалению, я не умею проверять погоду, но могу подсказать: погляди в окно! 😄";
  if (/время|который час|сколько время/.test(t)) {
    const now = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
    return `🕐 Московское время: *${now}*`;
  }
  if (/дата|какое число|какой день/.test(t)) {
    const now = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
    return `📅 Сегодня: *${now}*`;
  }
  if (/шутк|расскажи анекдот|анекдот/.test(t)) {
    const jokes = [
      "😂 Программист заходит в лифт. Его спрашивают: «На какой этаж?» Он отвечает: «Мне на 4-й». Лифт едет на 1-й. Оказывается, ноль-индексация!",
      "😄 Почему программисты путают Хэллоуин и Рождество? Потому что Oct 31 = Dec 25!",
      "🤣 Сколько программистов нужно, чтобы поменять лампочку? Ни одного — это проблема железа!"
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }
  if (/факт|интересно|расскажи что-нибудь/.test(t)) {
    const facts = [
      "🧠 Мозг человека генерирует около 70 000 мыслей в день!",
      "🌍 На Земле больше деревьев, чем звёзд в Млечном Пути.",
      "🐙 У осьминога три сердца и голубая кровь.",
      "⚡ Молния горячее поверхности Солнца в 5 раз.",
      "🍯 Мёд никогда не портится — в египетских гробницах нашли мёд возрастом 3000 лет!"
    ];
    return facts[Math.floor(Math.random() * facts.length)];
  }
  if (/спасибо|благодарю|thanks/.test(t))
    return "😊 Пожалуйста! Всегда рад помочь! Продолжай писать — зарабатывай очки!";
  if (/пока|до свидания|bye|чао/.test(t))
    return "👋 До свидания! Возвращайся скорее — тебя ждут новые очки! 🎯";
  if (/люблю тебя|ты лучший|ты крутой/.test(t))
    return "❤️ Ты тоже лучший! Продолжай в том же духе! 🚀";
  if (/помоги|помощь|не понимаю/.test(t))
    return "🤝 Конечно помогу! Уточни свой вопрос, и я постараюсь ответить. Или используй /help для списка команд.";
  if (/очки|баллы|сколько очков/.test(t))
    return "🏅 Проверь свои очки командой /profile!";
  if (/уровень|ранг|статус/.test(t))
    return "🎖️ Посмотри свой уровень командой /profile!";
  if (/топ|лидеры|рейтинг/.test(t))
    return "🏆 Смотри таблицу лидеров командой /top!";

  const generic = [
    "🤔 Интересный вопрос! Я ещё учусь, но стараюсь быть полезным.",
    "💡 Хм, дай подумаю... Пока не знаю ответа, но ты заработал очки за вопрос!",
    "😊 Спасибо за сообщение! Каждое слово приближает тебя к новому уровню.",
    "🚀 Отличное сообщение! Продолжай — очки копятся!",
    "🎯 Понял тебя! Не забудь проверить /profile — вдруг уже новый уровень?",
  ];
  return generic[Math.floor(Math.random() * generic.length)];
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

  const reply = getSmartResponse(msg.text);
  await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });

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
