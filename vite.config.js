import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': process.env.BACKEND_URL || 'http://127.0.0.1:8080' } } });
