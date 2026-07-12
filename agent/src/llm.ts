import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileP = promisify(execFile);

/**
 * One Gemini client, two transports:
 *  - Vertex AI (aiplatform.googleapis.com) with OAuth — used when GOOGLE_CLOUD_PROJECT is set.
 *    Token source chain: GOOGLE_ACCESS_TOKEN env → Cloud Run metadata server → local `gcloud`.
 *  - Gemini Developer API (generativelanguage.googleapis.com) with GEMINI_API_KEY.
 */

export const geminiConfigured = () => !!(config.gcpProject || config.geminiApiKey);

let cachedToken: { token: string; expiresAtMs: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) return cachedToken.token;

  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  // Cloud Run / GCE metadata server
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(1000) }
    );
    if (res.ok) {
      const j = (await res.json()) as { access_token: string; expires_in: number };
      cachedToken = { token: j.access_token, expiresAtMs: Date.now() + j.expires_in * 1000 };
      return j.access_token;
    }
  } catch {
    /* not on GCP — fall through to gcloud */
  }

  const { stdout } = await execFileP("gcloud", ["auth", "print-access-token"], { timeout: 15_000 });
  const token = stdout.trim();
  cachedToken = { token, expiresAtMs: Date.now() + 50 * 60_000 };
  return token;
}

export async function generateJson<T>(system: string, user: string, temperature = 0.2): Promise<T | null> {
  if (!geminiConfigured()) return null;

  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { responseMimeType: "application/json", temperature },
  };

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.gcpProject) {
    url = `https://aiplatform.googleapis.com/v1/projects/${config.gcpProject}/locations/${config.gcpLocation}/publishers/google/models/${config.geminiModel}:generateContent`;
    headers.Authorization = `Bearer ${await getAccessToken()}`;
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
    headers["x-goog-api-key"] = config.geminiApiKey;
  }

  // One retry: a transient Vertex 429/500 mid-demo must not silently swap the
  // whole run onto the heuristic fallback.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      const data = (await res.json()) as any;
      if (data.error) throw new Error(`${data.error.status}: ${String(data.error.message).slice(0, 200)}`);
      // Gemini 3.x can return reasoning ("thought") parts alongside the answer.
      // Concatenating those would corrupt the JSON, so keep only answer parts.
      const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => p?.thought !== true && typeof p?.text === "string")
        .map((p) => p.text)
        .join("");
      if (!text.trim()) throw new Error("empty model response");
      return JSON.parse(text) as T;
    } catch (err) {
      console.error(`[gemini] call failed (attempt ${attempt}/2):`, (err as Error).message);
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}
