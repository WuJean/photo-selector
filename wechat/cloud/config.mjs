export function configFor(owner) {
  const admin = (process.env.ADMIN_OPENIDS || "").split(",").includes(owner);
  return {
    baseURL:
      process.env.AI_BASE_URL ||
      "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    model: process.env.AI_MODEL || "qwen3.8-flash",
    jsonMode: process.env.AI_JSON_MODE === "true",
    imageEndpoint:
      process.env.IMAGE_ENDPOINT ||
      "https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation",
    imageModel: process.env.IMAGE_MODEL || "wan2.7-image",
    configured: !!process.env.AI_API_KEY,
    workerReady: !!process.env.PHOTO_WORKER_NAME && !!process.env.WORKER_SECRET,
    dailyLimit: Number(process.env.AI_DAILY_LIMIT) || 5000,
    canGenerate: admin && process.env.ENABLE_IMAGE_GENERATION === "true",
  };
}
