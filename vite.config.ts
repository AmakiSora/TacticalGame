import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',

  build: {
    outDir: '../dist-public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'public/index.html'),
        play: resolve(__dirname, 'public/play.html'),
        'play-m': resolve(__dirname, 'public/play-m.html'),
        spectator: resolve(__dirname, 'public/spectator.html'),
        'spectator-m': resolve(__dirname, 'public/spectator-m.html'),
        'map-editor': resolve(__dirname, 'public/map-editor.html'),
        stats: resolve(__dirname, 'public/stats.html'),
        entertainment: resolve(__dirname, 'public/entertainment.html'),
        leaderboard: resolve(__dirname, 'public/leaderboard.html'),
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // 保留 console，生产环境可改为 true
        drop_debugger: true,
      },
    },
    sourcemap: true, // 开发阶段保留 sourcemap
    chunkSizeWarningLimit: 1000,
  },

  server: {
    port: 5173, // Vite 默认端口，避免与后端冲突
    strictPort: false,
    open: '/index.html',
    proxy: {
      // 代理 API 请求到后端服务器
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        ws: true, // 支持 WebSocket/SSE
      },
    },
  },

  preview: {
    port: 4173,
    strictPort: false,
  },
});
