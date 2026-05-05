import React from "react";
import { renderToString } from "react-dom/server";
import PublicHomepage from "./PublicHomepage";

export function renderPublicHomepage() {
  return renderToString(
    <React.StrictMode>
      <PublicHomepage />
    </React.StrictMode>
  );
}
