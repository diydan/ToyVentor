// Bounded JSON body reading for API POST routes. A content-length header
// is advisory (chunked requests omit it), so the cap is enforced on the
// bytes actually read: oversized bodies are cut off mid-stream instead of
// buffered into Worker memory.
export type CappedJson =
  | { ok: true; value: unknown }
  | { ok: false; over: boolean };

export async function readCappedJson(request: Request, maxBytes: number): Promise<CappedJson> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, over: true };
  if (!request.body) {
    try {
      return { ok: true, value: await request.json() };
    } catch {
      return { ok: false, over: false };
    }
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, over: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(merged)) };
  } catch {
    return { ok: false, over: false };
  }
}
