import { createHash } from "node:crypto";

/** Short, stable sha256-based id. The salt makes hashed phone numbers hard to reverse. */
export function stableId(prefix: string, parts: string[], salt = ""): string {
  const digest = createHash("sha256").update(salt).update(parts.join("\u0000")).digest("hex");
  return `${prefix}_${digest.slice(0, 16)}`;
}

const PHONE_PATTERN = /^\+?[\d\s\-() ]{7,}$/;

export function looksLikePhoneNumber(label: string): boolean {
  return PHONE_PATTERN.test(label.trim()) && /\d{7,}/.test(digitsOnly(label));
}

/** "+234 803 555 0142" → "+234 ••• 0142": enough for a human to tell people apart, not enough to call them. */
export function maskPhoneNumber(label: string): string {
  const digits = digitsOnly(label);
  const country = label.trim().startsWith("+") ? `+${digits.slice(0, 3)} ` : "";
  return `${country}••• ${digits.slice(-4)}`;
}

/**
 * A person's id comes from how WhatsApp labels them: a saved-contact name or a phone number.
 * Phone numbers are normalised to digits so "+234 803…" and "+2348…" give the same person.
 */
export function personId(senderLabel: string, salt: string): string {
  const key = looksLikePhoneNumber(senderLabel)
    ? `phone:${digitsOnly(senderLabel)}`
    : `name:${senderLabel.trim().toLowerCase()}`;
  return stableId("per", [key], salt);
}

function digitsOnly(text: string): string {
  return text.replace(/\D/g, "");
}
