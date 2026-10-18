import { defineConfig } from 'vite';

// GitHub Pages(https://jangwoo0827.github.io/ai-roundtable/)에서는 하위 경로로 배포한다.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/ai-roundtable/' : '/',
});
