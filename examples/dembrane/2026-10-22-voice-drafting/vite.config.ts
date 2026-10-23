import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare(), tailwindcss()],
  // packages/voice-google is used as source and only peers on agents, so its
  // imports of agents resolve from this app (deploys install it on its own).
  // React too: this app has a newer one than the workspace's agents, whose
  // partysocket would otherwise bring a second copy and break every hook.
  resolve: { dedupe: ["agents", "react", "react-dom"] }
});
