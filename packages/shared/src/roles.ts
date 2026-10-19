import { z } from "zod";

export const USER_ROLES = ["CUSTOMER", "SELLER", "ADMIN"] as const;

export const userRoleSchema = z.enum(USER_ROLES);

export type UserRole = z.infer<typeof userRoleSchema>;
