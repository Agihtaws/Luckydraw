import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Redirect all unknown routes to index.html for client-side routing
    historyApiFallback: true,
  },
});