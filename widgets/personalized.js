/**
 * Forward AI 个性化推荐 Widget v2
 *
 * 完全 client-side 的个性化推荐:
 *   Trakt (观影资料) → TMDB (候选池) → OpenAI (LLM 排序) → VideoItem[]
 *
 * 用户需在 widget 全局设置里填入 4 把 key:
 *   traktClientId / traktUsername / tmdbApiKey / openaiApiKey
 * 运行时仅使用 Widget.http / Widget.storage.
 */

WidgetMetadata = {
  id: "forward.personalized",
  title: "AI 个性化推荐",
  version: "2.1.1",
  requiredVersion: "0.0.2",
  description: "基于 Trakt 观影历史 + OpenAI 的个性化电影/剧集推荐",
  author: "alexcz-a11y",
  site: "https://github.com/alexcz-a11y/forward-AI-Personalized-recommendations",
  globalParams: [
    {
      name: "traktClientId",
      title: "Trakt Client ID",
      type: "input",
      description: "在 trakt.tv/oauth/applications 创建应用后获得",
    },
    {
      name: "traktUsername",
      title: "Trakt 用户名",
      type: "input",
      description: "公开个人主页的用户名(私有账号无法使用)",
    },
    {
      name: "tmdbApiKey",
      title: "TMDB API Key",
      type: "input",
      description: "themoviedb.org 的 v3 API key",
    },
    {
      name: "openaiApiKey",
      title: "OpenAI API Key",
      type: "input",
      description: "sk- 开头,明文存储,请勿共享",
    },
    {
      name: "openaiBaseUrl",
      title: "OpenAI 兼容端点",
      type: "input",
      value: "https://api.openai.com/v1",
      description:
        "OpenAI 兼容网关 base URL (末尾到 /v1 即可, 代码会自动追加 /responses 或 /chat/completions). 第三方网关请把下方「端点类型」切到 chat",
    },
    {
      name: "openaiEndpoint",
      title: "端点类型",
      type: "enumeration",
      value: "responses",
      description:
        "OpenAI 官方保持 responses; OpenRouter / DeepSeek / LiteLLM 等第三方兼容网关几乎只支持 chat",
      enumOptions: [
        { title: "Responses API (/v1/responses)", value: "responses" },
        { title: "Chat Completions (/v1/chat/completions)", value: "chat" },
      ],
    },
    {
      name: "openaiModel",
      title: "OpenAI 模型",
      type: "enumeration",
      value: "gpt-5.4-mini",
      enumOptions: [
        { title: "GPT-5.4 (推理, 旗舰)", value: "gpt-5.4" },
        { title: "GPT-5.4 mini (推荐)", value: "gpt-5.4-mini" },
        { title: "GPT-5.4 nano (最快)", value: "gpt-5.4-nano" },
        { title: "GPT-5.4 pro (最强推理)", value: "gpt-5.4-pro" },
        { title: "GPT-5", value: "gpt-5" },
        { title: "GPT-5 mini", value: "gpt-5-mini" },
        { title: "GPT-4.1 mini", value: "gpt-4.1-mini" },
        { title: "GPT-4o mini", value: "gpt-4o-mini" },
        { title: "GPT-4o", value: "gpt-4o" },
        { title: "自定义 (使用下方 ID)", value: "custom" },
      ],
    },
    {
      name: "customOpenaiModel",
      title: "自定义模型 ID",
      type: "input",
      description:
        "仅当上方选择「自定义」时生效. 例如 anthropic/claude-sonnet-4.5 / deepseek-chat / qwen/qwen3-max",
      belongTo: { paramName: "openaiModel", value: ["custom"] },
    },
    {
      name: "reasoningEffort",
      title: "推理程度",
      type: "enumeration",
      value: "default",
      description:
        "仅 GPT-5 / GPT-5.4 等推理模型有效, 非推理模型请保持「默认」. 错误会自动重试并剥掉此字段",
      enumOptions: [
        { title: "默认 (不指定)", value: "default" },
        { title: "无 none", value: "none" },
        { title: "最小 minimal (仅 GPT-5)", value: "minimal" },
        { title: "低 low", value: "low" },
        { title: "中 medium", value: "medium" },
        { title: "高 high", value: "high" },
        { title: "超高 xhigh (GPT-5.2+)", value: "xhigh" },
      ],
    },
  ],
  modules: [
    {
      id: "aiRecommend",
      title: "为你推荐",
      functionName: "getRecommendations",
      cacheDuration: 1800,
      params: [
        {
          name: "mediaType",
          title: "类型",
          type: "enumeration",
          value: "mixed",
          enumOptions: [
            { title: "混合", value: "mixed" },
            { title: "电影", value: "movies" },
            { title: "电视剧", value: "shows" },
          ],
        },
        { name: "count", title: "推荐数量", type: "count", value: "20" },
        { name: "language", title: "语言", type: "language", value: "zh-CN" },
      ],
    },
  ],
};

// 硬编码 TMDB genre 表,避免每次跑 /genre/*/list
const GENRE_TABLES = {
  movie: {
    "zh-CN": {
      28: "动作", 12: "冒险", 16: "动画", 35: "喜剧", 80: "犯罪",
      99: "纪录片", 18: "剧情", 10751: "家庭", 14: "奇幻", 36: "历史",
      27: "恐怖", 10402: "音乐", 9648: "悬疑", 10749: "爱情", 878: "科幻",
      10770: "电视电影", 53: "惊悚", 10752: "战争", 37: "西部",
    },
    "en-US": {
      28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
      80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
      14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
      9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
      53: "Thriller", 10752: "War", 37: "Western",
    },
  },
  tv: {
    "zh-CN": {
      10759: "动作冒险", 16: "动画", 35: "喜剧", 80: "犯罪", 99: "纪录片",
      18: "剧情", 10751: "家庭", 10762: "儿童", 9648: "悬疑", 10763: "新闻",
      10764: "真人秀", 10765: "科幻奇幻", 10766: "肥皂剧", 10767: "脱口秀",
      10768: "战争政治", 37: "西部",
    },
    "en-US": {
      10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
      99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
      9648: "Mystery", 10763: "News", 10764: "Reality",
      10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
      10768: "War & Politics", 37: "Western",
    },
  },
};

// Trakt genre slug → TMDB genre id (for both movies and TV)
const TRAKT_TO_TMDB_GENRE = {
  movie: {
    action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
    documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
    horror: 27, music: 10402, musical: 10402, mystery: 9648, romance: 10749,
    "science-fiction": 878, "sci-fi": 878, thriller: 53, "tv-movie": 10770,
    war: 10752, western: 37, "super-hero": 28, suspense: 53,
  },
  tv: {
    action: 10759, adventure: 10759, "action-adventure": 10759, animation: 16,
    anime: 16, comedy: 35, crime: 80, documentary: 99, drama: 18,
    family: 10751, kids: 10762, mystery: 9648, news: 10763, reality: 10764,
    "science-fiction": 10765, "sci-fi": 10765, fantasy: 10765,
    "sci-fi-fantasy": 10765, soap: 10766, "talk-show": 10767,
    war: 10768, politics: 10768, "war-politics": 10768, western: 37,
  },
};

function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

async function withCache(key, ttlSec, producer) {
  try {
    const cached = Widget.storage.get(key);
    if (cached && cached.expiresAt && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  } catch (e) {
    // storage miss / corruption — treat as cache miss
  }
  const data = await producer();
  try {
    Widget.storage.set(key, { data, expiresAt: Date.now() + ttlSec * 1000 });
  } catch (e) {
    console.error("[AI推荐] 缓存写入失败:", (e && e.message) || e);
  }
  return data;
}

async function chunkedParallel(items, chunkSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(fn));
    out.push(...results);
  }
  return out;
}

function normalizeMediaType(mt) {
  if (mt === "movies" || mt === "movie") return "movie";
  if (mt === "shows" || mt === "show" || mt === "tv") return "tv";
  return mt;
}

function resolveOpenAIConfig(params) {
  let baseUrl = (params.openaiBaseUrl || "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, "");
  // Defensive: 第三方网关用户常只填 https://xxx.com (漏 /v1), 自动补上避免 404
  if (!/\/v\d+$/.test(baseUrl)) baseUrl += "/v1";
  const endpoint = params.openaiEndpoint === "chat" ? "chat" : "responses";
  let model = params.openaiModel || "gpt-5.4-mini";
  if (model === "custom") {
    model = (params.customOpenaiModel || "").trim();
    if (!model) throw new Error("选择了自定义模型但未填写模型 ID");
  }
  const effort = params.reasoningEffort || "default";
  return { baseUrl, endpoint, model, reasoningEffort: effort };
}

function mapGenreIdsToNames(ids, mediaType, language) {
  if (!Array.isArray(ids) || ids.length === 0) return "";
  const lang = language && language.startsWith("zh") ? "zh-CN" : "en-US";
  const table = (GENRE_TABLES[mediaType] || GENRE_TABLES.movie)[lang] || {};
  return ids.map((id) => table[id]).filter(Boolean).join(" · ");
}

function pickTopTmdbGenreIds(genreCounts, mediaType) {
  const table = TRAKT_TO_TMDB_GENRE[mediaType] || TRAKT_TO_TMDB_GENRE.movie;
  const sorted = Object.entries(genreCounts || {}).sort((a, b) => b[1] - a[1]);
  const result = [];
  const seen = new Set();
  for (const [slug] of sorted) {
    const normalized = String(slug).toLowerCase().replace(/\s+/g, "-");
    const id = table[normalized];
    if (id && !seen.has(id)) {
      result.push(id);
      seen.add(id);
      if (result.length >= 2) break;
    }
  }
  return result;
}

function mapHttpError(err, label) {
  const status =
    err && (err.status || (err.response && err.response.status));
  // Trakt 文档: 私有账号无 OAuth 好友关系也返 401,
  // 不止是 Client ID 错误 (apiary docs introduction/users 章节)
  if (status === 401) {
    if (label === "Trakt") {
      return new Error(
        "Trakt 认证失败 — 检查 Client ID, 或确认该用户名存在且为公开账号"
      );
    }
    return new Error(`${label} 认证失败, 请检查密钥`);
  }
  if (status === 403) return new Error(`${label} 权限不足 (403)`);
  if (status === 404) return new Error(`${label} 资源不存在 (404)`);
  if (status === 429) return new Error(`${label} 请求过于频繁, 请稍后再试`);
  if (status) return new Error(`${label} 返回 ${status}`);
  return new Error(`${label} 请求失败: ${(err && err.message) || err}`);
}

async function fetchTraktProfile(clientId, username, mediaType) {
  const cacheKey = `personalized:trakt:v1:${username}:${mediaType}`;
  return withCache(cacheKey, 6 * 3600, async () => {
    const types =
      mediaType === "mixed" ? ["movies", "shows"] : [mediaType];
    const headers = {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
    };

    const topRated = [];
    const watchedTmdbIds = [];
    const genreCounts = {};
    const recentTitles = [];

    for (const type of types) {
      const mt = type === "movies" ? "movie" : "tv";
      const base = `https://api.trakt.tv/users/${encodeURIComponent(username)}`;

      let ratingsRes, watchedRes, historyRes;
      try {
        // watched: 只用 ids.tmdb, minimal info 已包含 ids, 不需 extended=full
        // (重度用户省数 MB 带宽; 参见 Trakt apiary "Extended Info" 章节)
        [ratingsRes, watchedRes, historyRes] = await Promise.all([
          Widget.http.get(`${base}/ratings/${type}?limit=50&extended=full`, { headers }),
          Widget.http.get(`${base}/watched/${type}`, { headers }),
          Widget.http.get(`${base}/history/${type}?limit=40`, { headers }),
        ]);
      } catch (e) {
        throw mapHttpError(e, "Trakt");
      }

      const ratings = (ratingsRes && ratingsRes.data) || [];
      for (const r of ratings) {
        const item = r.movie || r.show;
        if (!item || !item.ids || item.ids.tmdb == null) continue;
        if ((r.rating || 0) >= 7) {
          topRated.push({
            tmdbId: item.ids.tmdb,
            mediaType: mt,
            title: item.title,
            year: item.year,
            genres: Array.isArray(item.genres) ? item.genres : [],
            rating: r.rating,
          });
        }
        for (const g of item.genres || []) {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        }
      }

      const watched = (watchedRes && watchedRes.data) || [];
      for (const w of watched) {
        const item = w.movie || w.show;
        if (item && item.ids && item.ids.tmdb != null) {
          watchedTmdbIds.push(`${mt}.${item.ids.tmdb}`);
        }
      }

      const history = (historyRes && historyRes.data) || [];
      for (const h of history) {
        const item = h.movie || h.show;
        if (item && item.title) recentTitles.push(item.title);
      }
    }

    topRated.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return {
      topRated: topRated.slice(0, 30),
      watchedTmdbIds,
      genreCounts,
      recentTitles: recentTitles.slice(0, 20),
    };
  });
}

async function fetchTMDBCandidates(apiKey, profile, mediaType, language) {
  const seedSig = profile.topRated
    .map((r) => `${r.mediaType}.${r.tmdbId}`)
    .join(",");
  const cacheKey = `personalized:tmdb:v1:${djb2Hash(
    seedSig + ":" + mediaType + ":" + language
  )}`;

  return withCache(cacheKey, 6 * 3600, async () => {
    const TMDB = "https://api.themoviedb.org/3";
    const types =
      mediaType === "mixed"
        ? ["movie", "tv"]
        : [mediaType === "movies" ? "movie" : "tv"];
    const watchedSet = new Set(profile.watchedTmdbIds || []);
    const raw = [];

    for (const type of types) {
      const seeds = profile.topRated
        .filter((r) => r.mediaType === type)
        .slice(0, 5);

      if (seeds.length > 0) {
        const lists = await chunkedParallel(seeds, 5, async (seed) => {
          try {
            const res = await Widget.http.get(
              `${TMDB}/${type}/${seed.tmdbId}/recommendations`,
              { params: { api_key: apiKey, language, page: 1 } }
            );
            return (res && res.data && res.data.results) || [];
          } catch (e) {
            console.error(
              `[AI推荐] TMDB ${type} recommendations ${seed.tmdbId} 失败:`,
              (e && e.message) || e
            );
            return [];
          }
        });
        for (const list of lists) {
          for (const item of list) raw.push({ ...item, _mt: type });
        }
      }

      const topGenreIds = pickTopTmdbGenreIds(profile.genreCounts, type);
      if (topGenreIds.length > 0) {
        try {
          const res = await Widget.http.get(`${TMDB}/discover/${type}`, {
            params: {
              api_key: apiKey,
              language,
              with_genres: topGenreIds.join(","),
              sort_by: "popularity.desc",
              "vote_count.gte": 200,
              page: 1,
            },
          });
          const results = (res && res.data && res.data.results) || [];
          for (const item of results) raw.push({ ...item, _mt: type });
        } catch (e) {
          console.error(
            `[AI推荐] TMDB discover ${type} 失败:`,
            (e && e.message) || e
          );
        }
      }
    }

    const byKey = {};
    for (const c of raw) {
      const key = `${c._mt}.${c.id}`;
      if (watchedSet.has(key)) continue;
      if (!byKey[key]) byKey[key] = c;
    }
    const deduped = Object.values(byKey);
    deduped.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const top60 = deduped.slice(0, 60);

    const candidateById = {};
    for (const c of top60) candidateById[`${c._mt}.${c.id}`] = c;
    return { candidates: top60, candidateById };
  });
}

function buildResponsesPayload(cfg, systemPrompt, userContent) {
  const p = {
    model: cfg.model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    text: { format: { type: "json_object" } },
  };
  if (cfg.reasoningEffort && cfg.reasoningEffort !== "default") {
    p.reasoning = { effort: cfg.reasoningEffort };
  }
  return p;
}

function buildChatPayload(cfg, systemPrompt, userContent) {
  const p = {
    model: cfg.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  };
  if (cfg.reasoningEffort && cfg.reasoningEffort !== "default") {
    p.reasoning_effort = cfg.reasoningEffort;
  }
  return p;
}

function extractLLMText(data, endpoint) {
  if (!data) return "";
  if (endpoint === "chat") {
    return (
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      ""
    );
  }
  // responses API
  if (typeof data.output_text === "string" && data.output_text) {
    return data.output_text;
  }
  const arr = Array.isArray(data.output) ? data.output : [];
  for (const item of arr) {
    if (item && item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (
          c &&
          (c.type === "output_text" || c.type === "text") &&
          typeof c.text === "string"
        ) {
          return c.text;
        }
      }
    }
  }
  return "";
}

async function rankWithLLM(openaiKey, openaiCfg, profile, candidates, n, language) {
  const sig =
    profile.topRated.map((r) => r.tmdbId).join(",") +
    "|" +
    candidates.map((c) => c.id).join(",") +
    `|${openaiCfg.baseUrl}|${openaiCfg.endpoint}|${openaiCfg.model}|${openaiCfg.reasoningEffort}|${n}|${language}`;
  const cacheKey = `personalized:llm:v2:${djb2Hash(sig)}`;

  return withCache(cacheKey, 3600, async () => {
    const isZh = language && language.startsWith("zh");
    const systemPrompt = isZh
      ? `你是影视推荐助手. 基于用户的 Trakt 观影资料和候选列表, 从候选中挑选 ${n} 部最契合用户口味的作品, 按契合度降序排列.
约束:
1. 只能使用候选列表中已存在的 tmdbId, 禁止编造.
2. 输出严格为单一 JSON 对象, 不要 Markdown 或多余文本.
3. 格式: {"recommendations":[{"tmdbId":<number>,"mediaType":"movie"|"tv","reason":"<≤40字 中文>"}]}
4. reason 需具体说明契合点, 避免空话.`
      : `You are a film/TV recommender. From the candidate list, pick the ${n} best matches for this user, sorted by fit.
Rules:
1. You may ONLY use tmdbIds from the candidates. Never invent.
2. Output a single raw JSON object. No markdown, no prose.
3. Schema: {"recommendations":[{"tmdbId":<number>,"mediaType":"movie"|"tv","reason":"<≤40 chars>"}]}
4. reason must be specific, in ${language}.`;

    const compactCandidates = candidates.map((c) => ({
      tmdbId: c.id,
      mediaType: c._mt,
      title: c.title || c.name,
      year: (c.release_date || c.first_air_date || "").slice(0, 4),
      voteAverage: c.vote_average,
      overview: (c.overview || "").slice(0, 180),
    }));

    const compactProfile = {
      topRated: profile.topRated.map((r) => ({
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        title: r.title,
        year: r.year,
        rating: r.rating,
        genres: r.genres,
      })),
      genreCounts: profile.genreCounts,
      recentTitles: profile.recentTitles,
    };

    const userContent = JSON.stringify({
      profile: compactProfile,
      candidates: compactCandidates,
      targetCount: n,
      language,
    });

    const url =
      openaiCfg.endpoint === "responses"
        ? `${openaiCfg.baseUrl}/responses`
        : `${openaiCfg.baseUrl}/chat/completions`;
    const httpOpts = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
    };

    let payload =
      openaiCfg.endpoint === "responses"
        ? buildResponsesPayload(openaiCfg, systemPrompt, userContent)
        : buildChatPayload(openaiCfg, systemPrompt, userContent);

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      let httpError;
      try {
        response = await Widget.http.post(url, payload, httpOpts);
      } catch (e) {
        httpError = e;
      }

      // Collect status + error message from either thrown error or returned body
      const status =
        (httpError &&
          (httpError.status ||
            (httpError.response && httpError.response.status))) ||
        (response && response.status);
      let errMsg = "";
      if (httpError) {
        errMsg = String((httpError && httpError.message) || "");
      }
      if (!httpError && status != null && status >= 400) {
        const bodyErr =
          response &&
          response.data &&
          response.data.error &&
          (response.data.error.message || response.data.error.code);
        errMsg = String(bodyErr || `HTTP ${status}`);
      }

      const failed = httpError || (status != null && status >= 400);
      if (!failed) break;

      // Level 1: JSON format unsupported
      const jsonFmtPresent =
        payload.response_format || (payload.text && payload.text.format);
      if (
        jsonFmtPresent &&
        /response_format|json_object|json_schema|text\.format/i.test(
          errMsg
        )
      ) {
        const next = { ...payload };
        delete next.response_format;
        if (next.text) {
          const t = { ...next.text };
          delete t.format;
          if (Object.keys(t).length === 0) delete next.text;
          else next.text = t;
        }
        payload = next;
        response = undefined;
        continue;
      }

      // Level 2: reasoning field unsupported
      const reasoningPresent = payload.reasoning_effort || payload.reasoning;
      if (
        reasoningPresent &&
        /reasoning_effort|reasoning\.effort|['"]reasoning['"]/i.test(
          errMsg
        )
      ) {
        const next = { ...payload };
        delete next.reasoning_effort;
        delete next.reasoning;
        payload = next;
        response = undefined;
        continue;
      }

      // Unrecoverable
      throw mapHttpError(httpError || { status }, "OpenAI");
    }

    // Defensive — retry loop always either breaks with response or throws;
    // this catches any unexpected path where response stays undefined.
    if (!response) throw new Error("OpenAI 多次重试仍失败");

    const content = extractLLMText(response.data, openaiCfg.endpoint);
    if (!content) throw new Error("OpenAI 返回空内容");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (!match) throw new Error("OpenAI 输出不是合法 JSON");
      parsed = JSON.parse(match[0]);
    }

    const recs = (parsed && parsed.recommendations) || [];
    return recs.map((r) => ({
      tmdbId: Number(r.tmdbId),
      mediaType: normalizeMediaType(r.mediaType),
      reason: r.reason || "",
    }));
  });
}

function fallbackRank(candidates, n) {
  const sorted = candidates.slice().sort((a, b) => {
    const sa = (a.popularity || 0) * 0.6 + (a.vote_average || 0) * 0.4;
    const sb = (b.popularity || 0) * 0.6 + (b.vote_average || 0) * 0.4;
    return sb - sa;
  });
  return sorted.slice(0, n).map((c) => ({
    tmdbId: c.id,
    mediaType: c._mt,
    reason: "",
  }));
}

function formatAsVideoItems(ranked, candidateById, language) {
  const out = [];
  for (const r of ranked) {
    const key = `${r.mediaType}.${r.tmdbId}`;
    const c = candidateById[key];
    if (!c) continue;
    // README.md:184 规范要求 id 前缀形式; trendingmedia.js:107 却用 raw id.
    // 以 README 为准; 若 Forward 运行时拒绝前缀, 改回 String(r.tmdbId).
    out.push({
      id: key,
      type: "tmdb",
      title: c.title || c.name || "",
      posterPath: c.poster_path
        ? `https://image.tmdb.org/t/p/w500${c.poster_path}`
        : "",
      backdropPath: c.backdrop_path
        ? `https://image.tmdb.org/t/p/w780${c.backdrop_path}`
        : "",
      releaseDate: c.release_date || c.first_air_date || "",
      mediaType: r.mediaType,
      rating: c.vote_average,
      genreTitle: mapGenreIdsToNames(c.genre_ids, r.mediaType, language),
      description: r.reason
        ? `${r.reason} · ${c.overview || ""}`
        : c.overview || "",
    });
  }
  return out;
}

async function getRecommendations(params = {}) {
  const traktClientId = params.traktClientId || "";
  const traktUsername = params.traktUsername || "";
  const tmdbApiKey = params.tmdbApiKey || "";
  const openaiApiKey = params.openaiApiKey || "";
  const mediaType = params.mediaType || "mixed";
  const language = params.language || "zh-CN";
  const count = Math.max(
    5,
    Math.min(50, parseInt(params.count || "20", 10) || 20)
  );

  if (!traktClientId) throw new Error("缺少 Trakt Client ID");
  if (!traktUsername) throw new Error("缺少 Trakt 用户名");
  if (!tmdbApiKey) throw new Error("缺少 TMDB API Key");
  if (!openaiApiKey) throw new Error("缺少 OpenAI API Key");

  const openaiCfg = resolveOpenAIConfig(params);

  const profile = await fetchTraktProfile(
    traktClientId,
    traktUsername,
    mediaType
  );

  if (
    (profile.topRated || []).length === 0 &&
    (profile.recentTitles || []).length === 0
  ) {
    throw new Error("Trakt 账号暂无观影数据, 请先在 Trakt 标记一些作品");
  }

  const { candidates, candidateById } = await fetchTMDBCandidates(
    tmdbApiKey,
    profile,
    mediaType,
    language
  );

  if (!candidates || candidates.length === 0) {
    throw new Error("没有找到合适的候选作品");
  }

  let ranked;
  try {
    ranked = await rankWithLLM(
      openaiApiKey,
      openaiCfg,
      profile,
      candidates,
      count,
      language
    );
    ranked = ranked.filter(
      (r) => candidateById[`${r.mediaType}.${r.tmdbId}`]
    );
    if (ranked.length === 0) {
      console.error("[AI推荐] LLM 结果全为幻觉, 降级");
      ranked = fallbackRank(candidates, count);
    } else {
      ranked = ranked.slice(0, count);
    }
  } catch (e) {
    console.error("[AI推荐] LLM 失败, 降级:", (e && e.message) || e);
    ranked = fallbackRank(candidates, count);
  }

  return formatAsVideoItems(ranked, candidateById, language);
}
