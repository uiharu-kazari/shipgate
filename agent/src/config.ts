export const config = {
  port: Number(process.env.PORT ?? 8080),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  esUrl: process.env.ELASTICSEARCH_URL ?? "",
  esApiKey: process.env.ELASTICSEARCH_API_KEY ?? "",
  esIndex: process.env.ELASTICSEARCH_INDEX ?? "shipgate-evidence",
  githubToken: process.env.GITHUB_TOKEN ?? "",
};
