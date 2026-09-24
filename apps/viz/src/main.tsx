// Global styles first, so feature stylesheets imported by components cascade
// after them and can refine a surface without raising selector specificity.
import "./design/tokens.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
