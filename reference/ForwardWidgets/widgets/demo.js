/**
 * 示例模块
 * 给 module 指定 type 为 stream 或 subtitle 后，默认会携带以下参数：
 * tmdbId: TMDB ID，Optional
 * imdbId: IMDB ID，Optional
 * id: Media ID，Optional
 * type: 类型，tv | movie
 * seriesName：剧名，Optional
 * episodeName：集名，Optional
 * season: 季，电影时为空，Optional
 * episode: 集，电影时为空，Optional
 * link: 链接，Optional
 */
WidgetMetadata = {
  id: "forward.meta.demo",
  title: "DEMO",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "演示模块",
  author: "Forward",
  site: "https://github.com/InchStudio/ForwardWidgets",
  modules: [
    {
      //id需固定为getResource
      id: "loadResource",
      title: "加载资源",
      functionName: "loadResource",
      type: "stream",
      params: [],
    },
    {
      //id需固定为getDetail
      id: "loadSubtitle",
      title: "加载字幕",
      functionName: "loadSubtitle",
      type: "subtitle",
      params: [],
    },
  ],
};

async function loadResource(params) {
  const { tmdbId, imdbId, id, type, seriesName, episodeName, season, episode, link } = params;

  return [
    {
        name: "测试资源",
        description: "资源介绍，可以包含分辨率、编码、音频等信息\n4k|DV|dts|atmos|7.1", 
        url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
    },
    {
        name: "测试资源2",
        description: "资源介绍，可以包含分辨率、编码、音频等信息\n4k|HDR|5.1", 
        url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    },
    {
        name: "测试资源3",
        description: "资源介绍，可以包含分辨率、编码、音频等信息\n1080p|HDR|aac", 
        url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    },
  ] 
  
}

async function loadSubtitle(params) {
  const { tmdbId, imdbId, id, type, seriesName, episodeName, season, episode, link } = params;

  return [
    {
        id: "test-subtitle",
        title: "测试字幕",
        lang: "en",
        count: 100,
        url: "https://dl.subhd.tv/2025/08/1754195078288.srt",
    },
  ]
}