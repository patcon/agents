import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare(), tailwindcss()],
  // The workspace has two React copies: this example resolves react 19.2.8,
  // while `agents` -> `partysocket` was installed against 19.2.7. Without
  // this, Vite pre-bundles `partysocket/react` with its own React and
  // `useAgent` throws "Invalid hook call".
  resolve: { dedupe: ["react", "react-dom"] }
});
