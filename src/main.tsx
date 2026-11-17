import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/lib/app-context";
import App from "./App";
import "./index.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppProvider>
        <App />
      </AppProvider>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  </React.StrictMode>,
);
