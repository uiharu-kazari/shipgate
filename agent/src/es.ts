import { Client } from "@elastic/elasticsearch";
import { config } from "./config.js";
import type { EvidenceDoc } from "./types.js";

let client: Client | null = null;

function es(): Client | null {
  if (!config.esUrl || !config.esApiKey) return null;
  if (!client) {
    client = new Client({ node: config.esUrl, auth: { apiKey: config.esApiKey } });
  }
  return client;
}

export async function indexEvidence(doc: EvidenceDoc): Promise<string | null> {
  const c = es();
  if (!c) {
    console.warn("[es] not configured, skipping indexing");
    return null;
  }
  const res = await c.index({ index: config.esIndex, document: doc });
  return res._id;
}

export async function recentEvidence(size = 20): Promise<EvidenceDoc[]> {
  const c = es();
  if (!c) return [];
  try {
    const res = await c.search<EvidenceDoc>({
      index: config.esIndex,
      size,
      sort: [{ "@timestamp": "desc" }],
      query: { match_all: {} },
    });
    return res.hits.hits.map((h) => ({ ...(h._source as EvidenceDoc), _id: h._id } as EvidenceDoc & { _id?: string }));
  } catch (err) {
    console.error("[es] search failed:", (err as Error).message);
    return [];
  }
}
