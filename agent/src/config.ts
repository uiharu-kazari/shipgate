export const config = {
  port: Number(process.env.PORT ?? 8080),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  // Vertex AI mode (the "Google Cloud way"): set GOOGLE_CLOUD_PROJECT to route all
  // Gemini calls through aiplatform.googleapis.com with OAuth instead of an API key.
  gcpProject: process.env.GOOGLE_CLOUD_PROJECT ?? "",
  gcpLocation: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
  esUrl: process.env.ELASTICSEARCH_URL ?? "",
  esApiKey: process.env.ELASTICSEARCH_API_KEY ?? "",
  esIndex: process.env.ELASTICSEARCH_INDEX ?? "shipgate-evidence",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  // If set, /analyze and /propose-patch require this value in the x-shipgate-token header.
  authToken: process.env.SHIPGATE_TOKEN ?? "",
  // If set (comma-separated hostnames), targetUrl must resolve to one of these hosts.
  allowedTargetHosts: (process.env.SHIPGATE_ALLOWED_TARGETS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
};
