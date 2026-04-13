/**
 * Forward AI 个性化推荐 Widget
 *
 * 基于用户的观影历史、偏好和评分,通过后端 AI 服务返回个性化电影与剧集推荐。
 * 后端负责意图理解、特征匹配和 TMDB 数据补全,widget 只负责调用和展示。
 */

// TODO: 替换为你自己的推荐服务后端地址
const API_BASE = "https://TODO-your-backend.example.com/v1/recommend";

WidgetMetadata = {
  id: "forward.personalized",
  title: "AI 个性化推荐",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "基于观影历史和偏好的 AI 个性化电影与剧集推荐",
  author: "alexcz-a11y",
  site: "https://github.com/alexcz-a11y/forward-AI-Personalized-recommendations",
  modules: [
    {
      id: "aiRecommend",
      title: "为你推荐",
      functionName: "getPersonalizedRecommendations",
      cacheDuration: 1800,
      params: [
        {
          name: "userId",
          title: "用户 ID",
          type: "userId",
        },
        {
          name: "count",
          title: "推荐数量",
          type: "count",
          value: "10",
          description: "返回的推荐条目数量(默认 10)",
        },
        {
          name: "language",
          title: "语言",
          type: "language",
          value: "zh-CN",
        },
      ],
    },
  ],
};

async function getPersonalizedRecommendations(params = {}) {
  const userId = params.userId || "";
  const count = parseInt(params.count || "10", 10);
  const language = params.language || "zh-CN";

  if (!userId) {
    throw new Error("缺少用户 ID");
  }

  try {
    const response = await Widget.http.post(
      API_BASE,
      { userId, count, language },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = response.data;

    if (!data || !data.success) {
      throw new Error((data && data.message) || "推荐服务返回异常");
    }

    const items = data.data || [];

    return items.map((item) => ({
      id: String(item.tmdbId || item.id),
      type: "tmdb",
      title: item.title,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      releaseDate: item.releaseDate,
      mediaType: item.mediaType || "movie",
      rating: item.rating,
      genreTitle: Array.isArray(item.genres)
        ? item.genres.join(", ")
        : item.genreTitle,
      description: item.description || item.overview,
    }));
  } catch (error) {
    console.error("[AI推荐] 请求失败:", error.message || error);
    throw new Error("AI 推荐服务暂时不可用,请稍后再试");
  }
}
