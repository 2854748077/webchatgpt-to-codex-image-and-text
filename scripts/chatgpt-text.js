#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const CHATGPT_URL = "https://chatgpt.com/";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_FILE = path.resolve(process.cwd(), "output", "chatgpt-text-session.json");

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const options = parseOptions(args);
  if (command === "session") {
    await handleSessionCommand(args, options);
    return;
  }

  if (command === "ask" || command === "generate") {
    await askChatGpt(options);
    return;
  }

  if (command === "check") {
    await checkDebugger(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/chatgpt-text.js check [--cdp-url http://127.0.0.1:9222] [--port 9222]
  node scripts/chatgpt-text.js session status|open|clear [--session-file ./session.json]
  node scripts/chatgpt-text.js ask --prompt "your prompt" [--output ./answer.txt]
                              [--new-chat] [--reset-session] [--allow-new-chat]
                              [--session-file ./session.json] [--timeout 300000]
                              [--cdp-url http://127.0.0.1:9222] [--port 9222]
  node scripts/chatgpt-text.js ask --prompt-file ./prompt.txt --output ./answer.md

Examples:
  node scripts/chatgpt-text.js check
  node scripts/chatgpt-text.js session status
  node scripts/chatgpt-text.js ask --prompt "Continue in the saved text session"
  node scripts/chatgpt-text.js ask --prompt "Start a new saved text session" --new-chat
  node scripts/chatgpt-text.js ask --prompt-file .\\prompt.txt --output .\\output\\answer.md
`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

async function askChatGpt(options) {
  const prompt = readPrompt(options);
  const timeoutMs = Number(options.timeout || DEFAULT_TIMEOUT_MS);
  const cdpUrl = resolveCdpUrl(options);
  const sessionFile = resolveSessionFile(options);
  const explicitNewSession = Boolean(options["new-chat"] || options["reset-session"]);
  const allowNewSession = Boolean(options["allow-new-chat"] || explicitNewSession);

  await assertDebuggerReachable(cdpUrl);
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const page = await resolveTextSessionPage(browser, {
      sessionFile,
      allowNewSession,
      explicitNewSession,
      timeoutMs,
    });
    await ensureChatGptPage(page);
    await ensureReady(page, timeoutMs);

    const baseline = await collectResponseState(page);
    await submitPrompt(page, prompt);
    const answer = await waitForTextResponse(page, baseline, prompt, timeoutMs);
    await saveSessionFromPage(page, sessionFile);

    if (options.output) {
      const outputPath = path.resolve(String(options.output));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, answer, "utf8");
      console.log(`Saved text response: ${outputPath}`);
      return;
    }

    console.log(answer);
  } finally {
    await browser.close();
  }
}

async function handleSessionCommand(args, options) {
  const action = args.find((arg) => !arg.startsWith("--")) || "status";
  const sessionFile = resolveSessionFile(options);
  if (action === "status") {
    const session = readSession(sessionFile);
    if (!session) {
      console.log(`No saved text session: ${sessionFile}`);
      return;
    }
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  if (action === "clear") {
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    console.log(`Cleared text session: ${sessionFile}`);
    return;
  }

  if (action === "open") {
    const session = readSession(sessionFile);
    if (!session || !session.sessionUrl) {
      throw new Error(`No saved text session to open: ${sessionFile}`);
    }
    const cdpUrl = resolveCdpUrl(options);
    await assertDebuggerReachable(cdpUrl);
    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const page = await resolvePage(browser);
      await gotoWithRetry(page, session.sessionUrl);
      await ensureReady(page, Number(options.timeout || DEFAULT_TIMEOUT_MS));
      console.log(`Opened text session: ${session.sessionUrl}`);
    } finally {
      await browser.close();
    }
    return;
  }

  throw new Error(`Unknown session command: ${action}`);
}

function readPrompt(options) {
  if (typeof options["prompt-file"] === "string" && options["prompt-file"].trim()) {
    return fs.readFileSync(path.resolve(options["prompt-file"]), "utf8").trim();
  }
  if (typeof options.prompt === "string" && options.prompt.trim()) {
    return options.prompt.trim();
  }
  throw new Error('Missing required argument: --prompt "your prompt" or --prompt-file ./prompt.txt');
}

async function checkDebugger(options) {
  const cdpUrl = resolveCdpUrl(options);
  const details = await fetchDebuggerVersion(toDebuggerVersionUrl(cdpUrl));
  if (!details) {
    throw new Error(`Remote debugging is unavailable on ${toDebuggerVersionUrl(cdpUrl)}.`);
  }
  console.log(`Remote debugging is ready: ${toDebuggerVersionUrl(cdpUrl)}`);
  if (details.Browser) console.log(`Browser: ${details.Browser}`);
  if (details.webSocketDebuggerUrl) console.log(`WebSocket: ${details.webSocketDebuggerUrl}`);
}

async function resolvePage(browser) {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("No Chrome context found via CDP.");
  }
  const context = contexts[0];
  const pages = context.pages();
  const chatgptPage = pages.find((page) => page.url().includes("chatgpt.com"));
  if (chatgptPage) return chatgptPage;
  if (pages.length > 0) return pages[pages.length - 1];
  return await context.newPage();
}

async function resolveTextSessionPage(browser, options) {
  const session = readSession(options.sessionFile);
  const page = await resolvePage(browser);

  if (options.explicitNewSession) {
    await gotoWithRetry(page, CHATGPT_URL);
    await ensureReady(page, options.timeoutMs);
    return page;
  }

  if (session && session.sessionUrl) {
    await gotoWithRetry(page, session.sessionUrl);
    await ensureReady(page, options.timeoutMs).catch((error) => {
      throw new Error(
        `Saved text session is unavailable and automatic session replacement is blocked. ` +
        `Run with --allow-new-chat or explicitly use --new-chat/--reset-session if you want to replace it. ` +
        `Session: ${session.sessionUrl}. Cause: ${error.message}`
      );
    });

    if (!page.url().includes("/c/")) {
      if (options.allowNewSession) {
        await gotoWithRetry(page, CHATGPT_URL);
        await ensureReady(page, options.timeoutMs);
        return page;
      }
      throw new Error(
        `Saved text session did not open as a ChatGPT conversation and automatic session replacement is blocked. ` +
        `Run with --allow-new-chat or --new-chat only if you approve replacing the session. Current URL: ${page.url()}`
      );
    }
    return page;
  }

  if (!options.allowNewSession) {
    throw new Error(
      `No saved text session found: ${options.sessionFile}. ` +
      `Run once with --allow-new-chat or --new-chat if you approve creating the initial text session.`
    );
  }

  await gotoWithRetry(page, CHATGPT_URL);
  await ensureReady(page, options.timeoutMs);
  return page;
}

function resolveSessionFile(options) {
  if (typeof options["session-file"] === "string" && options["session-file"].trim()) {
    return path.resolve(options["session-file"]);
  }
  return DEFAULT_SESSION_FILE;
}

function readSession(sessionFile) {
  if (!fs.existsSync(sessionFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch (error) {
    throw new Error(`Could not read text session file: ${sessionFile}. ${error.message}`);
  }
}

async function saveSessionFromPage(page, sessionFile) {
  const url = page.url();
  if (!url.includes("chatgpt.com") || !url.includes("/c/")) return;
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  const previous = fs.existsSync(sessionFile) ? readSession(sessionFile) : null;
  const now = new Date().toISOString();
  const session = {
    sessionUrl: url,
    createdAt: previous && previous.createdAt ? previous.createdAt : now,
    updatedAt: now,
    title: sanitizeSessionTitle(await page.title().catch(() => "")),
  };
  fs.writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

function sanitizeSessionTitle(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 120);
}

async function ensureChatGptPage(page) {
  if (page.url().includes("chatgpt.com")) return;
  await gotoWithRetry(page, CHATGPT_URL);
}

async function gotoWithRetry(page, url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500 * attempt).catch(() => {});
    }
  }
  throw lastError;
}

async function ensureReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return Boolean(
        Array.from(document.querySelectorAll('[contenteditable="true"], textarea'))
          .find((element) => visible(element))
      );
    }).catch(() => false);
    if (ready) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for the ChatGPT composer.");
}

async function submitPrompt(page, prompt) {
  const inserted = await insertPromptIntoComposer(page, prompt);
  if (!inserted) {
    throw new Error("Could not find a writable ChatGPT input box.");
  }
  await page.waitForTimeout(300);

  const actualText = await readComposerText(page);
  if (!actualText.includes(prompt)) {
    throw new Error(`Composer text verification failed. Expected full prompt, got: ${actualText}`);
  }

  if (await clickSendButton(page)) return;
  await page.keyboard.press("Control+Enter").catch(() => {});
  await page.waitForTimeout(1000);
  if (await isGenerating(page)) return;
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(1000);
  if (await isGenerating(page)) return;
  throw new Error("Prompt was filled, but the ChatGPT send button could not be clicked.");
}

async function insertPromptIntoComposer(page, prompt) {
  const selectors = [
    "div#prompt-textarea",
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    "textarea",
  ];
  for (const selector of selectors) {
    const target = await findVisibleElementHandle(page, selector);
    if (!target) continue;
    const box = await target.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(prompt);
    return true;
  }
  return false;
}

async function findVisibleElementHandle(page, selector) {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    const visible = await handle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0";
    }).catch(() => false);
    if (visible) return handle;
    await handle.dispose().catch(() => {});
  }
  return null;
}

async function findComposer(page) {
  const editable = await firstActuallyVisible(page, '[contenteditable="true"][role="textbox"], [contenteditable="true"]');
  if (editable) return editable;
  const textbox = await firstActuallyVisible(page, "textarea");
  if (textbox) return textbox;
  throw new Error("Could not find a writable ChatGPT input box.");
}

async function firstActuallyVisible(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await isActuallyVisible(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function isActuallyVisible(locator) {
  if (!await locator.count()) return false;
  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) return false;
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }).catch(() => false);
}

async function readComposerText(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const editable = Array.from(document.querySelectorAll('[contenteditable="true"]')).find(visible);
    if (editable) return editable.textContent || "";
    const textarea = Array.from(document.querySelectorAll("textarea")).find(visible);
    if (textarea) return textarea.value || "";
    return "";
  }).catch(() => "");
}

async function clickSendButton(page) {
  const selectors = [
    '[data-testid="send-button"]',
    '[data-testid="composer-submit-button"]',
    'button[data-testid*="send"]',
    'button[data-testid*="submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="提交"]',
  ];
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const button = page.locator(selector).last();
      if (await button.count() && await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click();
        return true;
      }
    }
    const clicked = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const candidate = Array.from(document.querySelectorAll("button"))
        .filter((button) => visible(button))
        .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true")
        .map((button) => {
          const text = [button.innerText, button.textContent, button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.getAttribute("title")].filter(Boolean).join(" ");
          const rect = button.getBoundingClientRect();
          return { button, text, rect };
        })
        .filter((item) => /send|submit|发送|提交|arrow-up|向上/i.test(item.text))
        .sort((a, b) => (b.rect.y - a.rect.y) || (b.rect.x - a.rect.x))[0];
      if (!candidate) return false;
      candidate.button.click();
      return true;
    }).catch(() => false);
    if (clicked) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForTextResponse(page, baseline, prompt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableText = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    const current = await collectResponseState(page);
    const answer = getLatestNewAssistantText(baseline, current, prompt);
    const generating = await isGenerating(page);

    if (answer && !generating) {
      if (answer === stableText) {
        if (Date.now() - stableSince >= 1500) return answer;
      } else {
        stableText = answer;
        stableSince = Date.now();
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for ChatGPT text response.");
}

async function collectResponseState(page) {
  return page.evaluate(() => {
    const textOf = (element) => (element.innerText || element.textContent || "").trim();
    const messageNodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    const messages = messageNodes
      .map((element) => ({
        role: element.getAttribute("data-message-author-role"),
        text: textOf(element),
      }))
      .filter((message) => message.role && message.text);
    const assistants = messages.filter((message) => message.role === "assistant").map((message) => message.text);
    const users = messages.filter((message) => message.role === "user").map((message) => message.text);
    return {
      assistants,
      users,
      messages,
      bodyText: document.body.innerText || "",
    };
  }).catch(() => ({ assistants: [], users: [], messages: [], bodyText: "" }));
}

function getLatestNewAssistantText(baseline, current, prompt) {
  const baselineMessageCount = Array.isArray(baseline.messages) ? baseline.messages.length : 0;
  const currentMessages = Array.isArray(current.messages) ? current.messages : [];
  const newMessages = currentMessages.slice(baselineMessageCount);
  const promptIndex = newMessages.findIndex((message) => {
    return message.role === "user" && message.text && message.text.includes(prompt);
  });
  if (promptIndex >= 0) {
    const assistant = newMessages.slice(promptIndex + 1).find((message) => message.role === "assistant" && message.text);
    if (assistant) return assistant.text.trim();
  }

  if (current.users.length <= baseline.users.length) {
    return "";
  }

  if (current.assistants.length > baseline.assistants.length) {
    return current.assistants[current.assistants.length - 1].trim();
  }

  if (current.bodyText.startsWith(baseline.bodyText)) {
    const diff = current.bodyText.slice(baseline.bodyText.length).trim();
    if (diff) return cleanupFallbackText(diff);
  }
  return "";
}

function cleanupFallbackText(text) {
  return text
    .replace(/ChatGPT 也可能会犯错。[\s\S]*$/i, "")
    .replace(/查看 Cookie 首选项。?$/i, "")
    .trim();
}

async function isGenerating(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).some((button) => {
      const text = [button.innerText, button.textContent, button.getAttribute("aria-label"), button.getAttribute("data-testid")].filter(Boolean).join(" ");
      return /stop|停止|composer-stop/i.test(text);
    }) || /正在思考|正在生成|Thinking|Generating/i.test(document.body.innerText || "");
  }).catch(() => false);
}

function resolveCdpUrl(options) {
  if (typeof options["cdp-url"] === "string" && options["cdp-url"].trim()) {
    return String(options["cdp-url"]).replace(/\/+$/, "");
  }
  const port = Number(options.port || DEBUG_PORT);
  return `http://127.0.0.1:${port}`;
}

async function assertDebuggerReachable(cdpUrl) {
  const ok = await fetchDebuggerVersion(toDebuggerVersionUrl(cdpUrl));
  if (!ok) {
    throw new Error(`Remote debugging is unavailable on ${toDebuggerVersionUrl(cdpUrl)}.`);
  }
}

function toDebuggerVersionUrl(cdpUrl) {
  return `${cdpUrl.replace(/\/+$/, "")}/json/version`;
}

async function fetchDebuggerVersion(versionUrl) {
  return new Promise((resolve) => {
    const request = http.get(versionUrl, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve(null);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    request.on("error", () => resolve(null));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
