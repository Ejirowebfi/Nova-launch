import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initPWA } from "./services/pwa";

// Initialize PWA
initPWA().catch((error) => {
  console.warn("PWA initialization failed:", error);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
