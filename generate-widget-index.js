const fs = require('fs');
const path = require('path');

// 配置目录路径
const WIDGETS_DIR = './widgets';
const OUTPUT_FILE = './forward-widgets.fwd';
const RAW_URL_BASE = 'https://raw.githubusercontent.com/alexcz-a11y/forward-AI-Personalized-recommendations/main/widgets';

// 创建临时目录来存放预处理的文件
const TEMP_DIR = path.join(__dirname, 'temp_widgets');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 通过创建一个临时文件来提取 WidgetMetadata
function extractWidgetMetadata(filePath) {
  try {
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(TEMP_DIR, fileName);

    // 读取原始文件内容
    const content = fs.readFileSync(filePath, 'utf8');

    // 创建一个临时模块,将 WidgetMetadata 暴露为模块导出
    const wrappedContent = `
      let exportedMetadata;

      // 捕获 WidgetMetadata 对象
      global.WidgetMetadata = function(metadata) {
        exportedMetadata = metadata;
        return metadata;
      };

      // 如果是赋值形式,例如 WidgetMetadata = {...}
      Object.defineProperty(global, 'WidgetMetadata', {
        set: function(value) {
          exportedMetadata = value;
        },
        get: function() {
          return function(metadata) {
            exportedMetadata = metadata;
            return metadata;
          }
        }
      });

      // 执行原始 widget 代码
      ${content}

      module.exports = exportedMetadata;
    `;

    // 写入临时文件
    fs.writeFileSync(tempFilePath, wrappedContent);

    // 尝试导入临时模块
    const modulePath = require.resolve(tempFilePath);
    const metadata = require(modulePath);

    // 清除缓存,这样如果再次运行时代码已更改,我们会得到新的结果
    delete require.cache[modulePath];

    if (!metadata) {
      console.warn(`在文件 ${filePath} 中未找到 WidgetMetadata`);
      return null;
    }

    // 提取所需字段
    const { id, title, description, requiredVersion, version, author } = metadata;

    const url = `${RAW_URL_BASE}/${fileName}`;

    return { id, title, description, requiredVersion, version, author, url };
  } catch (error) {
    console.error(`处理文件 ${filePath} 时出错:`, error);
    return null;
  }
}

async function main() {
  try {
    // 确保 widgets 目录存在
    if (!fs.existsSync(WIDGETS_DIR)) {
      console.error(`目录 ${WIDGETS_DIR} 不存在`);
      process.exit(1);
    }

    // 获取 widgets 目录中的所有 JS 文件
    const files = fs.readdirSync(WIDGETS_DIR)
      .filter(file => file.endsWith('.js'))
      .map(file => path.join(WIDGETS_DIR, file));

    console.log(`找到 ${files.length} 个 JS 文件需要处理`);

    // 处理每个文件并提取元数据
    const widgetIndex = files.map(extractWidgetMetadata).filter(Boolean);
    const metadata = {
      title: 'Forward AI Personalized Recommendations',
      description: 'AI-powered personalized movie and TV recommendations for the Forward app',
      widgets: widgetIndex,
    };

    console.log(`成功从 ${widgetIndex.length} 个 widget 中提取元数据`);

    // 写入索引文件
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(metadata, null, 2));

    console.log(`widget 索引已写入 ${OUTPUT_FILE}`);
  } finally {
    // 清理临时目录
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error('生成 widget 索引时出错:', error);
  process.exit(1);
});
