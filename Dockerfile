# paged-doc-editor 渲染服务镜像：node + 系统 Chromium + Noto CJK 字体
#
# 构建：  docker build -t paged-doc-render .
# 运行：  docker run -p 8200:8200 paged-doc-render
# 验证：  curl -X POST localhost:8200/render -H 'Content-Type: application/json' -d @payload.json
#
# 字体合规：镜像只装 Noto CJK（SIL OFL），不装任何微软/中易专有字体；
# docker/fonts.conf 把 CSS 里的 SimSun/SimHei/KaiTi 字体名映射到 Noto CJK，渲染观感基本一致。

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-noto-cjk \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 字体名映射：SimSun→Noto Serif CJK SC、SimHei→Noto Sans CJK SC、KaiTi→Noto Serif CJK SC
COPY docker/fonts.conf /etc/fonts/conf.d/61-paged-doc-aliases.conf

# 用系统 Chromium，跳过 puppeteer 自带浏览器下载（render.js 读 PUPPETEER_EXECUTABLE_PATH）
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    HOST=0.0.0.0 \
    PORT=8200

WORKDIR /app
COPY package.json package-lock.json ./
# 镜像自带 npm 10 对 `devtools-protocol: "*"` 可选 peer 的解析与 npm 11 不一致（会误报 lock 缺包），
# 先升 npm@11 再 ci，保证 lock 严格复现
RUN npm install -g npm@11 --no-audit --no-fund
# --omit=dev 仍装 optionalDependencies（puppeteer 的 JS 库；浏览器下载已被上面的环境变量跳过）
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY server ./server

EXPOSE 8200
CMD ["node", "server/render-server.js"]
