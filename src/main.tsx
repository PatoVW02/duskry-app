import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyDetectedWindowMaterial } from "./lib/windowMaterial";

// The HTML starts in solid mode. Capability detection only removes that safe
// fallback on platforms where the configured native material is supported.
void applyDetectedWindowMaterial();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
