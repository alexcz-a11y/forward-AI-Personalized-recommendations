/**
 * Forward AI 个性化推荐 Widget v3
 *
 * 完全 client-side 的个性化推荐:
 *   Trakt OAuth (/sync/*) → TMDB (候选池) → OpenAI (LLM 排序) → VideoItem[]
 *
 * 用户需在 widget 全局设置里填入 2 把 key:
 *   tmdbApiKey / openaiApiKey
 * 首次运行时 widget 会返回一条引导卡片让用户在 trakt.tv/activate
 * 输入一次性代码完成 Trakt OAuth 授权; token 之后存在 Widget.storage 里
 * 自动 refresh, 用户不需要再次介入.
 */

WidgetMetadata = {
  id: "forward.personalized",
  title: "AI 个性化推荐",
  version: "3.0.0",
  requiredVersion: "0.0.2",
  description: "基于 Trakt 观影历史 + OpenAI 的个性化电影/剧集推荐",
  author: "alexcz-a11y",
  site: "https://github.com/alexcz-a11y/forward-AI-Personalized-recommendations",
  globalParams: [
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
    {
      name: "traktResetAuth",
      title: "重新激活 Trakt",
      type: "enumeration",
      value: "false",
      description:
        "切换 Trakt 账号时用. 设为「是」并刷新一次 widget 后, 会清空本地 Trakt 授权并返回新的激活卡片. ⚠️ 用完务必改回「否」, 否则每次刷新都会重新要求授权.",
      enumOptions: [
        { title: "否", value: "false" },
        { title: "是 (清空授权)", value: "true" },
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

// Trakt OAuth 常量 ------------------------------------------------------------
// client_secret 在 Trakt 的 device code flow 模型里被接受暴露在源码中:
// 该 flow 专为无 redirect URI 的公开客户端设计, 攻击者单独拿到 secret 无法访问
// 任何用户数据 —— 必须配合每个用户自己在 Widget.storage 里的 refresh_token 才
// 能换 access_token. 参考 Trakt docs: trakt.docs.apiary.io 的
// "Authentication - Devices" 章节.
const TRAKT_BASE = "https://api.trakt.tv";
const TRAKT_CLIENT_ID =
  "6742936e1ba42ab5aac9c1bde9e8379664a0783d26228417dd60ef8b318daec1";
const TRAKT_CLIENT_SECRET =
  "f0b6076e4b9472fdb6c5c81e83f22927a262c3fb60c012ce7a10c536aef61d4c";
const TRAKT_APP_NAME = "Forward AI Personalized";

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

// 唯一把多信号塌缩成数字的地方; 仅用于 (a) 给 LLM 选 top-N 时排序,
// (b) 给 TMDB 选种子. 该分数本身从不写入 LLM payload —— LLM 拿到的是原始字段.
function engagementScore(item) {
  const ratingPart =
    item.rating != null ? (item.rating - 5) * 0.6 : 0; // -3..+3
  const playsPart =
    item.plays ? Math.log2(item.plays + 1) * 0.8 : 0; // 1 play≈0.8, 8 plays≈2.5
  const recencyPart =
    item.daysSinceLastWatch != null
      ? Math.max(0, 1 - item.daysSinceLastWatch / 365) * 1.2
      : 0; // 今天=1.2, 1 年前=0
  const completionPart =
    item.completionPct != null ? item.completionPct * 1.0 : 0; // 0..1
  const intentPart = item.recentEvents30d
    ? Math.min(item.recentEvents30d, 3) * 0.3
    : 0;
  return (
    ratingPart + playsPart + recencyPart + completionPart + intentPart
  );
}

function pickTopEngaged(items, mediaType, max) {
  const filtered =
    mediaType && mediaType !== "any"
      ? items.filter((i) => i.mediaType === mediaType)
      : items.slice();
  filtered.sort((a, b) => engagementScore(b) - engagementScore(a));
  return filtered.slice(0, max);
}

// 用于挑 TMDB 种子: 不打分的用户也要能跑通, 所以扩展了"被认定为种子"的口径.
function isEngagedSeed(item) {
  return (
    (item.rating || 0) >= 7 ||
    (item.plays || 0) >= 2 ||
    (item.completionPct || 0) >= 0.7 ||
    (item.daysSinceLastWatch != null &&
      item.daysSinceLastWatch <= 60 &&
      (item.plays || 0) >= 1)
  );
}

function projectItemForPrompt(item, opts) {
  const out = {
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
    year: item.year,
  };
  if (item.rating != null) out.rating = item.rating;
  if (item.plays) out.plays = item.plays;
  if (item.daysSinceLastWatch != null)
    out.daysSinceLastWatch = item.daysSinceLastWatch;
  if (item.completionPct != null)
    out.completionPct = Number(item.completionPct.toFixed(2));
  if (opts && opts.includeEpisodes) {
    if (item.episodesWatched != null)
      out.episodesWatched = item.episodesWatched;
    if (item.episodesAired != null)
      out.episodesAired = item.episodesAired;
  }
  if (opts && opts.includeGenres && Array.isArray(item.genres))
    out.genres = item.genres.slice(0, 5);
  if (opts && opts.includeActions) {
    if (item.scrobbleCount) out.scrobbleCount = item.scrobbleCount;
    if (item.checkinCount) out.checkinCount = item.checkinCount;
  }
  if (item.isRewatched) out.isRewatched = true;
  return out;
}

function mapHttpError(err, label) {
  const status =
    err && (err.status || (err.response && err.response.status));
  if (status === 401) {
    if (label === "Trakt") {
      // OAuth 模式下 401 只有一种含义: token 被撤销或服务器端失效.
      // 挂上 isTrakt401 标志, caller 应该调 traktAuthClear() 让下次刷新
      // 重新进入 device flow. 本函数维持纯函数语义, 不直接操作 storage.
      const e = new Error(
        "Trakt 授权失效, 下次刷新会自动重新激活"
      );
      e.isTrakt401 = true;
      return e;
    }
    return new Error(`${label} 认证失败, 请检查密钥`);
  }
  if (status === 403) return new Error(`${label} 权限不足 (403)`);
  if (status === 404) return new Error(`${label} 资源不存在 (404)`);
  if (status === 429) return new Error(`${label} 请求过于频繁, 请稍后再试`);
  if (status) return new Error(`${label} 返回 ${status}`);
  return new Error(`${label} 请求失败: ${(err && err.message) || err}`);
}

// ============================================================================
// Trakt OAuth — Device Code Flow 状态机 + token 持久化
// ============================================================================

// 作为控制流用的 typed error: getRecommendations 里用 instanceof 捕获,
// 转成引导 VideoItem 返给用户; 不是真正的错误, 不应走错误日志路径.
class DeviceAuthPendingError extends Error {
  constructor(authState) {
    super("device_pending");
    this.name = "DeviceAuthPendingError";
    this.authState = authState;
  }
}

const TRAKT_AUTH_STORAGE_KEY = "personalized:trakt:auth:v1";
const TRAKT_CLIENT_ID_HASH = djb2Hash(TRAKT_CLIENT_ID);

function traktAuthLoad() {
  let raw;
  try {
    raw = Widget.storage.get(TRAKT_AUTH_STORAGE_KEY);
  } catch (e) {
    return { state: "uninit" };
  }
  if (!raw || typeof raw !== "object" || typeof raw.state !== "string") {
    return { state: "uninit" };
  }
  // client_id 变了 → 老 token 整体作废
  if (raw.client_id_hash && raw.client_id_hash !== TRAKT_CLIENT_ID_HASH) {
    return { state: "uninit" };
  }
  return raw;
}

function traktAuthSave(state) {
  try {
    Widget.storage.set(TRAKT_AUTH_STORAGE_KEY, {
      ...state,
      client_id_hash: TRAKT_CLIENT_ID_HASH,
    });
  } catch (e) {
    console.error("[AI推荐] Trakt auth 持久化失败:", (e && e.message) || e);
  }
}

function traktAuthClear() {
  traktAuthSave({ state: "uninit" });
}

// Device Code Flow 起飞 — POST /oauth/device/code, 把 pending state 存下来
async function startDeviceFlow() {
  let res;
  let httpErr;
  try {
    res = await Widget.http.post(
      `${TRAKT_BASE}/oauth/device/code`,
      { client_id: TRAKT_CLIENT_ID },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    httpErr = e;
  }
  const status =
    (httpErr &&
      (httpErr.status || (httpErr.response && httpErr.response.status))) ||
    (res && res.status);
  if (httpErr || (status != null && status >= 400)) {
    throw mapHttpError(httpErr || { status }, "Trakt");
  }
  const data = (res && res.data) || {};
  if (!data.device_code || !data.user_code) {
    throw new Error("Trakt device flow 返回异常, 请稍后重试");
  }
  const newState = {
    state: "device_pending",
    device_code: data.device_code,
    user_code: data.user_code,
    // Trakt 返回的字段名是 verification_url (单数 url), RFC 8628 偏离,
    // 且不提供 verification_uri_complete, 用户必须在浏览器手动输入 user_code.
    verification_url: data.verification_url || "https://trakt.tv/activate",
    device_expires_at:
      Date.now() + (Number(data.expires_in) || 600) * 1000,
    device_interval: Number(data.interval) || 5,
  };
  traktAuthSave(newState);
  return newState;
}

// 轮询 token — 200=成功; 400/429=仍 pending; 404/409/410/418=不可恢复
async function pollDeviceToken(authState) {
  let res;
  let httpErr;
  try {
    res = await Widget.http.post(
      `${TRAKT_BASE}/oauth/device/token`,
      {
        // ⚠️ Trakt 偏离 RFC 8628: body 字段是 "code" 不是 "device_code"
        code: authState.device_code,
        client_id: TRAKT_CLIENT_ID,
        client_secret: TRAKT_CLIENT_SECRET,
      },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    httpErr = e;
  }
  const status =
    (httpErr &&
      (httpErr.status || (httpErr.response && httpErr.response.status))) ||
    (res && res.status);

  // pending: 用户还没批准, caller 应该继续显示引导卡
  if (status === 400 || status === 429) return null;

  // 2xx: 拿到 token bundle
  if (status != null && status >= 200 && status < 300) {
    const data = (res && res.data) || {};
    if (!data.access_token) return null; // 空 body, 当 pending 处理
    const expiresIn = Number(data.expires_in) || 86400;
    return {
      state: "authorized",
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
      obtained_at: Date.now(),
    };
  }

  // 404/409/410/418: 授权码已失效, 清空状态让 caller 重新起飞
  if (
    status === 404 ||
    status === 409 ||
    status === 410 ||
    status === 418
  ) {
    traktAuthClear();
    throw new Error(
      "Trakt 授权码已失效或被拒绝, 请下次刷新 widget 重新激活"
    );
  }

  // 其它 不可识别错误透传 (包括 status === null 即纯 throw 路径)
  throw mapHttpError(httpErr || { status }, "Trakt");
}

// access_token 临近过期时刷新 — 只有 401/invalid_grant 才清 state,
// 其它错误透传 (网络故障 / Trakt 暂时性 5xx, 不要当作永久失效)
async function refreshAccessToken(authState) {
  let res;
  let httpErr;
  try {
    res = await Widget.http.post(
      `${TRAKT_BASE}/oauth/token`,
      {
        refresh_token: authState.refresh_token,
        client_id: TRAKT_CLIENT_ID,
        client_secret: TRAKT_CLIENT_SECRET,
        grant_type: "refresh_token",
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    httpErr = e;
  }
  const status =
    (httpErr &&
      (httpErr.status || (httpErr.response && httpErr.response.status))) ||
    (res && res.status);

  if (status === 401) {
    traktAuthClear();
    throw new Error(
      "Trakt 授权失效, 请重新激活 (下次刷新 widget 会出现激活卡片)"
    );
  }

  if (httpErr || (status != null && status >= 400)) {
    throw mapHttpError(httpErr || { status }, "Trakt");
  }

  const data = (res && res.data) || {};
  if (!data.access_token) {
    throw new Error("Trakt 刷新 token 返回空");
  }
  const expiresIn = Number(data.expires_in) || 86400;
  const next = {
    state: "authorized",
    access_token: data.access_token,
    refresh_token: data.refresh_token || authState.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
    obtained_at: Date.now(),
  };
  traktAuthSave(next);
  return next;
}

// 入口: 保证调用方能拿到一个有效 access_token, 否则抛 DeviceAuthPendingError
async function ensureValidToken() {
  const auth = traktAuthLoad();

  // uninit → 起飞 device flow, 返回 pending
  if (auth.state === "uninit") {
    const pending = await startDeviceFlow();
    throw new DeviceAuthPendingError(pending);
  }

  // device_pending → 检查超时, 否则轮询
  if (auth.state === "device_pending") {
    if (!auth.device_expires_at || auth.device_expires_at < Date.now()) {
      // device_code 过期, 清掉重新起飞
      traktAuthClear();
      const pending = await startDeviceFlow();
      throw new DeviceAuthPendingError(pending);
    }
    const tokens = await pollDeviceToken(auth);
    if (!tokens) {
      // 仍在 pending, 返回同一张卡
      throw new DeviceAuthPendingError(auth);
    }
    traktAuthSave(tokens);
    return tokens.access_token;
  }

  // authorized → 检查 access_token 是否快过期, 必要时 refresh
  if (auth.state === "authorized") {
    if (!auth.access_token || !auth.expires_at) {
      traktAuthClear();
      return ensureValidToken();
    }
    if (auth.expires_at - 60000 < Date.now()) {
      if (!auth.refresh_token) {
        traktAuthClear();
        return ensureValidToken();
      }
      const next = await refreshAccessToken(auth);
      return next.access_token;
    }
    return auth.access_token;
  }

  // 未知 state, 安全兜底
  traktAuthClear();
  return ensureValidToken();
}

function traktHeaders(accessToken) {
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": TRAKT_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`,
  };
}

function buildPendingVideoItem(authState) {
  const code = authState.user_code || "";
  const url = authState.verification_url || "https://trakt.tv/activate";
  return [
    {
      id: url, // type: "url" 时 id 必须是 url 本身
      type: "url",
      title: "🔐 请先激活 Trakt 账号",
      description:
        `授权码: ${code}\n\n` +
        "步骤:\n" +
        `1. 在浏览器打开 ${url}\n` +
        `2. 登录 Trakt, 输入上面的 8 位代码\n` +
        `3. 批准 ${TRAKT_APP_NAME} 的访问\n` +
        "4. 回到 Forward, 下拉刷新这个 widget 即可开始使用\n\n" +
        "提示: 授权码 10 分钟内有效, 超时需重新刷新.",
      link: url,
      posterPath: "",
      backdropPath: "",
    },
  ];
}

async function fetchTraktProfile(accessToken, mediaType, userHash) {
  const cacheKey = `personalized:trakt:v3:${userHash}:${mediaType}`;
  return withCache(cacheKey, 6 * 3600, async () => {
    const types =
      mediaType === "mixed" ? ["movies", "shows"] : [mediaType];
    const headers = traktHeaders(accessToken);

    const itemMap = new Map(); // key=`${mt}.${tmdbId}` → 合并后的条目
    const ratedItems = [];
    const watchlistTmdbIdSet = new Set();
    const watchlistSample = [];
    const collectionTmdbIdSet = new Set();
    const history30dTitles = [];
    const recentTitles = [];
    const genreCounts = {};
    let ratedCount = 0;

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 86400 * 1000;

    const ensureItem = (mt, tmdbId) => {
      const key = `${mt}.${tmdbId}`;
      let it = itemMap.get(key);
      if (!it) {
        it = { tmdbId, mediaType: mt };
        itemMap.set(key, it);
      }
      return it;
    };

    for (const type of types) {
      const mt = type === "movies" ? "movie" : "tv";

      // OAuth /sync/* endpoints — 字段和公开 /users/{u}/* 完全一致, 只换路径.
      // chunkedParallel 把并发上限压到 4, 避免 mixed 模式下一次性发 10 个请求.
      const reqDefs = [
        {
          name: "ratings",
          url: `${TRAKT_BASE}/sync/ratings/${type}?limit=200&extended=full`,
        },
        {
          name: "watched",
          // shows 必须 extended=full 才有 aired_episodes 字段
          url:
            type === "shows"
              ? `${TRAKT_BASE}/sync/watched/shows?extended=full`
              : `${TRAKT_BASE}/sync/watched/movies`,
        },
        { name: "history", url: `${TRAKT_BASE}/sync/history/${type}?limit=200` },
        { name: "watchlist", url: `${TRAKT_BASE}/sync/watchlist/${type}` },
        { name: "collection", url: `${TRAKT_BASE}/sync/collection/${type}` },
      ];

      let results;
      try {
        results = await chunkedParallel(reqDefs, 4, async (req) => {
          const res = await Widget.http.get(req.url, { headers });
          return { name: req.name, data: (res && res.data) || [] };
        });
      } catch (e) {
        const mapped = mapHttpError(e, "Trakt");
        // 401 → token 失效, 清 auth 让下次刷新重走 device flow
        if (mapped.isTrakt401) traktAuthClear();
        throw mapped;
      }

      const byName = {};
      for (const r of results) byName[r.name] = r.data;

      // ---- watched: 提取 plays / lastWatchedAt / 剧集完成度 ----
      const watched = byName.watched || [];
      for (const w of watched) {
        const item = w.movie || w.show;
        if (!item || !item.ids || item.ids.tmdb == null) continue;
        const it = ensureItem(mt, item.ids.tmdb);
        it.title = item.title;
        it.year = item.year;
        it.genres = Array.isArray(item.genres) ? item.genres : [];

        if (mt === "movie") {
          it.plays = w.plays || 0;
          it.lastWatchedAt = w.last_watched_at || null;
        } else {
          // shows: 累加 seasons[].episodes[]
          const seasons = Array.isArray(w.seasons) ? w.seasons : [];
          let epWatched = 0;
          let totalPlays = 0;
          let lastEpAt = null;
          for (const s of seasons) {
            const eps = Array.isArray(s.episodes) ? s.episodes : [];
            for (const e of eps) {
              const p = e.plays || 0;
              if (p > 0) epWatched++;
              totalPlays += p;
              if (
                e.last_watched_at &&
                (!lastEpAt || e.last_watched_at > lastEpAt)
              ) {
                lastEpAt = e.last_watched_at;
              }
            }
          }
          it.plays = totalPlays;
          it.lastWatchedAt = lastEpAt || w.last_watched_at || null;
          it.episodesWatched = epWatched;
          // aired_episodes 在 extended=full 时由 show 对象给出; 缺则 null, 防 NaN
          it.episodesAired =
            item.aired_episodes != null ? item.aired_episodes : null;
          it.completionPct = it.episodesAired
            ? it.episodesWatched / it.episodesAired
            : null;
        }

        for (const g of item.genres || []) {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        }
      }

      // ---- ratings: attach rating + 仍然喂 legacy 的 topRated lens ----
      const ratings = byName.ratings || [];
      for (const r of ratings) {
        const item = r.movie || r.show;
        if (!item || !item.ids || item.ids.tmdb == null) continue;
        const it = ensureItem(mt, item.ids.tmdb);
        if (!it.title) it.title = item.title;
        if (!it.year) it.year = item.year;
        if (!it.genres)
          it.genres = Array.isArray(item.genres) ? item.genres : [];
        it.rating = r.rating;
        it.ratedAt = r.rated_at || null;
        ratedCount++;
        if ((r.rating || 0) >= 7) {
          ratedItems.push({
            tmdbId: item.ids.tmdb,
            mediaType: mt,
            title: item.title,
            year: item.year,
            rating: r.rating,
            genres: Array.isArray(item.genres) ? item.genres : [],
          });
        }
      }

      // ---- history: 统计 action 类型 + 30 天内事件数 ----
      const history = byName.history || [];
      for (const h of history) {
        const item = h.movie || h.show;
        if (!item) continue;
        if (item.title) recentTitles.push(item.title);
        if (!item.ids || item.ids.tmdb == null) continue;
        const it = ensureItem(mt, item.ids.tmdb);
        if (!it.title) it.title = item.title;
        if (!it.year) it.year = item.year;
        const action = h.action;
        if (action === "scrobble")
          it.scrobbleCount = (it.scrobbleCount || 0) + 1;
        else if (action === "checkin")
          it.checkinCount = (it.checkinCount || 0) + 1;
        else it.watchCount = (it.watchCount || 0) + 1;
        const wt = h.watched_at;
        if (wt) {
          const t = Date.parse(wt);
          if (!isNaN(t) && now - t <= THIRTY_DAYS_MS) {
            it.recentEvents30d = (it.recentEvents30d || 0) + 1;
            if (item.title) history30dTitles.push(item.title);
          }
        }
      }

      // ---- watchlist: 加入排除集 + 抽样作为 intent lens ----
      const watchlist = byName.watchlist || [];
      for (const w of watchlist) {
        const item = w.movie || w.show;
        if (!item || !item.ids || item.ids.tmdb == null) continue;
        watchlistTmdbIdSet.add(`${mt}.${item.ids.tmdb}`);
        if (watchlistSample.length < 20) {
          watchlistSample.push({
            tmdbId: item.ids.tmdb,
            mediaType: mt,
            title: item.title,
            year: item.year,
          });
        }
      }

      // ---- collection: 弱兴趣信号, 仅记录 id ----
      const collection = byName.collection || [];
      for (const c of collection) {
        const item = c.movie || c.show;
        if (!item || !item.ids || item.ids.tmdb == null) continue;
        collectionTmdbIdSet.add(`${mt}.${item.ids.tmdb}`);
      }
    }

    // ---- 收尾: 算 daysSinceLastWatch / isRewatched, 转 array ----
    const watchedItems = [];
    const watchedTmdbIdSet = new Set();
    let rewatchedCount = 0;
    let completedShowsCount = 0;
    let droppedShowsCount = 0;
    for (const it of itemMap.values()) {
      if (!it.title) continue; // 没有标题说明只有 ids, 无意义, 丢掉
      if (it.lastWatchedAt) {
        const t = Date.parse(it.lastWatchedAt);
        it.daysSinceLastWatch = isNaN(t)
          ? null
          : Math.max(0, Math.floor((now - t) / 86400000));
      } else {
        it.daysSinceLastWatch = null;
      }
      if ((it.plays || 0) >= 2) {
        it.isRewatched = true;
        rewatchedCount++;
      }
      if (
        it.mediaType === "tv" &&
        it.completionPct != null &&
        it.completionPct >= 0.8
      ) {
        completedShowsCount++;
      }
      // 弃剧负反馈: 至少 5 集已播 (排除 mini-series), 看了一点就停 (≤20%).
      // completionPct > 0 排除"加进库还没看"的零完成.
      if (
        it.mediaType === "tv" &&
        it.completionPct != null &&
        it.completionPct > 0 &&
        it.completionPct <= 0.2 &&
        (it.episodesAired || 0) >= 5
      ) {
        droppedShowsCount++;
      }
      watchedItems.push(it);
      watchedTmdbIdSet.add(`${it.mediaType}.${it.tmdbId}`);
    }

    const watchedTmdbIds = Array.from(watchedTmdbIdSet);
    const watchlistTmdbIds = Array.from(watchlistTmdbIdSet);
    const excludeTmdbIds = Array.from(
      new Set([...watchedTmdbIds, ...watchlistTmdbIds])
    );

    return {
      watchedItems,
      ratedItems: ratedItems.sort((a, b) => (b.rating || 0) - (a.rating || 0)),
      watchlistTmdbIds,
      watchlistSample,
      collectionTmdbIds: Array.from(collectionTmdbIdSet),
      history30dTitles,
      recentTitles: recentTitles.slice(0, 60),
      genreCounts,
      watchedTmdbIds,
      excludeTmdbIds,
      totals: {
        totalWatched: watchedItems.length,
        moviesWatched: watchedItems.filter((i) => i.mediaType === "movie")
          .length,
        showsWatched: watchedItems.filter((i) => i.mediaType === "tv").length,
        ratedCount,
        rewatchedCount,
        completedShowsCount,
        droppedShowsCount,
        watchlistCount: watchlistTmdbIds.length,
        collectionCount: collectionTmdbIdSet.size,
      },
    };
  });
}

// ============================================================================
// /sync/playback — OAuth 新解锁的播放进度数据, 派生电影"半途弃"负反馈和
// "正在看"正向意图信号. 单次请求抓全部 (movies + episodes), 缓存 1h.
// ============================================================================
async function fetchPlaybackSignals(accessToken, userHash) {
  const cacheKey = `personalized:trakt-playback:v1:${userHash}`;
  return withCache(cacheKey, 3600, async () => {
    let res;
    try {
      res = await Widget.http.get(
        `${TRAKT_BASE}/sync/playback?extended=full`,
        { headers: traktHeaders(accessToken) }
      );
    } catch (e) {
      const mapped = mapHttpError(e, "Trakt");
      if (mapped.isTrakt401) traktAuthClear();
      throw mapped;
    }

    const items = (res && res.data) || [];
    const now = Date.now();

    const abandonedMovies = [];
    const inProgressMovies = [];
    const inProgressShowsMap = new Map(); // 按 show tmdbId 去重, 保留最近暂停的

    for (const it of items) {
      const isMovie = !!it.movie;
      const isEpisode = !!it.show && !!it.episode;
      if (!isMovie && !isEpisode) continue;

      const tmdbId = isMovie
        ? it.movie && it.movie.ids && it.movie.ids.tmdb
        : it.show && it.show.ids && it.show.ids.tmdb;
      if (tmdbId == null) continue;

      const progress = Number(it.progress) || 0;
      const pausedAtMs = it.paused_at ? Date.parse(it.paused_at) : NaN;
      if (isNaN(pausedAtMs)) continue;
      const pausedDaysAgo = (now - pausedAtMs) / 86400000;

      if (isMovie) {
        const projection = {
          tmdbId,
          mediaType: "movie",
          title: it.movie.title,
          year: it.movie.year,
          progress: Math.round(progress * 10) / 10,
          pausedDaysAgo: Math.round(pausedDaysAgo),
        };
        if (progress >= 10 && progress <= 80 && pausedDaysAgo >= 14) {
          // 14 天没回来的半途电影 — 强负反馈
          abandonedMovies.push(projection);
        } else if (pausedDaysAgo < 14) {
          // 14 天内在看的电影 — 当前意图
          inProgressMovies.push(projection);
        }
        // 夹在中间 (pausedDaysAgo < 14 但已看完 80%+) 的情况, 既非 abandon 也非 inProgress, 忽略
      } else {
        // episode: 按 show tmdbId 去重, 只保留最近暂停的那一集
        if (pausedDaysAgo >= 14) continue; // 老的追剧记录不当强正向信号
        const showKey = `tv.${tmdbId}`;
        const existing = inProgressShowsMap.get(showKey);
        const projection = {
          tmdbId,
          mediaType: "tv",
          title: it.show.title,
          year: it.show.year,
          progress: Math.round(progress * 10) / 10,
          pausedDaysAgo: Math.round(pausedDaysAgo),
          season: it.episode.season,
          episode: it.episode.number,
        };
        if (!existing || projection.pausedDaysAgo < existing.pausedDaysAgo) {
          inProgressShowsMap.set(showKey, projection);
        }
      }
    }

    abandonedMovies.sort((a, b) => b.pausedDaysAgo - a.pausedDaysAgo);
    inProgressMovies.sort((a, b) => a.pausedDaysAgo - b.pausedDaysAgo);
    const inProgressShows = Array.from(inProgressShowsMap.values()).sort(
      (a, b) => a.pausedDaysAgo - b.pausedDaysAgo
    );

    return {
      abandonedMovies: abandonedMovies.slice(0, 10),
      inProgressMovies: inProgressMovies.slice(0, 10),
      inProgressShows: inProgressShows.slice(0, 10),
    };
  });
}

async function fetchTMDBCandidates(apiKey, profile, mediaType, language) {
  const types =
    mediaType === "mixed"
      ? ["movie", "tv"]
      : [mediaType === "movies" ? "movie" : "tv"];

  // 用 isEngagedSeed 扩大种子来源: 不打分的用户也能挑出代表口味的作品.
  // 同一集合既给 cache sig 用, 又喂给 TMDB recommendations 端点.
  const seedsByType = {};
  for (const t of types) {
    const pool = (profile.watchedItems || []).filter(
      (i) => i.mediaType === t && isEngagedSeed(i)
    );
    pool.sort((a, b) => engagementScore(b) - engagementScore(a));
    seedsByType[t] = pool.slice(0, 5);
  }
  const seedSig = types
    .flatMap((t) => seedsByType[t].map((s) => `${s.mediaType}.${s.tmdbId}`))
    .join(",");
  const cacheKey = `personalized:tmdb:v2:${djb2Hash(
    seedSig + ":" + mediaType + ":" + language
  )}`;

  return withCache(cacheKey, 6 * 3600, async () => {
    const TMDB = "https://api.themoviedb.org/3";
    // 排除 watched ∪ watchlist: 心愿单上的作品也不能再被推荐.
    const excludeSet = new Set(profile.excludeTmdbIds || []);
    const raw = [];

    for (const type of types) {
      const seeds = seedsByType[type] || [];

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
      if (excludeSet.has(key)) continue;
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

async function rankWithLLM(openaiKey, openaiCfg, profile, playbackSignals, candidates, n, language) {
  // 派生多镜头数据 (cache sig 和 compactProfile 共享同一份计算).
  const watchedItems = profile.watchedItems || [];
  const mostEngaged = pickTopEngaged(watchedItems, "any", 25);
  const recentlyEngaged = pickTopEngaged(
    watchedItems.filter(
      (i) => i.daysSinceLastWatch != null && i.daysSinceLastWatch <= 60
    ),
    "any",
    15
  );
  const rewatched = watchedItems
    .filter((i) => (i.plays || 0) >= 2)
    .sort((a, b) => (b.plays || 0) - (a.plays || 0))
    .slice(0, 10);
  const completedShows = watchedItems
    .filter(
      (i) =>
        i.mediaType === "tv" &&
        i.completionPct != null &&
        i.completionPct >= 0.8
    )
    .sort(
      (a, b) =>
        (a.daysSinceLastWatch == null ? 9999 : a.daysSinceLastWatch) -
        (b.daysSinceLastWatch == null ? 9999 : b.daysSinceLastWatch)
    )
    .slice(0, 10);
  // 弃剧负反馈: 看了一两集就停, 用来告诉 LLM 用户排斥哪些题材/基调.
  // 排除条件: completionPct=0 (加进库还没看) / mini-series (<5 集已播)
  const droppedShows = watchedItems
    .filter(
      (i) =>
        i.mediaType === "tv" &&
        i.completionPct != null &&
        i.completionPct > 0 &&
        i.completionPct <= 0.2 &&
        (i.episodesAired || 0) >= 5
    )
    .sort(
      (a, b) =>
        (a.daysSinceLastWatch == null ? 9999 : a.daysSinceLastWatch) -
        (b.daysSinceLastWatch == null ? 9999 : b.daysSinceLastWatch)
    )
    .slice(0, 8);

  const totals = profile.totals || {};
  const pbSignals = playbackSignals || {};
  const abandonedMovies = pbSignals.abandonedMovies || [];
  const inProgressMovies = pbSignals.inProgressMovies || [];
  const inProgressShows = pbSignals.inProgressShows || [];

  // sig 拼接顺序:
  //   topEngagedKeys — 反映当前主口味 (排序后稳定)
  //   droppedKeys / abandonedKeys — 负反馈指纹
  //   inProgress* — 当前意图指纹 (排序后稳定, 防止 pausedDaysAgo 抖动导致缓存频繁 miss)
  //   total/watchlist/rewatched/dropped count — 任一变化都应让缓存失效
  //   candidates — TMDB 候选池本身的指纹
  //   openai cfg + n + language — 切模型/语言/数量都要重新跑
  const topEngagedKeys = mostEngaged
    .map((x) => `${x.mediaType}.${x.tmdbId}`)
    .sort()
    .join(",");
  const droppedKeys = droppedShows
    .map((x) => `${x.mediaType}.${x.tmdbId}`)
    .sort()
    .join(",");
  const abandonedMovieKeys = abandonedMovies
    .map((x) => `movie.${x.tmdbId}`)
    .sort()
    .join(",");
  const inProgressMovieKeys = inProgressMovies
    .map((x) => `movie.${x.tmdbId}`)
    .sort()
    .join(",");
  const inProgressShowKeys = inProgressShows
    .map((x) => `tv.${x.tmdbId}`)
    .sort()
    .join(",");
  const sig =
    topEngagedKeys +
    "|" +
    droppedKeys +
    "|" +
    abandonedMovieKeys +
    "|" +
    inProgressMovieKeys +
    "|" +
    inProgressShowKeys +
    "|" +
    (totals.totalWatched || 0) +
    "|" +
    (totals.watchlistCount || 0) +
    "|" +
    (totals.rewatchedCount || 0) +
    "|" +
    (totals.droppedShowsCount || 0) +
    "|" +
    candidates.map((c) => `${c._mt}.${c.id}`).join(",") +
    `|${openaiCfg.baseUrl}|${openaiCfg.endpoint}|${openaiCfg.model}|${openaiCfg.reasoningEffort}|${n}|${language}`;
  const cacheKey = `personalized:llm:v5:${djb2Hash(sig)}`;

  return withCache(cacheKey, 3600, async () => {
    const isZh = language && language.startsWith("zh");
    const systemPrompt = isZh
      ? `你是影视推荐助手. 基于用户的 Trakt 观影资料(多镜头数据)和候选列表, 从候选中挑选 ${n} 部最契合用户口味的作品, 按契合度降序排列.

如何理解资料:
- 大多数用户不打分. 高 plays、近期重看(isRewatched=true)、剧集完成度高(completionPct≥0.8) 都是与显式高分等同甚至更强的正向信号.
- mostEngaged 里同时出现在 topRated/rewatched/completedShows 多个镜头的条目, 权重应当放大.
- recentlyEngaged 反映当前的口味方向, 优先用它推断"现在想看什么风格".
- droppedShows 是用户开了头但 ≤20% 就放弃的剧, 通常表明题材/基调/节奏不合口味. 把它们的 genre / 风格当作**负反馈**, 主动避开候选里风格相近的作品.
- abandonedMovies 是用户开始看 (10–80% 进度) 但 14 天以上没回来的电影, 视同 droppedShows 的电影版, 作为**负反馈**, 主动避开同类基调.
- inProgressMovies / inProgressShows 是用户过去 14 天正在看的, 强烈的**正向意图**信号, 用来推断"现在想看什么", 优先考虑与它们基调/节奏相近的候选.
- watchlistSample 表达观看意图. 用来推断口味方向, 但绝对不要从候选中推荐与 watchlistSample 中 tmdbId 相同的作品.
- 结合 genreCounts、年代、基调(暗黑/治愈/快节奏/慢热) 综合判断, 挑选与用户已有偏好相邻但未看过的作品.

约束:
1. 只能使用候选列表中已存在的 tmdbId, 禁止编造.
2. 输出严格为单一 JSON 对象, 不要 Markdown 或多余文本.
3. 格式: {"recommendations":[{"tmdbId":<number>,"mediaType":"movie"|"tv","reason":"<≤40字 中文>"}]}
4. reason 需具体说明契合点(例如"与你重看的XX同导演" / "你完结的XX续作风格"), 避免空话.`
      : `You are a film/TV recommender. Using the user's multi-lens Trakt profile and the candidate list, pick the ${n} best matches and sort by fit.

How to read the profile:
- Most users don't rate. Treat HIGH plays, recent rewatches (isRewatched=true), and high series completion (completionPct >= 0.8) as STRONG positive signals — equal to or stronger than explicit ratings.
- An item appearing in multiple lenses (mostEngaged + rewatched + topRated) should be weighted more.
- recentlyEngaged reflects the user's CURRENT taste direction — prioritize it for "what they want right now".
- droppedShows are series the user started but abandoned at <=20% completion — usually a sign the genre / tone / pace doesn't fit. Treat their genres/tone as NEGATIVE signals and actively avoid recommending tonally similar candidates.
- abandonedMovies are movies the user started (10–80% in) but hasn't returned to in 14+ days. Treat their genres/tone as NEGATIVE signals, like droppedShows for TV.
- inProgressMovies / inProgressShows are items the user is actively watching (paused within 14 days). STRONG positive intent — lean into tonally similar candidates.
- watchlistSample is intent: it tells you what flavor they want next. Use it to infer direction, but NEVER recommend any candidate whose tmdbId appears in watchlistSample.
- Cross-reference candidates against the user's genre/era/tone patterns (dark vs cozy, fast vs slow, prestige vs popcorn).

Rules:
1. You may ONLY use tmdbIds from the candidates. Never invent.
2. Output a single raw JSON object. No markdown, no prose.
3. Schema: {"recommendations":[{"tmdbId":<number>,"mediaType":"movie"|"tv","reason":"<≤40 chars>"}]}
4. reason must be specific (e.g. "same director as your rewatched X", "tonal match for your completed Y"), in ${language}.`;

    const compactCandidates = candidates.map((c) => ({
      tmdbId: c.id,
      mediaType: c._mt,
      title: c.title || c.name,
      year: (c.release_date || c.first_air_date || "").slice(0, 4),
      voteAverage: c.vote_average,
      overview: (c.overview || "").slice(0, 180),
    }));

    // 多镜头 compactProfile: 同一条目可在多个 list 出现, 重叠是给 LLM 的强信号.
    const compactProfile = {
      stats: {
        totalWatched: totals.totalWatched || 0,
        moviesWatched: totals.moviesWatched || 0,
        showsWatched: totals.showsWatched || 0,
        ratedCount: totals.ratedCount || 0,
        rewatchedCount: totals.rewatchedCount || 0,
        completedShowsCount: totals.completedShowsCount || 0,
        droppedShowsCount: totals.droppedShowsCount || 0,
        watchlistCount: totals.watchlistCount || 0,
        abandonedMoviesCount: abandonedMovies.length,
        inProgressMoviesCount: inProgressMovies.length,
        inProgressShowsCount: inProgressShows.length,
      },
      topRated: (profile.ratedItems || []).slice(0, 15).map((r) => ({
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        title: r.title,
        year: r.year,
        rating: r.rating,
        genres: Array.isArray(r.genres) ? r.genres.slice(0, 5) : undefined,
      })),
      mostEngaged: mostEngaged.map((it) =>
        projectItemForPrompt(it, {
          includeEpisodes: true,
          includeGenres: true,
          includeActions: true,
        })
      ),
      recentlyEngaged: recentlyEngaged.map((it) =>
        projectItemForPrompt(it, { includeEpisodes: true })
      ),
      rewatched: rewatched.map((it) => projectItemForPrompt(it)),
      completedShows: completedShows.map((it) =>
        projectItemForPrompt(it, { includeEpisodes: true })
      ),
      droppedShows: droppedShows.map((it) =>
        projectItemForPrompt(it, {
          includeEpisodes: true,
          includeGenres: true,
        })
      ),
      abandonedMovies,
      inProgressMovies,
      inProgressShows,
      watchlistSample: profile.watchlistSample || [],
      genreCounts: profile.genreCounts,
      recentTitles: (profile.recentTitles || []).slice(0, 30),
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
  const tmdbApiKey = params.tmdbApiKey || "";
  const openaiApiKey = params.openaiApiKey || "";
  const mediaType = params.mediaType || "mixed";
  const language = params.language || "zh-CN";
  const count = Math.max(
    5,
    Math.min(50, parseInt(params.count || "20", 10) || 20)
  );

  if (!tmdbApiKey) throw new Error("缺少 TMDB API Key");
  if (!openaiApiKey) throw new Error("缺少 OpenAI API Key");

  // 用户切换 Trakt 账号时手动触发: 清空当前授权然后重走 device flow.
  if (params.traktResetAuth === "true") traktAuthClear();

  const openaiCfg = resolveOpenAIConfig(params);

  // 1. OAuth — 拿到可用 access_token 或返回引导卡片
  let accessToken;
  let userHash;
  try {
    accessToken = await ensureValidToken();
    // userHash 只用作 cache key 区分用户, 不需要真实 trakt id.
    // 省去一次 /users/me 请求, 碰撞概率天文数字级低.
    userHash = djb2Hash(accessToken.slice(0, 12));
  } catch (e) {
    if (e instanceof DeviceAuthPendingError) {
      return buildPendingVideoItem(e.authState);
    }
    throw e;
  }

  // 2. Trakt 数据 — profile (慢, 6h cache) + playback (快, 1h cache) 并行
  let profile, playbackSignals;
  try {
    [profile, playbackSignals] = await Promise.all([
      fetchTraktProfile(accessToken, mediaType, userHash),
      fetchPlaybackSignals(accessToken, userHash),
    ]);
  } catch (e) {
    // fetchTraktProfile/Playback 内部已经处理 isTrakt401 → traktAuthClear
    // 这里只需透传, 用户下次刷新会重新进 device flow
    throw e;
  }

  // 空数据守卫: 重度观众但没评分的用户也能跑通
  if (
    (profile.watchedItems || []).length === 0 &&
    (profile.recentTitles || []).length === 0
  ) {
    throw new Error("Trakt 账号暂无观影数据, 请先在 Trakt 标记一些作品");
  }

  // 3. TMDB 候选池
  const { candidates, candidateById } = await fetchTMDBCandidates(
    tmdbApiKey,
    profile,
    mediaType,
    language
  );

  if (!candidates || candidates.length === 0) {
    throw new Error("没有找到合适的候选作品");
  }

  // 4. LLM 排序 (带 playbackSignals), 失败降级到 fallbackRank
  let ranked;
  try {
    ranked = await rankWithLLM(
      openaiApiKey,
      openaiCfg,
      profile,
      playbackSignals,
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

  // 5. watchlist 兜底过滤 — LLM 偶尔会忽略 prompt 把心愿单作品混进来
  const watchlistSet = new Set(profile.watchlistTmdbIds || []);
  if (watchlistSet.size > 0) {
    ranked = ranked.filter(
      (r) => !watchlistSet.has(`${r.mediaType}.${r.tmdbId}`)
    );
  }

  return formatAsVideoItems(ranked, candidateById, language);
}
