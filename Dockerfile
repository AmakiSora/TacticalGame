# Build the TypeScript service with its locked development dependencies.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Install the runtime dependency set separately to keep the final image small.
FROM node:24-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# 强化学习 AI 运行时：src/api/bots.ts 会以子进程拉起 rl/run_model.py，
# 需要 python 虚拟环境与训练模型（CPU 版 torch）。
# 部署目标为国内 VPS，apt/pip 使用阿里云镜像加速；
# torch 从阿里云 pytorch-wheels 的 cpu 目录取 CPU-only 轮子，避免引入 CUDA 依赖。
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/rl-venv

COPY rl/requirements.txt /tmp/rl-requirements.txt
RUN /opt/rl-venv/bin/pip install --no-cache-dir \
      --find-links https://mirrors.aliyun.com/pytorch-wheels/cpu/ \
      --index-url https://mirrors.aliyun.com/pypi/simple/ torch \
  && /opt/rl-venv/bin/pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r /tmp/rl-requirements.txt \
  && rm /tmp/rl-requirements.txt

ENV RL_PYTHON=/opt/rl-venv/bin/python

COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
COPY maps ./maps
COPY rl ./rl

RUN groupadd --system tactical && useradd --system --gid tactical --home-dir /app tactical \
  && mkdir /app/runtime \
  && chown -R tactical:tactical /app

USER tactical

EXPOSE 3123

CMD ["npm", "start"]
