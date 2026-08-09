const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join("; ");

const COPY = {
    en: {
        eyebrow: "The link ends here",
        title: "Resource not found",
        description: "This link may be invalid, or the content may have been removed, blocked, or expired.",
        action: "Back to ImgHub",
        note: "Check the address or ask the person who shared it for a new link.",
    },
    "zh-CN": {
        eyebrow: "链接没有落在这里",
        title: "这个资源不存在",
        description: "链接可能无效，或者内容已被删除、封禁或过期。",
        action: "返回 ImgHub",
        note: "请检查地址，或联系链接分享者获取新的链接。",
    },
};

function preferredLanguage(request) {
    const first = (request.headers.get("Accept-Language") || "")
        .split(",", 1)[0]
        .trim()
        .toLowerCase();
    return first === "zh" || first.startsWith("zh-") ? "zh-CN" : "en";
}

function document(language) {
    const copy = COPY[language];
    return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>404 · ${copy.title} · ImgHub</title>
  <style>
    :root {
      color: #25342f;
      background: #f6f2e8;
      font-family: Inter, ui-rounded, "SF Pro Rounded", "PingFang SC", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      min-height: 100svh;
      margin: 0;
      display: grid;
      place-items: center;
      overflow-x: hidden;
      padding: clamp(28px, 8vh, 72px) 0;
      background:
        radial-gradient(circle at 14% 18%, rgba(234, 162, 98, .24), transparent 29rem),
        radial-gradient(circle at 86% 82%, rgba(62, 110, 90, .2), transparent 31rem),
        linear-gradient(rgba(37, 52, 47, .055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(37, 52, 47, .055) 1px, transparent 1px),
        #f6f2e8;
      background-size: auto, auto, 32px 32px, 32px 32px, auto;
    }
    main {
      position: relative;
      width: min(92vw, 880px);
      padding: clamp(34px, 7vw, 76px);
      border: 1px solid rgba(37, 52, 47, .14);
      border-radius: 36px;
      background: rgba(255, 253, 247, .86);
      box-shadow: 0 28px 80px rgba(45, 61, 54, .16);
      backdrop-filter: blur(16px);
      isolation: isolate;
    }
    main::before {
      content: "";
      position: absolute;
      inset: 18px;
      z-index: -1;
      border: 1px dashed rgba(37, 52, 47, .13);
      border-radius: 24px;
      pointer-events: none;
    }
    .code {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 22px;
      color: #a2552d;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    .code::before {
      content: "";
      width: 34px;
      height: 2px;
      border-radius: 2px;
      background: #d8864f;
    }
    .number {
      position: absolute;
      top: -44px;
      right: clamp(24px, 7vw, 68px);
      color: #315e4c;
      font-size: clamp(92px, 18vw, 164px);
      font-weight: 900;
      line-height: 1;
      letter-spacing: -.09em;
      opacity: .1;
      user-select: none;
    }
    h1 {
      max-width: 610px;
      margin: 0;
      color: #263b33;
      font-family: Georgia, "Songti SC", serif;
      font-size: clamp(40px, 7vw, 70px);
      font-weight: 600;
      line-height: 1.05;
      letter-spacing: -.045em;
    }
    .description {
      max-width: 570px;
      margin: 24px 0 0;
      color: #53655e;
      font-size: clamp(16px, 2vw, 19px);
      line-height: 1.75;
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 22px;
      margin-top: 36px;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 0 22px;
      border-radius: 999px;
      color: #fffdf7;
      background: #315e4c;
      box-shadow: 0 10px 24px rgba(49, 94, 76, .22);
      font-weight: 750;
      text-decoration: none;
      transition: transform .16s ease, box-shadow .16s ease;
    }
    a:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(49, 94, 76, .28); }
    a:focus-visible { outline: 3px solid #e7a36f; outline-offset: 4px; }
    a span { font-size: 20px; line-height: 1; }
    .note { max-width: 330px; color: #718078; font-size: 13px; line-height: 1.55; }
    .orbit {
      position: absolute;
      width: 96px;
      height: 96px;
      right: -34px;
      bottom: -34px;
      border: 18px solid rgba(216, 134, 79, .22);
      border-radius: 50%;
    }
    @media (max-width: 620px) {
      main { border-radius: 28px; }
      .footer { align-items: flex-start; flex-direction: column; }
      .number { top: -28px; }
    }
    @media (prefers-reduced-motion: reduce) {
      a { transition: none; }
    }
  </style>
</head>
<body>
  <main>
    <span class="number" aria-hidden="true">404</span>
    <div class="code">404 · ${copy.eyebrow}</div>
    <h1>${copy.title}</h1>
    <p class="description">${copy.description}</p>
    <div class="footer">
      <a href="/"><span aria-hidden="true">←</span>${copy.action}</a>
      <div class="note">${copy.note}</div>
    </div>
    <span class="orbit" aria-hidden="true"></span>
  </main>
</body>
</html>`;
}

export function publicNotFound(request) {
    const language = preferredLanguage(request);
    const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Language": language,
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    });
    return new Response(request.method === "HEAD" ? null : document(language), {
        status: 404,
        headers,
    });
}
