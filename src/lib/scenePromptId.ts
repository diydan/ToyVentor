// The id a scene prompt is asked for by (src/lib/scenePrompts.ts): a fingerprint of its text, in a file of its own so the generator (scripts/scene-prompts.ts) can
// compute ids without loading the list it is about to write.

/** FNV-1a (32 bit) of the text's NFC UTF-8 bytes, as 8 lowercase hex digits. Not a secret. The same function as householdTextHash. */
export function promptId(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text.normalize("NFC"))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
