# Build the TypeScript service with its locked development dependencies.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
# 前端构建：vite（root=public）需 public/ 源与 vite.config.ts，copy-static.mjs 补拷 icons/data。
COPY vite.config.ts ./
COPY public ./public
COPY script/copy-static.mjs ./script/
COPY src ./src
# 构建期 tsc 需解析 src/api/{bots,arenaEval}.ts 对 algorithms/registry.mjs 的
# import（类型声明 registry.d.mts）；运行时依赖算法子进程，见下方 runtime 阶段的 COPY。
COPY algorithms ./algorithms
RUN npm run build && npm run build:frontend

# Install the runtime dependency set separately to keep the final image small.
FROM node:24-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# 强化学习 AI 运行时：src/api/bots.ts 会以子进程拉起 rl/runners/run_model.py，
# 需要 python 虚拟环境与训练模型（CPU 版 torch）。
# 部署目标为国内 VPS，apt/pip 使用阿里云镜像加速；
# torch 从阿里云 pytorch-wheels 的 cpu 目录取 CPU-only 轮子，避免引入 CUDA 依赖。
# 必须钉住 +cpu 版本：cpu 镜像站同步滞后于 PyPI，不钉版本时 pip 会解析到
# 更高版本的 CUDA 版 torch（连带数 GB 的 nvidia 依赖），2GB 内存的 VPS 直接 OOM。
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/rl-venv

COPY rl/requirements.txt /tmp/rl-requirements.txt
RUN /opt/rl-venv/bin/pip install --no-cache-dir \
      --find-links https://mirrors.aliyun.com/pytorch-wheels/cpu/ \
      --index-url https://mirrors.aliyun.com/pypi/simple/ torch==2.13.0+cpu \
  && /opt/rl-venv/bin/pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r /tmp/rl-requirements.txt \
  && rm /tmp/rl-requirements.txt

ENV RL_PYTHON=/opt/rl-venv/bin/python

# 先建用户再 COPY，各条 COPY 用 --chown 直接落属主，取代 COPY 后 chown -R
# （chown -R 会把 node_modules/rl 整体复制进额外镜像层，凭空多出数百 MB）。
# /app 与 runtime 目录本身必须属 tactical：named volume 首次挂载会继承镜像内目录属主。
RUN groupadd --system tactical && useradd --system --gid tactical --home-dir /app tactical \
  && mkdir -p /app/runtime \
  && chown tactical:tactical /app /app/runtime

COPY --from=production-deps --chown=tactical:tactical /app/node_modules ./node_modules
COPY --chown=tactical:tactical package.json ./
COPY --from=build --chown=tactical:tactical /app/dist ./dist
# 前端托管 dist-public（Vite 产物：压缩 + hash 化 + icons/data 补拷），不再拷源目录 public。
COPY --from=build --chown=tactical:tactical /app/dist-public ./dist-public
COPY --chown=tactical:tactical maps ./maps
# 算法 AI：src/api/bots.ts 会以子进程拉起 node algorithms/runner.mjs，镜像必须携带。
COPY --chown=tactical:tactical algorithms ./algorithms
# 评估控制台所需的榜单/统计脚本按设计不进镜像：评估跑批是本地开发功能
# （见 src/api/arenaEval.ts 头注），线上相关写接口返回 501 而不是 spawn ENOENT 的坏 500。
COPY --chown=tactical:tactical rl ./rl
# agent 通过 /api/skill* 接口拉取最新 skill，镜像需携带权威 skill 目录。
COPY --chown=tactical:tactical skill ./skill
# 观战页 /api/records* 浏览历史回放：归档目录必须随镜像发布，
# 否则线上「回放库」列表为空（.dockerignore 已放行 records/）。
COPY --chown=tactical:tactical records ./records

USER tactical

EXPOSE 3123

CMD ["npm", "start"]
