import type { Request } from "express";

// cookie-parser types `req.cookies` as `any`, so cookie reads go through here and
// come back as a checked string.
export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === "string" ? value : undefined;
}
