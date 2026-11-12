import { createHash, randomBytes, randomUUID } from "node:crypto";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const uuid = (): string => randomUUID();

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short anchor id for Obsidian block references, e.g. `oc-k3f9x2ab`. */
export function anchorId(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `oc-${out}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
