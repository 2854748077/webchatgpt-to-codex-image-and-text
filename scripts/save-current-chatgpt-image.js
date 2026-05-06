#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function main() {
  const [, , outputPath] = process.argv;
  if (!outputPath) {
    throw new Error("Usage: node scripts/save-current-chatgpt-image.js <output-path>");
  }

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  try {
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes("chatgpt.com"));
    if (!page) {
      throw new Error("No ChatGPT page found.");
    }

    const image = page.locator("img").filter({
      hasNot: page.locator('[src*="auth0.com"]'),
    }).last();

    const count = await page.locator("img").count();
    if (count === 0) {
      throw new Error("No images found on ChatGPT page.");
    }

    const src = await page.locator("img").evaluateAll((images) => {
      return images
        .map((img) => ({
          src: img.currentSrc || img.src || "",
          area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0),
        }))
        .filter((item) => item.src.includes("/backend-api/estuary/content"))
        .sort((a, b) => b.area - a.area)[0]?.src || "";
    });

    if (!src) {
      throw new Error("No generated ChatGPT image URL found.");
    }

    const bufferBase64 = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    }, src);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(bufferBase64, "base64"));
    console.log(`Saved: ${outputPath}`);

    await image.count().catch(() => 0);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
