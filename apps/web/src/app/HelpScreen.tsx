import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useBack, usePlatform, useTo } from "./platform";
import { Button, Card, hint, PageTitle, Sheet } from "./ui";
import { howRemindersWork, STATUS } from "./words";

const STEPS: [string, string, string][] = [
  ["✍️", "Add what needs doing", "Tap New task (or send “+ Buy cables tomorrow 18:00” to the Telegram bot). Pick a day and time if you want reminders. Several at once: type “1. … 2. … 3. …” or one per line, and each becomes its own task."],
  ["🔔", "Get reminded until it's done", "When the time comes I message you on Telegram, and keep reminding you until you act. One tap on a button answers."],
  ["🌗", "Say how it's going", "Partly done, or an update like “waiting for parts”, and I check back later instead of nagging. Later moves the reminder."],
  ["🌙", "Nothing gets lost", "Anything not done by midnight moves to tomorrow and shows how many times it moved."],
  ["📁", "Group and write", "Projects group related tasks. Notes are plain Markdown files: Obsidian can open the same folder."],
];

const WORDS: [string, string][] = [
  ...Object.values(STATUS).map((s) => [s.word, s.help] as [string, string]),
  ["Partly done", "You've made progress (25 / 50 / 75%). Reminders come less often."],
  ["Update", "A short note on a task about what's happening. Its status becomes Waiting and I check back later."],
  ["Later", "Pushes the next reminder: in 1 hour, tomorrow morning, or quiet for the rest of today."],
  ["Pin", "Keeps a task on Today even without a date."],
  ["Needs you now", "Tasks whose time has come, plus ones partly done or waiting."],
  ["Steps", "Smaller checkboxes inside a task. Ticking them fills its progress."],
  ["Vault", "The folder of Markdown notes the app keeps your tasks in. Obsidian can open it too."],
];

export function HelpScreen() {
  const navigate = useNavigate();
  const to = useTo();
  const { tg } = usePlatform();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
  useBack(() => navigate(to("/more")));
  const v = (k: string) => settings.data?.groups.flatMap((g) => g.items).find((i) => i.key === k)?.value ?? "";
  return (
    <div className="flex flex-col gap-6 pb-24 pt-2">
      <PageTitle icon={<HelpCircle size={26} style={{ color: "var(--tg-accent)" }} aria-hidden />} title="Help & guide" sub="How it works, in five steps" />
      <div className="flex flex-col gap-2 px-4">
        <Card>
          {STEPS.map(([icon, title, text], i) => (
            <div key={title} className="flex gap-3.5 px-4 py-3.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[18px]" style={{ background: "var(--tg-accent-soft)" }} aria-hidden>{icon}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15.5px] font-semibold">{i + 1}. {title}</span>
                <span className="text-[14px] leading-snug" style={hint}>{text}</span>
              </span>
            </div>
          ))}
        </Card>
      </div>

      <section className="flex flex-col gap-2 px-4" aria-label="How reminders work">
        <h2 className="m-0 px-1.5 font-display text-[15px] font-bold" style={{ color: "var(--tg-fg-2)" }}>How reminders work</h2>
        <Card>
          <ol className="m-0 flex flex-col gap-2 py-3.5 pl-9 pr-4 text-[14.5px] leading-snug">
            {(settings.data ? howRemindersWork({ overdue: v("everyOverdue"), partial: v("everyPartial"), update: v("everyUpdate"), quiet: v("quietHours"), defaultTime: v("defaultTime") }) : []).map((l) => <li key={l}>{l}</li>)}
          </ol>
          <button type="button" onClick={() => navigate(to("/settings"))} className="w-full px-4 py-3 text-left text-[14.5px] font-semibold" style={{ color: "var(--tg-link)" }}>Change these in Settings ›</button>
        </Card>
      </section>

      <section className="flex flex-col gap-2 px-4" aria-label="What the words mean">
        <h2 className="m-0 px-1.5 font-display text-[15px] font-bold" style={{ color: "var(--tg-fg-2)" }}>What the words mean</h2>
        <Card>
          {WORDS.map(([w, d]) => (
            <div key={w} className="flex flex-col px-4 py-3">
              <span className="text-[15px] font-semibold">{w}</span>
              <span className="text-[14px] leading-snug" style={hint}>{d}</span>
            </div>
          ))}
        </Card>
      </section>

      <section className="flex flex-col gap-2 px-4" aria-label="Where things are">
        <h2 className="m-0 px-1.5 font-display text-[15px] font-bold" style={{ color: "var(--tg-fg-2)" }}>Where things are</h2>
        <Card>
          {[
            ["Today", "What's due now and later today."],
            ["Upcoming", "The next two weeks, and tasks without a date."],
            ["Projects", "Groups of tasks. Open one to add to it or delete it."],
            [tg ? "More → Notes" : "Notes", "Your Markdown notes, including today's note with everything you sent the bot."],
            [tg ? "More → Settings" : "Settings", "Reminders, daily summaries, time zone, look, pause, backups, updates."],
            ["Telegram", "Send “+ task” to add, tap the buttons on reminders, or ☰ Menu for everything else."],
          ].map(([a, b]) => (
            <div key={a} className="flex flex-col px-4 py-3">
              <span className="text-[15px] font-semibold">{a}</span>
              <span className="text-[14px] leading-snug" style={hint}>{b}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

/** First visit: three cards, then out of the way (remembered on this device). */
export function Welcome() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem("oc-welcomed");
    } catch {
      return false;
    }
  });
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const to = useTo();
  if (!open) return null;
  const close = (help = false) => {
    try {
      localStorage.setItem("oc-welcomed", "1");
    } catch {
      /* fine */
    }
    setOpen(false);
    if (help) navigate(to("/help"));
  };
  const cards = STEPS.slice(0, 3);
  const [icon, title, text] = cards[i]!;
  return (
    <Sheet title="Welcome to OmniCore" onClose={() => close()}>
      <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
        <span className="text-[40px]" aria-hidden>{icon}</span>
        <span className="font-display text-[19px] font-extrabold">{title}</span>
        <span className="text-[15px] leading-snug" style={hint}>{text}</span>
      </div>
      <div className="flex justify-center gap-1.5" aria-label={`Step ${i + 1} of ${cards.length}`}>
        {cards.map((_, k) => <span key={k} className="h-1.5 w-6 rounded-full" style={{ background: k === i ? "var(--tg-accent)" : "var(--tg-chip)" }} />)}
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={() => close(true)} tone="ghost" className="flex-1">Full guide</Button>
        <Button tone="accent" className="flex-1" onClick={() => (i < cards.length - 1 ? setI(i + 1) : close())}>{i < cards.length - 1 ? "Next" : "Start"}</Button>
      </div>
    </Sheet>
  );
}
