import { nagFlavor, todayView, type AiDeps, type DB, type Notifier, type ReminderPayload, type SentRef } from "@omnicore/core";
import type { Bot } from "grammy";
import { esc, formatReminder, formatToday, reminderKeyboard } from "./format.js";

/** Sends nag reminders to every allow-listed user's private chat. */
export class TelegramNotifier implements Notifier {
  readonly channel = "telegram";
  constructor(
    private bot: Bot,
    private chatIds: number[],
    /** Set when AI_NAG_VARIATION is on: adds a varied one-line nudge from the local model. */
    private flavor?: AiDeps,
  ) {}

  async sendReminder(p: ReminderPayload): Promise<SentRef[]> {
    const line = this.flavor ? await nagFlavor(this.flavor, p.task, p.state, p.reminderCount) : null;
    const text = `${formatReminder(p)}${line ? `\n\n<i>${esc(line)}</i>` : ""}`;
    const refs: SentRef[] = [];
    for (const chatId of this.chatIds) {
      const m = await this.bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: reminderKeyboard(p.task.id),
      });
      refs.push({ chatId: String(chatId), messageId: m.message_id });
    }
    return refs;
  }

  /** Morning message: the standup (when there is one) above the interactive Today list. */
  async sendDigest(db: DB, timeZone: string, standup?: string): Promise<void> {
    const v = todayView(db, timeZone);
    if (!v.overdue.length && !v.dueToday.length && !v.pinned.length && !standup) return;
    const { text, keyboard } = formatToday(v);
    const intro = standup ? `<i>${esc(standup)}</i>\n\n` : "";
    for (const chatId of this.chatIds) {
      await this.bot.api.sendMessage(chatId, `🌅 Good morning!\n\n${intro}${text}`, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  /** Plain HTML message to every allowed chat (already-escaped HTML). */
  async sendText(html: string): Promise<void> {
    for (const chatId of this.chatIds) await this.bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
  }

  async sendRetro(text: string): Promise<void> {
    for (const chatId of this.chatIds) {
      await this.bot.api.sendMessage(chatId, `🌙 <b>Today in review</b>\n\n${esc(text)}`, { parse_mode: "HTML" });
    }
  }
}
