/** Matches a Kenyan mobile number in E.164 form: +254 followed by 7xx or 1xx and 6 more digits. */
const KENYAN_E164 = /^\+254[17]\d{8}$/;

/**
 * Normalises a Kenyan mobile number to E.164 (`+2547XXXXXXXX`).
 * Accepts `0712 345 678`, `712345678`, `254712345678` and `+254 712-345-678`.
 * Returns `null` when the input is not a valid Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let national: string;
  if (cleaned.startsWith("+254")) national = cleaned.slice(4);
  else if (cleaned.startsWith("254")) national = cleaned.slice(3);
  else if (cleaned.startsWith("0")) national = cleaned.slice(1);
  else if (cleaned.startsWith("+")) return null;
  else national = cleaned;

  const e164 = `+254${national}`;
  return KENYAN_E164.test(e164) ? e164 : null;
}

/** Digits-only form required by `https://wa.me/<number>` links (no `+`). */
export function toWhatsAppNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

/**
 * Normalises a WhatsApp number to E.164. Kenyan numbers may be written locally (`0712 345 678`)
 * or with a country code; any other country must be written internationally, either with a
 * leading `+` or `00` (`+44 7700 900123`). Returns `null` when the number is not valid.
 */
export function normalizePhoneNumber(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return null;

  const international = cleaned.startsWith("00")
    ? `+${cleaned.slice(2)}`
    : cleaned.startsWith("+")
      ? cleaned
      : null;

  // Anything that could be a Kenyan number is held to Kenya's rules.
  if (!international || international.startsWith("+254")) return normalizeKenyanPhone(cleaned);

  // E.164: a country code (never starting with 0) and up to 15 digits in total.
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}
