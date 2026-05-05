const DEFAULT_SITE_URL = "https://www.zenin.capital";

export const SITE_URL = String(import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");

export function buildAbsoluteUrl(pathname = "/") {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SITE_URL}${normalizedPath}`;
}

export function setMetaTag(selector, attributes) {
  if (typeof document === "undefined") return;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

export function setLinkTag(selector, attributes) {
  if (typeof document === "undefined") return;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

export function applySeo({
  title,
  description,
  robots,
  pathname = "/",
  canonicalPath = pathname,
  ogTitle = title,
  ogDescription = description,
  ogImage = buildAbsoluteUrl("/og/zenin-capital-home.svg"),
  schema = []
}) {
  if (typeof document === "undefined") return;

  document.title = title;
  document.documentElement.setAttribute("lang", "en");

  if (description) {
    setMetaTag('meta[name="description"]', {
      name: "description",
      content: description
    });
  }

  if (robots) {
    setMetaTag('meta[name="robots"]', {
      name: "robots",
      content: robots
    });
  }

  setMetaTag('meta[property="og:title"]', {
    property: "og:title",
    content: ogTitle
  });
  setMetaTag('meta[property="og:description"]', {
    property: "og:description",
    content: ogDescription
  });
  setMetaTag('meta[property="og:type"]', {
    property: "og:type",
    content: "website"
  });
  setMetaTag('meta[property="og:url"]', {
    property: "og:url",
    content: buildAbsoluteUrl(pathname)
  });
  setMetaTag('meta[property="og:image"]', {
    property: "og:image",
    content: ogImage
  });
  setMetaTag('meta[name="twitter:title"]', {
    name: "twitter:title",
    content: ogTitle
  });
  setMetaTag('meta[name="twitter:description"]', {
    name: "twitter:description",
    content: ogDescription
  });
  setMetaTag('meta[name="twitter:image"]', {
    name: "twitter:image",
    content: ogImage
  });
  setLinkTag('link[rel="canonical"]', {
    rel: "canonical",
    href: buildAbsoluteUrl(canonicalPath)
  });

  let script = document.head.querySelector('script[data-zenin-schema="page"]');
  if (!script) {
    script = document.createElement("script");
    script.setAttribute("type", "application/ld+json");
    script.setAttribute("data-zenin-schema", "page");
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
}
