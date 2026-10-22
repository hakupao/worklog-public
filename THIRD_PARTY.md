# 第三方依赖与开源项目

本项目用到的外部代码、字体、图标和服务。版本是 2026-10-22 锁定的版本，准确值以各自的 lockfile 为准（`web/package-lock.json`、`server/package-lock.json`、`collector/go.sum`）。增删依赖时顺手更新这一页。

## 1. 随产品分发的（打进浏览器包或 Worker 里）

### 网页（`web/`，运行在浏览器）

| 项目 | 版本 | 许可证 | 用在哪里 | 地址 |
|------|------|--------|----------|------|
| React / React DOM | 19.3.0 | MIT | 整个前端 | https://github.com/facebook/react |
| TanStack Query | 5.103.2 | MIT | 前端的数据请求与缓存 | https://github.com/TanStack/query |
| Apache ECharts | 5.6.0 | Apache-2.0 | 统计页的图表（懒加载） | https://github.com/apache/echarts |
| holiday_jp | 2.5.2 | MIT | 日本祝日（营业日、倒计时、月历） | https://github.com/holiday-jp/holiday_jp-js |
| ascii.rest | 0.4.0（npm）＋ 19 个场景（GitHub `c556be4`） | MIT | 此刻页的场景图（懒加载）。npm 版只有 15 个场景，另外 19 个原样复制在 `web/src/scene/vendor/`，附原 LICENSE；npm 发版后删掉该目录 | https://github.com/bas3line/ascii |
| Fusion Pixel Font（8 / 10 / 12 px，简中 / 日文） | 未记录 | SIL OFL 1.1 | 里世界的全部点阵字（LED 字形取样） | https://github.com/TakWolf/fusion-pixel-font ，许可证在 `web/src/led/fonts/LICENSE-OFL.txt` |
| Phosphor Icons | 2.1.1 | MIT | 案件徽章的物件剪影（生成进 `objects.gen.ts`） | https://github.com/phosphor-icons/core ，声明在 `web/src/badge/NOTICE.md` |
| Microsoft Fluent Emoji（High Contrast，经 Iconify 打包） | 1.2.6 | MIT | 同上，案件徽章 | https://github.com/microsoft/fluentui-emoji ，声明同上 |
| sql.js | 1.14.2 | MIT | 仅演示站（`npm run build:demo`）：浏览器里代替 D1 的 SQLite（WebAssembly），生产包不含 | https://github.com/sql-js/sql.js |

### 服务端（`server/`，Cloudflare Worker）

| 项目 | 版本 | 许可证 | 用在哪里 | 地址 |
|------|------|--------|----------|------|
| Hono | 4.13.8 | MIT | Worker 的路由与中间件 | https://github.com/honojs/hono |
| Zod | 3.25.76 | MIT | API 入参和偏好设置的校验 | https://github.com/colinhacks/zod |
| jose | 6.2.12 | MIT | 校验 Cloudflare Access 的 JWT | https://github.com/panva/jose |
| Anthropic TypeScript SDK | 0.132.1 | MIT | 调 Claude（翻译、润色、周报摘要、PDF 排版） | https://github.com/anthropics/anthropic-sdk-typescript |
| ExcelJS | 4.4.0 | MIT | 週報 xlsx 导出 | https://github.com/exceljs/exceljs |
| JSZip | 3.10.2 | MIT 或 GPL-3.0-or-later（双许可，本项目按 MIT 使用） | xlsx 打包 | https://github.com/Stuk/jszip |
| @cloudflare/puppeteer | 1.4.0 | Apache-2.0 | 週報 PDF（Browser Rendering） | https://github.com/cloudflare/puppeteer |

## 2. 本机收集器（`wl`，`collector/`，Go）

| 项目 | 版本 | 许可证 | 用在哪里 | 地址 |
|------|------|--------|----------|------|
| BurntSushi/toml | 1.6.0 | MIT | 读 `config.toml` | https://github.com/BurntSushi/toml |
| golang.org/x/crypto（blake2b） | 0.58.0 | BSD-3-Clause | 会话指纹（判断空闲会话是否需要重新总结） | https://go.googlesource.com/crypto |
| golang.org/x/sys | 0.49.0（间接） | BSD-3-Clause | x/crypto 的依赖 | https://go.googlesource.com/sys |

## 3. 开发、测试、构建工具（不随产品分发）

| 项目 | 版本 | 许可证 | 用在哪里 |
|------|------|--------|----------|
| TypeScript | 7.0.2（web）/ 5.9.3（server） | Apache-2.0 | 类型检查 |
| Vite ＋ @vitejs/plugin-react（仅 web） | 8.3.0 / 6.1.1 | MIT | 前端构建与开发服务器 |
| Vitest | 5.0.1（web）/ 4.1.11（server） | MIT | 单元测试 |
| @cloudflare/vitest-plugin | 1.1.13 | MIT | 在 workerd 里跑 server 测试 |
| Wrangler | 4.135.0 | MIT 或 Apache-2.0 | Worker 本地开发、D1 迁移、部署 |
| @cloudflare/workers-types | 5.20260921.1 | MIT 或 Apache-2.0 | Worker 类型 |
| esbuild | 0.28.1 | MIT | server 脚本打包 |
| jsonc-parser | 3.3.1 | MIT | 读 `wrangler.jsonc` |
| Testing Library（react / jest-dom / user-event） | 16.3.3 / 7.0.1 / 14.6.7 | MIT | 前端组件测试 |
| jsdom | 30.1.0 | MIT | 测试里的 DOM |
| Playwright（playwright-core） | 1.63.0 | Apache-2.0 | 截图与界面验收脚本（用系统 Chrome） |
| svgpath / svg-path-bbox | 2.6.0 / 2.1.0 | MIT / BSD-3-Clause | 生成案件徽章剪影的脚本 |
| @types/node、@types/react、@types/react-dom、@types/sql.js | — | MIT | 类型定义（DefinitelyTyped） |
| GitHub Actions：checkout、setup-node、setup-go、dorny/paths-filter | v7 / v7 / v7 / v3 | MIT | CI |

## 4. 运行时从外部加载的字体（不随包分发）

这些字体不打进包里，页面打开时从 Google Fonts 或 rsms.me 加载（`web/src/ui/webfonts.ts`、`web/src/m/fonts.ts`），PDF 由 Worker 拉取 Google Fonts 的样式后内联（`server/src/report/pdf/html.ts`、`fonts.ts`）。加载失败时回落到系统字体。

| 字体 | 用在哪里 | 加载来源 | 许可证 | 地址 |
|------|----------|----------|--------|------|
| IBM Plex Sans / Sans JP | 表世界默认字体 | Google Fonts | SIL OFL 1.1 | https://github.com/IBM/plex |
| Inter | 表世界字体选项 | rsms.me | SIL OFL 1.1 | https://github.com/rsms/inter |
| Geist | 表世界字体选项 | Google Fonts | SIL OFL 1.1 | https://github.com/vercel/geist-font |
| Noto Sans SC / JP | 中文、日文正文；PDF | Google Fonts | SIL OFL 1.1 | https://github.com/notofonts/noto-cjk |
| BIZ UDPGothic | 日文界面的首选字体 | Google Fonts | SIL OFL 1.1 | https://fonts.google.com/specimen/BIZ+UDPGothic |
| Doto | 手机版的点阵数字 | Google Fonts | SIL OFL 1.1 | https://fonts.google.com/specimen/Doto |
| Shippori Mincho、Noto Serif JP / SC | 週報 PDF 的衬线字 | Google Fonts | SIL OFL 1.1 | https://fonts.google.com/specimen/Shippori+Mincho 、https://github.com/notofonts/noto-cjk |

IBM Plex Mono 只在样式里写了名字（`web/src/styles/v2.css` 的日期表格），没有加载，本机装了才会用。

## 5. 外部服务（不是开源项目，但运行时依赖）

| 服务 | 用在哪里 |
|------|----------|
| Cloudflare Workers ＋ D1 | 网页和 API 的托管、数据库 |
| Cloudflare Access | 登录与访问控制 |
| Cloudflare Browser Rendering | 週報 PDF |
| Cloudflare Workers Builds | 推送 `main` 后自动部署 |
| Anthropic API（Claude） | Worker 端的翻译、润色、摘要、PDF 排版 |
| Claude Code CLI（`claude -p`） | 收集器在本机总结会话、判断成果物 |
| GitHub（仓库、Actions、Releases） | 代码托管、CI、`wl` 二进制发布 |
| Google Fonts（fonts.googleapis.com / fonts.gstatic.com） | 网页、手机版、週報 PDF 的字体（见第 4 节） |
| rsms.me | Inter 字体 |

## 6. 许可证注意事项

- **MIT / BSD / Apache 的声明**：构建时压缩会删掉 JS 里的许可注释，线上的 JS 不带这些声明（直接用 npm 包时也是这样）。仓库里保留了需要随附的许可证原文：`web/src/scene/vendor/LICENSE`、`web/src/led/fonts/LICENSE-OFL.txt`、`web/src/badge/NOTICE.md`。
- **ECharts（Apache-2.0）**：随浏览器包分发。如果以后要对外发布，需附上 Apache-2.0 许可和 ECharts 的 NOTICE。
- **JSZip**：MIT 和 GPL-3.0-or-later 双许可，本项目选 MIT。
- **Fusion Pixel Font（OFL 1.1）**：以 woff2 随浏览器包分发。OFL 允许嵌入和再分发，但不能单独售卖字体，改动过的字体不能沿用原名。
- **ascii.rest 的 19 个复制场景**：除一行类型 import 外原样复制。npm 发版带上它们以后要删掉 `vendor/`，`web/test/scene.test.ts` 会失败来提醒。
