#!/usr/bin/env bun
/**
 * build_docs.ts — 將專案 Markdown 文件轉為自包含、可離線閱讀的多頁 HTML 站。
 *
 * - 來源：README.md、AGENTS.md、docs/*.md
 * - 輸出：docs/*.html（README → docs/index.html），含側邊導覽
 * - 特性：零外部 CDN（CSS 內聯）、深色模式、CJK 字體、表格/程式碼/callout 樣式
 * - 可直接作為 GitHub Pages 來源（Settings → Pages → /docs）
 *
 * 用法：bun run build:docs
 */
import { marked } from "marked";
import { join, dirname, basename } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "docs");

interface Page {
  src: string; // 相對 ROOT 的來源路徑
  out: string; // 輸出檔名（置於 docs/）
  title: string; // <title> 與導覽顯示
  nav: string; // 側邊導覽簡短標籤
  icon: keyof typeof ICONS; // 導覽圖示（自繪 SVG）
}

/**
 * 自繪單色 SVG 圖示集（16×16，stroke=currentColor，跟隨主題與 active 狀態變色）。
 * 僅存內層路徑；由 svg() 包上共用屬性。需要實心的小點/星形以 fill="currentColor" 標註。
 */
const ICONS = {
  home: `<path d="M2.5 7.5 8 2.8l5.5 4.7"/><path d="M3.8 6.7V13h8.4V6.7"/>`,
  layers: `<path d="M8 2.3 14 5 8 7.7 2 5z"/><path d="M2.6 8 8 10.5 13.4 8"/><path d="M2.6 11 8 13.5 13.4 11"/>`,
  code: `<path d="M6 5 3 8l3 3"/><path d="M10 5l3 3-3 3"/>`,
  sliders: `<path d="M2 5h7"/><path d="M13 5h1"/><circle cx="10.5" cy="5" r="1.5"/><path d="M2 11h2"/><path d="M8 11h6"/><circle cx="5.5" cy="11" r="1.5"/>`,
  help: `<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.6.3-.9.7-.9 1.3"/><circle cx="8" cy="11.3" r=".55" fill="currentColor" stroke="none"/>`,
  film: `<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6"/><path d="M6.8 6.2 10 8l-3.2 1.8z" fill="currentColor" stroke="none"/>`,
  clock: `<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.5"/>`,
  refresh: `<path d="M12.8 8a4.8 4.8 0 1 0-1.4 3.4"/><path d="M12.9 4.7v3.1H9.8"/>`,
  terminal: `<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6"/><path d="M5 7l2 1.6L5 10.2"/><path d="M8.4 10.4h3"/>`,
  // callout 用
  info: `<circle cx="8" cy="8" r="6"/><path d="M8 7.4v3.4"/><circle cx="8" cy="5.2" r=".55" fill="currentColor" stroke="none"/>`,
  bulb: `<path d="M5.4 9.4a3.4 3.4 0 1 1 5.2 0c-.6.6-1 1.2-1.05 2H6.45c-.05-.8-.45-1.4-1.05-2z"/><path d="M6.5 13.4h3"/>`,
  star: `<path d="M8 2.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 11.3 4.8 12.1l.6-3.6L2.8 6.4l3.6-.5z"/>`,
  warn: `<path d="M8 2.9l5.6 9.7H2.4z"/><path d="M8 6.9v3"/><circle cx="8" cy="11.1" r=".5" fill="currentColor" stroke="none"/>`,
  ban: `<circle cx="8" cy="8" r="5.6"/><path d="M4.2 4.2l7.6 7.6"/>`,
} as const;

function svg(name: keyof typeof ICONS, cls = ""): string {
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// 導覽順序即側邊欄順序
const PAGES: Page[] = [
  { src: "README.md", out: "index.html", title: "KinetiText 文件", nav: "首頁 / README", icon: "home" },
  { src: "docs/ARCHITECTURE.md", out: "ARCHITECTURE.html", title: "架構文檔", nav: "架構文檔", icon: "layers" },
  { src: "docs/API.md", out: "API.html", title: "API 參考", nav: "API 參考", icon: "code" },
  { src: "docs/CONFIGURATION.md", out: "CONFIGURATION.html", title: "配置指南", nav: "配置指南", icon: "sliders" },
  { src: "docs/TROUBLESHOOTING.md", out: "TROUBLESHOOTING.html", title: "故障排查", nav: "故障排查", icon: "help" },
  { src: "docs/MP4_SERVICE.md", out: "MP4_SERVICE.html", title: "MP4 服務", nav: "MP4 服務", icon: "film" },
  { src: "docs/DURATION_SERVICE.md", out: "DURATION_SERVICE.html", title: "時長服務", nav: "時長服務", icon: "clock" },
  { src: "docs/MIGRATION_GUIDE.md", out: "MIGRATION_GUIDE.html", title: "遷移指南", nav: "遷移指南", icon: "refresh" },
  { src: "docs/PROJECT_STRUCTURE.md", out: "PROJECT_STRUCTURE.html", title: "專案結構與責任邊界", nav: "專案結構", icon: "layers" },
  { src: "AGENTS.md", out: "AGENTS.html", title: "AGENTS 開發指南", nav: "AGENTS 指南", icon: "terminal" },
];

/** 將 .md 連結改寫為扁平化的 .html（所有頁面都落在 docs/）。 */
function rewriteLinks(html: string): string {
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    const [path, anchor] = href.split("#");
    // 僅處理本地 .md 連結，外部 http(s) 與純錨點不動
    if (/^https?:\/\//.test(path) || path === "") return whole;
    if (!path.toLowerCase().endsWith(".md")) return whole;
    let p = path.replace(/^\.\//, "").replace(/^docs\//, "");
    p = p.replace(/\.md$/i, ".html");
    return `href="${anchor ? `${p}#${anchor}` : p}"`;
  });
}

/** 將 GitHub `> [!NOTE]` 等 callout blockquote 轉為帶樣式的區塊。 */
function transformCallouts(html: string): string {
  const types: Record<string, { cls: string; label: string; icon: keyof typeof ICONS }> = {
    NOTE: { cls: "note", label: "注意", icon: "info" },
    TIP: { cls: "tip", label: "提示", icon: "bulb" },
    IMPORTANT: { cls: "important", label: "重要", icon: "star" },
    WARNING: { cls: "warning", label: "警告", icon: "warn" },
    CAUTION: { cls: "caution", label: "當心", icon: "ban" },
  };
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?/gi,
    (_m, kind: string) => {
      const t = types[kind.toUpperCase()];
      return `<blockquote class="callout ${t.cls}"><p class="callout-title">${svg(t.icon)}<span>${t.label}</span></p><p>`;
    }
  );
}

/** 簡易 slug（保留 CJK，去除標點，空白轉連字號）供標題 id 使用。 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .trim()
    .replace(/[\s]+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "");
}

function renderMarkdown(md: string): string {
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth, text }: any) {
    const id = slugify(text);
    const inner = this.parser.parseInline(tokens);
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}">#</a>${inner}</h${depth}>\n`;
  };
  let html = marked.parse(md, { renderer, gfm: true, breaks: false }) as string;
  html = transformCallouts(html);
  html = rewriteLinks(html);
  return html;
}

function buildSidebar(current: string): string {
  const items = PAGES.map((p) => {
    const active = p.out === current ? ' class="active"' : "";
    return `      <li${active}><a href="${p.out}">${svg(p.icon, "nav-icon")}<span>${p.nav}</span></a></li>`;
  }).join("\n");
  return `<nav class="sidebar">
    <div class="brand"><a href="index.html">KinetiText</a><span class="brand-sub">文件站</span></div>
    <ul>
${items}
    </ul>
    <div class="sidebar-foot">由 <code>build:docs</code> 自動生成</div>
  </nav>`;
}

function pageTemplate(page: Page, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20fill='%230969da'%20d='M4%202h8v12l-4-2.4L4%2014z'/%3E%3C/svg%3E">
<title>${page.title} · KinetiText</title>
<style>${CSS}</style>
</head>
<body>
<button class="nav-toggle" aria-label="切換導覽" onclick="document.body.classList.toggle('nav-open')">☰ 目錄</button>
<div class="layout">
${buildSidebar(page.out)}
  <main class="content">
    <article class="markdown-body">
${body}
    </article>
    <footer class="page-foot">
      <hr>
      <p>KinetiText 文件 · 來源 <code>${page.src}</code> · 本頁由建置腳本自動生成，請編輯對應的 Markdown 後重跑 <code>bun run build:docs</code>。</p>
    </footer>
  </main>
</div>
</body>
</html>`;
}

const CSS = `
:root{
  --bg:#ffffff; --fg:#1f2328; --muted:#59636e; --border:#d1d9e0;
  --link:#0969da; --code-bg:#f6f8fa; --pre-bg:#f6f8fa; --sidebar-bg:#f6f8fa;
  --table-head:#f6f8fa; --table-stripe:#fafbfc; --accent:#0969da;
  --callout-note:#0969da; --callout-tip:#1a7f37; --callout-important:#8250df;
  --callout-warning:#9a6700; --callout-caution:#cf222e;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --border:#3d444d;
    --link:#4493f8; --code-bg:#151b23; --pre-bg:#151b23; --sidebar-bg:#0d1117;
    --table-head:#151b23; --table-stripe:#11161d; --accent:#4493f8;
    --callout-note:#4493f8; --callout-tip:#3fb950; --callout-important:#ab7df8;
    --callout-warning:#d29922; --callout-caution:#f85149;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans CJK TC","Noto Sans TC",Helvetica,Arial,sans-serif;
  font-size:16px; line-height:1.7; -webkit-font-smoothing:antialiased;
}
.layout{display:flex; align-items:flex-start}
.sidebar{
  position:sticky; top:0; flex:0 0 260px; height:100vh; overflow-y:auto;
  background:var(--sidebar-bg); border-right:1px solid var(--border); padding:20px 14px;
}
.brand{display:flex; align-items:baseline; gap:8px; padding:0 8px 14px; border-bottom:1px solid var(--border); margin-bottom:10px}
.brand a{font-weight:700; font-size:20px; color:var(--fg); text-decoration:none}
.brand-sub{color:var(--muted); font-size:13px}
.sidebar ul{list-style:none; margin:0; padding:0}
.sidebar li a{display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:8px; color:var(--fg); text-decoration:none; font-size:14.5px}
.sidebar li a:hover{background:rgba(127,127,127,.12)}
.sidebar li.active a{background:var(--accent); color:#fff; font-weight:600}
.ic{width:16px; height:16px; flex:0 0 16px; vertical-align:-2px}
.nav-icon{opacity:.85}
.sidebar li.active a .nav-icon{opacity:1}
.sidebar-foot{margin-top:18px; padding:0 10px; color:var(--muted); font-size:12px}
.content{flex:1 1 auto; min-width:0; padding:32px 40px 80px; max-width:900px}
.nav-toggle{display:none}
.markdown-body{overflow-wrap:break-word}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{
  line-height:1.3; margin:1.6em 0 .6em; scroll-margin-top:16px; font-weight:700;
}
.markdown-body h1{font-size:2em; padding-bottom:.3em; border-bottom:1px solid var(--border); margin-top:.2em}
.markdown-body h2{font-size:1.5em; padding-bottom:.3em; border-bottom:1px solid var(--border)}
.markdown-body h3{font-size:1.25em}
.markdown-body h4{font-size:1.05em}
.markdown-body a{color:var(--link); text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.anchor{float:left; margin-left:-.9em; padding-right:.3em; color:var(--muted); opacity:0; text-decoration:none; font-weight:400}
.markdown-body h1:hover .anchor,.markdown-body h2:hover .anchor,.markdown-body h3:hover .anchor,.markdown-body h4:hover .anchor{opacity:1}
.markdown-body p{margin:.7em 0}
.markdown-body ul,.markdown-body ol{padding-left:1.6em; margin:.6em 0}
.markdown-body li{margin:.25em 0}
.markdown-body code{
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  font-size:.88em; background:var(--code-bg); padding:.2em .4em; border-radius:6px;
}
.markdown-body pre{
  background:var(--pre-bg); border:1px solid var(--border); border-radius:10px;
  padding:14px 16px; overflow-x:auto; margin:1em 0;
}
.markdown-body pre code{background:none; padding:0; font-size:.86em; line-height:1.55}
.markdown-body table{border-collapse:collapse; width:100%; margin:1em 0; display:block; overflow-x:auto}
.markdown-body th,.markdown-body td{border:1px solid var(--border); padding:7px 12px; text-align:left}
.markdown-body th{background:var(--table-head); font-weight:600}
.markdown-body tr:nth-child(2n) td{background:var(--table-stripe)}
.markdown-body blockquote{margin:1em 0; padding:.4em 1em; color:var(--muted); border-left:4px solid var(--border)}
.markdown-body blockquote.callout{
  border-left:4px solid var(--callout-note); color:inherit; background:rgba(127,127,127,.06);
  border-radius:0 8px 8px 0; padding:.6em 1em;
}
.callout.note{border-left-color:var(--callout-note)}
.callout.tip{border-left-color:var(--callout-tip)}
.callout.important{border-left-color:var(--callout-important)}
.callout.warning{border-left-color:var(--callout-warning)}
.callout.caution{border-left-color:var(--callout-caution)}
.callout-title{display:flex; align-items:center; gap:7px; font-weight:700; margin:0 0 .3em}
.callout.note .callout-title{color:var(--callout-note)}
.callout.tip .callout-title{color:var(--callout-tip)}
.callout.important .callout-title{color:var(--callout-important)}
.callout.warning .callout-title{color:var(--callout-warning)}
.callout.caution .callout-title{color:var(--callout-caution)}
.markdown-body img{max-width:100%}
.markdown-body hr{border:none; border-top:1px solid var(--border); margin:2em 0}
.page-foot{margin-top:40px; color:var(--muted); font-size:13px}
.page-foot hr{border:none; border-top:1px solid var(--border)}
@media (max-width:860px){
  .nav-toggle{
    display:inline-block; position:fixed; top:12px; left:12px; z-index:20;
    background:var(--accent); color:#fff; border:none; border-radius:8px;
    padding:8px 12px; font-size:14px; cursor:pointer;
  }
  .sidebar{
    position:fixed; left:0; top:0; z-index:15; transform:translateX(-100%);
    transition:transform .2s ease; box-shadow:2px 0 12px rgba(0,0,0,.2);
  }
  body.nav-open .sidebar{transform:translateX(0)}
  .content{padding:64px 18px 60px}
}
`;

async function main() {
  let count = 0;
  for (const page of PAGES) {
    const srcPath = join(ROOT, page.src);
    const file = Bun.file(srcPath);
    if (!(await file.exists())) {
      console.warn(`⚠ 略過缺少的來源：${page.src}`);
      continue;
    }
    const md = await file.text();
    const body = renderMarkdown(md);
    const html = pageTemplate(page, body);
    await Bun.write(join(OUT_DIR, page.out), html);
    console.log(`✓ ${page.src} → docs/${page.out}`);
    count++;
  }
  // GitHub Pages：避免 Jekyll 處理（保險）
  await Bun.write(join(OUT_DIR, ".nojekyll"), "");
  console.log(`\n完成：${count} 頁輸出至 docs/。本機預覽：bun run docs:serve（或直接以瀏覽器開啟 docs/index.html）`);
}

main();
