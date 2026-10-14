import { TEACHERS, EVERYONE } from "./cast.js";
import type { ChatEvent } from "./scenarios.js";

/**
 * Background chatter that a real school WhatsApp group is full of.
 * None of it is work, so all of it should be filtered out by triage.
 */

const GREETINGS = [
  "Good morning everyone 🌞",
  "Good morning sir/ma",
  "Good morning all. Have a blessed day",
  "GM all 🙏🏾",
  "Good morning o",
  "Morning everyone, happy teaching today",
  "Good morning, God bless our day",
];
const GREETING_REPLIES = ["Good morning ma 🙏🏾", "Morning sir", "Same to you", "Good morning 🌞", "Amen 🙏🏾"];
const NEW_WEEK = ["Happy new week everyone! May this week be fruitful 🙏🏾", "Happy new week all. Success in all we do"];
const SUNDAY = ["Happy Sunday family. May God guide us this week 🙏🏾", "Blessed Sunday to everyone"];
const AMEN = ["Amen 🙏🏾", "Amen o", "Amen and amen", "God dey 🙏🏾"];
const BROADCASTS = [
  "*FORWARDED* 📢 Health tip: drink at least 8 glasses of water daily. Please share with your loved ones",
  "*FORWARDED* Good news!!! Government to pay all teachers bonus this month. Share to 10 groups",
  "*FORWARDED* Beware of fake bank SMS. Do not share your BVN with anybody",
  "*FORWARDED* Motivation: A good teacher is like a candle, it consumes itself to light the way for others",
];
const REACTIONS = ["😂😂", "👍🏾", "🙏🏾🙏🏾", "Lol", "😊", "Okay o"];

/** Small, seeded PRNG (mulberry32): the same seed always gives the same chat. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
  };
}

type Random = ReturnType<typeof createRandom>;

const noise = (day: number, time: string, sender: string, text: string, hasMedia = false): ChatEvent => ({
  day, time, sender, text, hasMedia, label: { relevant: false },
});

function timeBetween(random: Random, fromHour: number, toHour: number): string {
  const minutes = random.int(fromHour * 60, toHour * 60 - 1);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function generateNoise(days: number, random: Random): ChatEvent[] {
  const events: ChatEvent[] = [];

  for (let day = 0; day < days; day++) {
    const weekday = day % 7; // 0 = Monday … 6 = Sunday
    const isWeekend = weekday >= 5;

    // Morning greetings and a reply or two.
    const greetings = isWeekend ? random.int(0, 1) : random.int(1, 2);
    for (let i = 0; i < greetings; i++) {
      events.push(noise(day, timeBetween(random, 6, 8), random.pick(EVERYONE), random.pick(GREETINGS)));
      if (random.chance(0.6)) {
        events.push(noise(day, timeBetween(random, 8, 9), random.pick(EVERYONE), random.pick(GREETING_REPLIES)));
      }
    }

    if (weekday === 0) {
      events.push(noise(day, "06:45", random.pick(TEACHERS), random.pick(NEW_WEEK)));
      events.push(noise(day, "07:10", random.pick(EVERYONE), random.pick(AMEN)));
    }

    if (weekday === 6) {
      events.push(noise(day, timeBetween(random, 7, 9), random.pick(TEACHERS), random.pick(SUNDAY)));
      for (let i = random.int(1, 3); i > 0; i--) {
        events.push(noise(day, timeBetween(random, 9, 11), random.pick(EVERYONE), random.pick(AMEN)));
      }
    }

    if (random.chance(0.3)) {
      events.push(noise(day, timeBetween(random, 12, 21), random.pick(TEACHERS), random.pick(BROADCASTS)));
      if (random.chance(0.5)) {
        events.push(noise(day, timeBetween(random, 21, 22), random.pick(EVERYONE), random.pick(REACTIONS)));
      }
    }

    // Stickers and memes: media that is NOT work (unlike the S2 screenshot).
    if (random.chance(0.25)) {
      events.push(noise(day, timeBetween(random, 17, 22), random.pick(TEACHERS), "", true));
    }
  }

  events.push(...specialDays(random));
  return events;
}

function specialDays(random: Random): ChatEvent[] {
  return [
    // Day 10 = 1 October, Nigeria's Independence Day
    noise(10, "07:00", "ngozi", "Happy Independence Day Nigeria 🇳🇬💚 From all of us at Ednovax"),
    noise(10, "07:20", "osaro", "Happy Independence Day 🇳🇬"),
    noise(10, "07:41", "ibrahim", "Happy Independence. God bless Nigeria"),
    noise(10, "08:02", random.pick(TEACHERS), "", true),
    // Day 16: Mrs Grace's birthday
    noise(16, "06:58", "funke", "Happy birthday Mrs Grace! 🎂🎉 More years in good health"),
    noise(16, "07:15", "adaeze", "HBD ma 🎉🎉 God bless your new age"),
    noise(16, "07:22", "ngozi", "Happy birthday ma! 🎂 Cheers to many more"),
    noise(16, "07:40", "chidi", "Happy birthday Mrs Danjuma 🙏🏾"),
    noise(16, "08:10", "efe", "", true),
    noise(16, "11:30", "grace", "Thank you all so much 🙏🏾 God bless you"),
  ];
}
