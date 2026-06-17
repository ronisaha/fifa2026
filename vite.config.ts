import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom domain deployment -> served from root.
export default defineConfig({
  base: '/',
  plugins: [react()],
});
