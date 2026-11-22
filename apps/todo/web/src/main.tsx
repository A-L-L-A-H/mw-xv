import React from "react";
import { createRoot } from "react-dom/client";
import "@moonwitness/ui/styles/tokens.css";
import "@moonwitness/ui/components.css";
import "./app.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
