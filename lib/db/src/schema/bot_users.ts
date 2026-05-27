import { pgTable, bigint, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botUsersTable = pgTable("bot_users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  username: varchar("username", { length: 255 }),
  firstName: varchar("first_name", { length: 255 }),
  points: integer("points").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  achievements: text("achievements").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotUserSchema = createInsertSchema(botUsersTable).omit({ createdAt: true, updatedAt: true });
export type InsertBotUser = z.infer<typeof insertBotUserSchema>;
export type BotUser = typeof botUsersTable.$inferSelect;
