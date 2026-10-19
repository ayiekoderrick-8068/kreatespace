import { z } from "zod";
import { normalizeKenyanPhone, normalizePhoneNumber } from "./phone.js";

// Kept apart from the plain phone functions in phone.ts, so pages that only format a number (the
// "Enquire on WhatsApp" link) do not pull the validation library into their download.

/** Validates a Kenyan phone number and transforms it to E.164. */
export const kenyanPhoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeKenyanPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a valid Kenyan mobile number" });
    return z.NEVER;
  }
  return normalized;
});

/** Validates a WhatsApp number (Kenyan or international) and transforms it to E.164. */
export const whatsappNumberSchema = z.string().transform((value, ctx) => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a valid WhatsApp number, for example 0712 345 678 or +44 7700 900123",
    });
    return z.NEVER;
  }
  return normalized;
});
