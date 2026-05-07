#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const { chromium } = require("playwright");

const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const CHATGPT_URL = "https://chatgpt.com/";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "output", "chatgpt-images");
const DEFAULT_CHROME_USER_DATA_DIR = getSystemChromeUserDataDir();
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const IMAGE_PROMPT_PREFIX = "生成照片：";
const DEFAULT_TEXT_RETRY_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_TEXT_RETRIES = 2;
const DEFAULT_IMAGE_PROJECT = "333";
const FALLBACK_IMAGE_PROJECT = "222";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "launch") {
    await launchChrome(parseOptions(args));
    return;
  }

  if (command === "generate") {
    await generateImage(parseOptions(args));
    return;
  }

  if (command === "move-project" || command === "move-to-project") {
    await moveCurrentChatCommand(parseOptions(args));
    return;
  }

  if (command === "check") {
    await checkDebugger(parseOptions(args));
    return;
  }

  if (command === "validate") {
    validateImageCommand(parseOptions(args));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/chatgpt-image.js launch [--profile Default] [--url https://chatgpt.com/] [--force-close]
                                       [--user-data-dir ./output/chrome-automation-profile] [--system-profile]
  node scripts/chatgpt-image.js check [--cdp-url http://127.0.0.1:9222] [--port 9222]
  node scripts/chatgpt-image.js validate --image ./output/chatgpt-images/example.png
  node scripts/chatgpt-image.js move-project --project "333" [--cdp-url http://127.0.0.1:9222] [--port 9222]
  node scripts/chatgpt-image.js generate --prompt "your prompt" [--output ./output/chatgpt-images]
                                     [--timeout 480000] [--cdp-url http://127.0.0.1:9222] [--port 9222]
                                     [--reference ./ref.png] [--references ./refs.txt]
                                     [--project "333"] [--no-project]
                                     [--new-chat] [--validate]

Examples:
  node scripts/chatgpt-image.js launch
  node scripts/chatgpt-image.js check
  node scripts/chatgpt-image.js check --cdp-url http://127.0.0.1:9222
  node scripts/chatgpt-image.js move-project --project "333"
  node scripts/chatgpt-image.js generate --prompt "A cinematic fox warrior, ultra detailed"
  node scripts/chatgpt-image.js generate --prompt "Use the uploaded image as reference" --reference .\\ref.png
  node scripts/chatgpt-image.js generate --prompt "cat" --project "333"

Notes:
  1. "launch" starts your local Chrome with remote debugging enabled on port ${DEBUG_PORT}.
  2. By default it uses your system Chrome profile at ${DEFAULT_CHROME_USER_DATA_DIR}.
  3. Fully close Chrome first, or use --force-close, so Chrome accepts the remote debugging flags.
  4. Use --user-data-dir if you explicitly want an isolated automation profile.
  5. "check" only verifies that an existing CDP endpoint is reachable.
  6. "generate" prefers an already-open ChatGPT conversation tab, then any ChatGPT tab.
  7. Pass --new-chat only when you want a separate new ChatGPT tab for the generation.
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

    if (Object.prototype.hasOwnProperty.call(options, key)) {
      options[key] = Array.isArray(options[key]) ? [...options[key], next] : [options[key], next];
    } else {
      options[key] = next;
    }
    index += 1;
  }
  return options;
}

function getChromeExecutable() {
  const candidates = [
    path.join(process.env["ProgramFiles"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Chrome executable not found. Expected chrome.exe under Program Files.");
}

function getSystemChromeUserDataDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Google", "Chrome", "User Data");
}

async function launchChrome(options) {
  const chromeExecutable = getChromeExecutable();
  const userDataDir = resolveChromeUserDataDir(options);
  const profile = String(options.profile || "Default");
  const startUrl = String(options.url || CHATGPT_URL);
  const forceClose = Boolean(options["force-close"]);

  if (!fs.existsSync(userDataDir) && (Boolean(options["system-profile"]) || userDataDir === getSystemChromeUserDataDir())) {
    throw new Error(`Chrome user data dir not found: ${userDataDir}`);
  }

  fs.mkdirSync(userDataDir, { recursive: true });

  if (forceClose) {
    await closeChromeProcesses();
  }

  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    startUrl,
  ];

  spawn(chromeExecutable, chromeArgs, {
    detached: true,
    stdio: "ignore",
  }).unref();

  const ready = await waitForDebuggerEndpoint(15000);
  if (!ready) {
    throw new Error(
      `Chrome was started, but remote debugging is still unavailable on http://127.0.0.1:${DEBUG_PORT}. ` +
      `Current user data dir: ${userDataDir}. ` +
      `Retry with: npm run chatgpt:launch -- --force-close`
    );
  }

  console.log(`Chrome launched with remote debugging on http://127.0.0.1:${DEBUG_PORT}`);
  console.log(`Chrome user data dir: ${userDataDir}`);
}

function resolveChromeUserDataDir(options) {
  if (typeof options["user-data-dir"] === "string" && options["user-data-dir"].trim()) {
    return path.resolve(String(options["user-data-dir"]));
  }

  if (Boolean(options["system-profile"])) {
    return getSystemChromeUserDataDir();
  }

  return getSystemChromeUserDataDir();
}

async function generateImage(options) {
  const rawPrompt = options.prompt;
  if (!rawPrompt || typeof rawPrompt !== "string") {
    throw new Error('Missing required argument: --prompt "your prompt"');
  }
  const prompt = normalizeImagePrompt(rawPrompt);

  const outputDir = path.resolve(String(options.output || DEFAULT_OUTPUT_DIR));
  const timeoutMs = Number(options.timeout || DEFAULT_TIMEOUT_MS);
  const textRetryDelayMs = Number(options["text-retry-delay"] || DEFAULT_TEXT_RETRY_DELAY_MS);
  const maxTextRetries = Number(options["text-retries"] || DEFAULT_MAX_TEXT_RETRIES);
  const cdpUrl = resolveCdpUrl(options);
  const referencePaths = resolveReferencePaths(options);
  const projectPlan = resolveImageProjectPlan(options);
  const projectTimeoutMs = Number(options["project-timeout"] || 60000);

  fs.mkdirSync(outputDir, { recursive: true });

  await assertDebuggerReachable(cdpUrl);

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    let page = await resolvePage(browser);
    for (let attempt = 0; attempt <= maxTextRetries; attempt += 1) {
      if (options["new-chat"] || attempt > 0) {
        page = await openNewChatTab(browser);
      }
      await ensureChatGptPage(page);
      await ensureReady(page, timeoutMs);
      if (referencePaths.length > 0) {
        await activateImageGenerationMode(page);
        await uploadReferenceImages(page, referencePaths, timeoutMs);
      }

      const attemptPrompt = buildAttemptPrompt(prompt, attempt);
      const baselineKeys = await collectImageKeys(page);
      const baselineAssistantImages = await collectAssistantImageState(page);
      const baselineText = await collectPageText(page);
      console.log(`Prompt: ${attemptPrompt}`);
      await submitPrompt(page, attemptPrompt);

      try {
        const imageRef = await waitForGeneratedImage(page, baselineKeys, timeoutMs, {
          baselineAssistantImages,
          baselineText,
          textRetryDelayMs,
        });
        const savedPath = await saveImage(page, imageRef, outputDir);
        console.log(`Saved image: ${savedPath}`);
        if (options.validate) {
          const result = validateImageFile(savedPath, options);
          printValidationResult(result);
          if (!result.pass) {
            throw new Error(`Generated image failed quality validation: ${result.failures.join("; ")}`);
          }
        }
        if (projectPlan.enabled) {
          const movedProject = await moveCurrentChatToProject(page, projectPlan, projectTimeoutMs);
          console.log(`Moved chat to project: ${movedProject}`);
        }
        return;
      } catch (error) {
        if (error && error.code === "TEXT_ONLY_RESPONSE" && attempt < maxTextRetries) {
          console.warn(`Text-only response detected; retrying with a stronger image prompt (${attempt + 1}/${maxTextRetries}).`);
          continue;
        }
        throw error;
      }
    }
  } finally {
    await browser.close();
  }
}

async function moveCurrentChatCommand(options) {
  const projectName = String(options.project || options.to || "").trim();
  if (!projectName) {
    throw new Error('Missing required argument: --project "333"');
  }

  const cdpUrl = resolveCdpUrl(options);
  const projectTimeoutMs = Number(options["project-timeout"] || 60000);
  await assertDebuggerReachable(cdpUrl);

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const page = await resolveConversationPage(browser);
    await ensureChatGptPage(page);
    const movedProject = await moveCurrentChatToProject(page, {
      enabled: true,
      candidates: [projectName],
      createName: projectName,
    }, projectTimeoutMs);
    console.log(`Moved chat to project: ${movedProject}`);
  } finally {
    await browser.close();
  }
}

function normalizeImagePrompt(prompt) {
  const trimmed = prompt.trim();
  if (trimmed.startsWith(IMAGE_PROMPT_PREFIX)) {
    return trimmed;
  }

  return `${IMAGE_PROMPT_PREFIX}${trimmed}`;
}

function buildAttemptPrompt(prompt, attempt) {
  if (attempt === 0) {
    return prompt;
  }

  const content = prompt.startsWith(IMAGE_PROMPT_PREFIX) ? prompt.slice(IMAGE_PROMPT_PREFIX.length) : prompt;
  return `${IMAGE_PROMPT_PREFIX}请直接生成一张图片，不要回复文字说明，不要询问，不要解释。画面内容：${content}`;
}

function resolveImageProjectPlan(options) {
  if (options["no-project"]) {
    return { enabled: false, candidates: [], createName: "" };
  }

  if (typeof options.project === "string" && options.project.trim()) {
    const projectName = options.project.trim();
    return { enabled: true, candidates: [projectName], createName: projectName };
  }

  const envProject = process.env.CHATGPT_IMAGE_PROJECT;
  if (envProject && envProject.trim()) {
    const projectName = envProject.trim();
    return { enabled: true, candidates: [projectName], createName: projectName };
  }

  return {
    enabled: true,
    candidates: [DEFAULT_IMAGE_PROJECT, FALLBACK_IMAGE_PROJECT],
    createName: DEFAULT_IMAGE_PROJECT,
  };
}

function resolveReferencePaths(options) {
  const values = [];
  appendOptionValues(values, options.reference);
  appendOptionValues(values, options.references);
  appendOptionValues(values, options["reference-file"]);
  appendOptionValues(values, options["references-file"]);

  const paths = [];
  for (const value of values) {
    const resolved = path.resolve(String(value));
    if (!fs.existsSync(resolved)) {
      throw new Error(`Reference image or list not found: ${resolved}`);
    }

    if (fs.statSync(resolved).isDirectory()) {
      for (const file of fs.readdirSync(resolved)) {
        const candidate = path.join(resolved, file);
        if (fs.statSync(candidate).isFile() && isSupportedReferenceImage(candidate)) {
          paths.push(candidate);
        }
      }
      continue;
    }

    if (isReferenceListFile(resolved)) {
      const baseDir = path.dirname(resolved);
      const lines = fs.readFileSync(resolved, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      for (const line of lines) {
        const candidate = path.resolve(baseDir, line);
        if (!fs.existsSync(candidate)) {
          throw new Error(`Reference image listed in ${resolved} not found: ${candidate}`);
        }
        if (!fs.statSync(candidate).isFile() || !isSupportedReferenceImage(candidate)) {
          throw new Error(`Unsupported reference image listed in ${resolved}: ${candidate}`);
        }
        paths.push(candidate);
      }
      continue;
    }

    if (!isSupportedReferenceImage(resolved)) {
      throw new Error(`Unsupported reference image type: ${resolved}`);
    }
    paths.push(resolved);
  }

  return Array.from(new Set(paths));
}

function appendOptionValues(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) appendOptionValues(target, item);
    return;
  }
  target.push(value);
}

function isReferenceListFile(filePath) {
  return [".txt", ".list"].includes(path.extname(filePath).toLowerCase());
}

function isSupportedReferenceImage(filePath) {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(filePath).toLowerCase());
}

async function checkDebugger(options) {
  const cdpUrl = resolveCdpUrl(options);
  const versionUrl = toDebuggerVersionUrl(cdpUrl);
  const details = await fetchDebuggerVersion(versionUrl);

  if (!details) {
    throw new Error(
      `Remote debugging is unavailable on ${versionUrl}. ` +
      `Start Chrome yourself with --remote-debugging-port, or point --cdp-url to an existing instance.`
    );
  }

  console.log(`Remote debugging is ready: ${versionUrl}`);
  if (details.Browser) {
    console.log(`Browser: ${details.Browser}`);
  }
  if (details["User-Agent"]) {
    console.log(`User-Agent: ${details["User-Agent"]}`);
  }
  if (details.webSocketDebuggerUrl) {
    console.log(`WebSocket: ${details.webSocketDebuggerUrl}`);
  }
}

async function resolvePage(browser) {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("No Chrome context found via CDP.");
  }

  const context = contexts[0];
  const pages = context.pages().filter((page) => !page.isClosed());

  const existingConversationPage = await findBestChatGptConversationPage(pages);
  if (existingConversationPage) {
    return existingConversationPage;
  }

  const activeChatgptPage = await findBestChatGptPage(pages);
  if (activeChatgptPage) {
    return activeChatgptPage;
  }

  const activePage = await findActivePage(pages);
  if (activePage) {
    return activePage;
  }

  if (pages.length > 0) {
    return pages[pages.length - 1];
  }

  return await context.newPage();
}

async function openNewChatTab(browser) {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("No Chrome context found via CDP.");
  }
  const page = await contexts[0].newPage();
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
  return page;
}

async function resolveConversationPage(browser) {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("No Chrome context found via CDP.");
  }

  const pages = contexts[0].pages().filter((page) => !page.isClosed());
  for (const page of pages) {
    const state = await page.evaluate(() => {
      return {
        focused: document.hasFocus(),
        visible: document.visibilityState === "visible",
        url: window.location.href,
      };
    }).catch(() => null);
    if (state && isChatGptConversationUrl(state.url)) {
      return page;
    }
  }

  const page = await resolvePage(browser);
  if (!isChatGptConversationUrl(page.url())) {
    throw new Error("No active ChatGPT conversation tab found. Open the target conversation first.");
  }
  return page;
}

async function ensureChatGptPage(page) {
  if (page.url().includes("chatgpt.com")) {
    return;
  }

  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
}

async function findBestChatGptPage(pages) {
  let best = null;

  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }

    const state = await page.evaluate(() => {
      return {
        focused: document.hasFocus(),
        visible: document.visibilityState === "visible",
        url: window.location.href,
      };
    }).catch(() => null);

    if (!state || !state.url.includes("chatgpt.com")) {
      continue;
    }

    const score = (state.focused ? 2 : 0) + (state.visible ? 1 : 0);
    if (!best || score > best.score) {
      best = { page, score };
    }
  }

  return best ? best.page : null;
}

async function findBestChatGptConversationPage(pages) {
  let best = null;

  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }

    const state = await page.evaluate(() => {
      return {
        focused: document.hasFocus(),
        visible: document.visibilityState === "visible",
        url: window.location.href,
      };
    }).catch(() => null);

    if (!state || !isChatGptConversationUrl(state.url)) {
      continue;
    }

    const score = (state.focused ? 4 : 0) + (state.visible ? 2 : 0);
    if (!best || score > best.score) {
      best = { page, score };
    }
  }

  return best ? best.page : null;
}

async function findActivePage(pages) {
  let best = null;

  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }

    const state = await page.evaluate(() => {
      return {
        focused: document.hasFocus(),
        visible: document.visibilityState === "visible",
        url: window.location.href,
      };
    }).catch(() => null);

    if (!state) {
      continue;
    }

    const score =
      (state.focused ? 4 : 0) +
      (state.visible ? 2 : 0) +
      (state.url.includes("chatgpt.com") ? 1 : 0);

    if (!best || score > best.score) {
      best = { page, score };
    }
  }

  return best ? best.page : null;
}

async function ensureReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      return Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [data-testid='composer-text-input']"))
        .some((element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true");
    }).catch(() => false);
    if (ready) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the ChatGPT composer. Make sure the page is logged in and fully loaded.");
    }

    await page.waitForTimeout(1000);
  }
}

async function collectImageKeys(page) {
  return page.evaluate(() => {
    return Array.from(document.images)
      .map((img) => `${img.currentSrc || img.src}|${img.naturalWidth}x${img.naturalHeight}`)
      .filter(Boolean);
  });
}

async function collectAssistantImageState(page) {
  return page.evaluate(() => {
    const assistantNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    const keys = [];
    for (const node of assistantNodes) {
      for (const img of Array.from(node.querySelectorAll("img"))) {
        const src = img.currentSrc || img.src || "";
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (src) keys.push(`${src}|${width}x${height}`);
      }
    }
    return { count: assistantNodes.length, keys };
  }).catch(() => ({ count: 0, keys: [] }));
}

async function collectPageText(page) {
  return page.evaluate(() => document.body.innerText || "").catch(() => "");
}

async function uploadReferenceImages(page, referencePaths, timeoutMs) {
  if (!referencePaths.length) return;

  const before = await collectUploadState(page);
  const input = await findFileInput(page);
  if (input) {
    await input.setInputFiles(referencePaths);
  } else {
    const chooser = await openFileChooser(page, timeoutMs);
    await chooser.setFiles(referencePaths);
  }

  await waitForReferenceUploads(page, referencePaths, before, timeoutMs);
  console.log(`Reference images uploaded: ${referencePaths.length}`);
  for (const referencePath of referencePaths) {
    console.log(`- ${referencePath}`);
  }
}

async function findFileInput(page) {
  const handle = await page.evaluateHandle(() => {
    const selectors = [
      'input#upload-photos[type="file"]',
      'input#image-gen-action-modal-upload-photos[type="file"]',
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ];
    const inputs = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    return inputs.find((input) => {
      const accept = String(input.getAttribute("accept") || "").toLowerCase();
      return !accept || accept.includes("image") || accept.includes(".png") || accept.includes(".jpg") || accept.includes(".jpeg") || accept.includes(".webp");
    }) || null;
  }).catch(() => null);
  const element = handle ? handle.asElement() : null;
  if (!element) {
    await handle?.dispose().catch(() => {});
  }
  return element;
}

async function activateImageGenerationMode(page) {
  const clicked = await page.evaluate(() => {
    const imageLabel = String.fromCodePoint(0x751f, 0x6210, 0x56fe, 0x7247);
    const imageShortLabel = String.fromCodePoint(0x56fe, 0x7247);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const buttons = Array.from(document.querySelectorAll("button")).filter(visible);
    const candidate = buttons.find((button) => {
      const text = [
        button.innerText,
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("data-testid"),
        button.getAttribute("title"),
      ].filter(Boolean).join(" ");
      return text.includes(imageLabel) || text.includes(imageShortLabel) || /image|photo/i.test(text);
    });
    if (!candidate) return false;
    candidate.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    await page.waitForTimeout(1000);
  }
}

async function openFileChooser(page, timeoutMs) {
  const chooserPromise = page.waitForEvent("filechooser", { timeout: Math.min(timeoutMs, 30000) });
  if (await clickUploadButton(page)) {
    return chooserPromise;
  }
  throw new Error("Could not find ChatGPT upload button or file input for reference images.");
}

async function clickUploadButton(page) {
  return clickUploadButtonViaDom(page);
}

async function clickUploadButtonViaDom(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidate = Array.from(document.querySelectorAll("button"))
      .filter((button) => visible(button))
      .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true")
      .map((button) => {
        const text = [
          button.innerText,
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("data-testid"),
          button.getAttribute("title"),
        ].filter(Boolean).join(" ");
        const rect = button.getBoundingClientRect();
        return { button, text, rect };
      })
      .filter((item) => /attach|upload|add|plus|paperclip|添加|上传|附件|文件|娣诲姞|涓婁紶|闄勪欢|鏂囦欢/i.test(item.text))
      .sort((a, b) => (b.rect.y - a.rect.y) || (a.rect.x - b.rect.x))[0];
    if (!candidate) return false;
    candidate.button.click();
    return true;
  }).catch(() => false);
}

async function collectUploadState(page) {
  return page.evaluate(() => {
    const composer = document.querySelector("form") || document.body;
    const text = composer.innerText || "";
    const images = Array.from(composer.querySelectorAll("img"))
      .map((img) => `${img.currentSrc || img.src}|${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`)
      .filter(Boolean);
    const attachments = Array.from(composer.querySelectorAll('[data-testid*="attachment"], [data-testid*="file"], [aria-label*="Remove"], [aria-label*="移除"], [aria-label*="删除"]')).length;
    return { text, images, attachments };
  }).catch(() => ({ text: "", images: [], attachments: 0 }));
}

async function waitForReferenceUploads(page, referencePaths, before, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 120000);
  const fileNames = referencePaths.map((filePath) => path.basename(filePath).toLowerCase());
  while (Date.now() < deadline) {
    const state = await collectUploadState(page);
    const imageIncrease = state.images.length >= before.images.length + referencePaths.length;
    const attachmentIncrease = state.attachments >= before.attachments + referencePaths.length;
    const visibleNames = fileNames.every((name) => state.text.toLowerCase().includes(name));
    const busy = await isUploadBusy(page);
    if ((imageIncrease || attachmentIncrease || visibleNames) && !busy) return;
    await page.waitForTimeout(1000);
  }

  throw new Error(`Timed out waiting for ${referencePaths.length} reference image(s) to upload.`);
}

async function isUploadBusy(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    return /uploading|attaching|processing|上传中|正在上传|处理中/i.test(text);
  }).catch(() => false);
}

async function moveCurrentChatToProject(page, projectPlan, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const chatUrl = page.url();
  const chatId = extractConversationId(chatUrl);
  await closeOpenMenus(page);

  await openMoveToProjectMenu(page, deadline);
  for (const projectName of projectPlan.candidates) {
    const result = await clickProjectMenuItem(page, projectName);
    if (result.clicked) {
      await page.waitForTimeout(2000);
      if (!result.href && page.url().includes("/project")) {
        result.href = page.url();
      }
      await verifyChatInProject(page, {
        chatId,
        projectName,
        projectHref: result.href,
        deadline,
      });
      return projectName;
    }
  }

  if (!projectPlan.createName) {
    throw new Error(`Project not found in ChatGPT project menu: ${projectPlan.candidates.join(", ")}`);
  }

  await createProjectFromMoveMenu(page, projectPlan.createName, deadline);
  return projectPlan.createName;
}

async function openMoveToProjectMenu(page, deadline) {
  await waitUntil(deadline, async () => clickConversationOptionsButton(page), "Could not find ChatGPT conversation options button.");

  await waitUntil(deadline, async () => {
    if (await clickMenuItemByText(page, ["Move to project", "\u79fb\u81f3\u9879\u76ee"], { hover: true, click: true })) {
      return true;
    }
    return await clickMenuItemByText(page, ["Move to project", "移至项目"], { hover: true, click: true });
  }, `Could not open "Move to project" menu.`);

  await page.waitForTimeout(500);
}

async function createProjectFromMoveMenu(page, projectName, deadline) {
  const openedPreferred = await clickProjectMenuItem(page, "\u65b0\u9879\u76ee");
  if (openedPreferred.clicked) {
    await page.waitForTimeout(500);
  }
  const openedResult = await clickProjectMenuItem(page, "新项目");
  const openedFallback = openedResult.clicked ? openedResult : await clickProjectMenuItem(page, "New project");
  const opened = openedPreferred.clicked || openedFallback.clicked;
  if (!opened) {
    throw new Error(`Projects not found and could not open new project flow for: ${projectName}`);
  }

  await waitUntil(deadline, async () => {
    return await fillProjectNameField(page, projectName);
  }, `Could not find new project name field for: ${projectName}`);

  await waitUntil(deadline, async () => {
    if (await clickMenuItemByText(page, ["Create project", "Create", "\u521b\u5efa\u9879\u76ee", "\u521b\u5efa"], { click: true })) {
      return true;
    }
    return await clickMenuItemByText(page, ["Create project", "Create", "创建项目", "创建"], { click: true });
  }, `Could not create ChatGPT project: ${projectName}`);

  await page.waitForTimeout(3000);
}

function extractConversationId(url) {
  const match = String(url || "").match(/\/c\/([^/?#]+)/);
  return match ? match[1] : "";
}

function isChatGptConversationUrl(url) {
  return String(url || "").includes("chatgpt.com/") && /\/c\/[^/?#]+/.test(String(url || ""));
}

async function closeOpenMenus(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
  }).catch(() => {});
  await page.waitForTimeout(200).catch(() => {});
}

async function clickConversationOptionsButton(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const labels = ["Open conversation options", "\u6253\u5f00\u5bf9\u8bdd\u9009\u9879"];
    const button = Array.from(document.querySelectorAll("button")).find((element) => {
      const text = normalize([
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.getAttribute("title"),
      ].filter(Boolean).join(" "));
      return labels.some((label) => text.includes(label));
    });
    if (!button) return false;
    button.click();
    return true;
  }).catch(() => false);
}

async function waitUntil(deadline, action, message) {
  while (Date.now() < deadline) {
    if (await action()) return true;
    await sleep(500);
  }
  throw new Error(message);
}

async function clickMenuItemByText(page, labels, options = {}) {
  return page.evaluate(({ labels, hover, click }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll('[role="menuitem"], button, a'));
    const item = candidates.find((element) => {
      const text = normalize([
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.getAttribute("title"),
      ].filter(Boolean).join(" "));
      return labels.some((label) => text.includes(label));
    });
    if (!item) return false;
    if (hover) item.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    if (click) item.click();
    return true;
  }, { labels, hover: Boolean(options.hover), click: Boolean(options.click) }).catch(() => false);
}

async function clickProjectMenuItem(page, projectName) {
  return page.evaluate((projectName) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, rect };
      })
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
      .filter((item) => item.rect.x > 250);
    const item = candidates.find((element) => {
      const node = element.element;
      const text = normalize([
        node.innerText,
        node.textContent,
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
      ].filter(Boolean).join(" "));
      if (!text) return false;
      const tokens = Array.from(new Set(text.split(" ").filter(Boolean)));
      return text === projectName || tokens.includes(projectName) || text.includes(projectName);
    });
    if (!item) return { clicked: false, href: "" };
    const link = item.element.matches("a") ? item.element : item.element.closest("a") || item.element.querySelector("a");
    const href = (link && (link.href || link.getAttribute("href"))) || item.element.href || item.element.getAttribute("href") || "";
    item.element.click();
    return { clicked: true, href };
  }, projectName).catch(() => ({ clicked: false, href: "" }));
}

async function verifyChatInProject(page, details) {
  if (!details.chatId) {
    throw new Error(`Cannot verify project move because current URL is not a conversation URL.`);
  }
  if (!details.projectHref) {
    throw new Error(`Cannot verify project move because project link was not found: ${details.projectName}`);
  }

  const projectUrl = new URL(details.projectHref, page.url()).toString();
  await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: Math.max(1000, details.deadline - Date.now()) });
  await waitUntil(details.deadline, async () => {
    return page.evaluate((chatId) => {
      return Array.from(document.querySelectorAll("a"))
        .some((anchor) => String(anchor.href || "").includes(`/c/${chatId}`));
    }, details.chatId).catch(() => false);
  }, `Chat was not found in project after move: ${details.projectName}`);
}

async function fillProjectNameField(page, projectName) {
  const filled = await page.evaluate((value) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const input = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea')).find(visible);
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, projectName).catch(() => false);
  if (!filled) return false;
  await page.waitForTimeout(300);
  return true;
}

async function submitPrompt(page, prompt) {
  if (await insertPromptIntoComposer(page, prompt)) {
    const actualText = await readComposerText(page);
    if (!actualText.includes(prompt)) {
      throw new Error(`Composer text verification failed. Expected full prompt, got: ${actualText}`);
    }
    await sendComposer(page);
    return;
  }

  throw new Error("Could not find a writable ChatGPT input box.");
}

async function insertPromptIntoComposer(page, prompt) {
  const inserted = await page.evaluate((value) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const selectors = [
      "div#prompt-textarea",
      "[contenteditable='true'][role='textbox']",
      "[contenteditable='true']",
      "textarea",
    ];
    const target = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element, index, elements) => visible(element) && elements.indexOf(element) === index);
    if (!target) return false;

    target.focus();
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      target.value = value;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    target.textContent = "";
    const paragraph = document.createElement("p");
    paragraph.textContent = value;
    target.appendChild(paragraph);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, prompt).catch(() => false);
  if (!inserted) return false;
  await page.waitForTimeout(300);
  return true;
}

async function readComposerText(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const editable = Array.from(document.querySelectorAll('[contenteditable="true"]')).find(visible);
    if (editable) {
      return editable.textContent || "";
    }

    const textarea = Array.from(document.querySelectorAll("textarea")).find(visible);
    if (textarea) {
      return textarea.value || "";
    }

    return "";
  }).catch(() => "");
}

async function sendComposer(page) {
  if (await clickSendButton(page)) {
    await waitForComposerSubmitted(page);
    return;
  }

  throw new Error("Prompt was filled, but the ChatGPT send button could not be clicked.");
}

async function clickSendButton(page) {
  return clickSendButtonViaDom(page);
}

async function clickSendButtonViaDom(page) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const candidates = Array.from(document.querySelectorAll("button"))
        .filter((button) => isVisible(button))
        .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true")
        .map((button) => {
          const text = [
            button.innerText,
            button.textContent,
            button.getAttribute("aria-label"),
            button.getAttribute("data-testid"),
            button.getAttribute("title"),
          ].filter(Boolean).join(" ");
          const rect = button.getBoundingClientRect();
          return { button, text, rect };
        })
        .filter((item) => /send|submit|发送|提交|arrow-up|向上|鍙戦€亅鎻愰交|鎻愪氦|鍚戜笂/i.test(item.text))
        .sort((a, b) => (b.rect.y - a.rect.y) || (b.rect.x - a.rect.x));

      if (!candidates[0]) return false;
      candidates[0].button.click();
      return true;
    }).catch(() => false);

    if (clicked) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForComposerSubmitted(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const submitted = await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      const textarea = document.querySelector("textarea");
      const editableText = editable ? editable.textContent.trim() : "";
      const textareaText = textarea ? textarea.value.trim() : "";
      const stopButton = Array.from(document.querySelectorAll("button")).some((button) => {
        const text = [
          button.innerText,
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("data-testid"),
        ].filter(Boolean).join(" ");
        return /stop|停止|composer-stop/i.test(text);
      });
      return stopButton || (!editableText && !textareaText);
    }).catch(() => false);

    if (submitted) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

async function waitForGeneratedImage(page, baselineKeys, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  const baselineText = options.baselineText || "";
  const baselineAssistantImages = options.baselineAssistantImages || { count: 0, keys: [] };
  const textRetryDelayMs = Number(options.textRetryDelayMs || DEFAULT_TEXT_RETRY_DELAY_MS);
  let stableCandidate = null;
  let stableSince = 0;

  while (Date.now() < deadline) {
    const candidates = await page.evaluate((payload) => {
      const nodes = Array.from(document.querySelectorAll("img"));
      const baseline = payload.baseline || [];
      const assistantBaseline = payload.assistantBaseline || { count: 0, keys: [] };
      const assistantNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      return nodes
        .map((node, index) => {
          const img = /** @type {HTMLImageElement} */ (node);
          const src = img.currentSrc || img.src || "";
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          const area = width * height;
          const key = `${src}|${width}x${height}`;
          const rect = img.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          const assistant = img.closest('[data-message-author-role="assistant"]');
          const assistantIndex = assistant ? assistantNodes.indexOf(assistant) : -1;
          const inComposer = Boolean(img.closest("form, #prompt-textarea, [contenteditable='true']"));
          const inSidebar = Boolean(img.closest("nav, aside"));
          const alt = img.getAttribute("alt") || "";
          const text = [
            alt,
            img.getAttribute("aria-label"),
            img.getAttribute("title"),
            img.closest("button") ? img.closest("button").getAttribute("aria-label") : "",
          ].filter(Boolean).join(" ");
          const isUploadedReference = /uploaded|attached|reference|已上传|上传的图片|附件|参考/i.test(text);
          const isGeneratedImage = /generated|已生成|生成图片|生成的图片/i.test(text);
          return { index, src, width, height, area, key, visible, assistantIndex, inComposer, inSidebar, isUploadedReference, isGeneratedImage };
        })
        .filter((item) => item.visible)
        .filter((item) => item.width >= 256 && item.height >= 256)
        .filter((item) => !item.isUploadedReference)
        .filter((item) => item.isGeneratedImage || item.assistantIndex >= 0)
        .filter((item) => item.isGeneratedImage || item.assistantIndex >= assistantBaseline.count || !assistantBaseline.keys.includes(item.key))
        .filter((item) => !item.inComposer && !item.inSidebar)
        .filter((item) => !baseline.includes(item.key))
        .sort((a, b) => Number(b.isGeneratedImage) - Number(a.isGeneratedImage) || b.area - a.area);
    }, {
      baseline: baselineKeys,
      assistantBaseline: baselineAssistantImages,
    }).catch(async (error) => {
      if (/Execution context was destroyed|Cannot find context|Target closed/i.test(String(error.message || error))) {
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        return [];
      }
      throw error;
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      const sameAsBefore = stableCandidate && stableCandidate.key === best.key;
      if (!sameAsBefore) {
        stableCandidate = best;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 3000) {
        return best;
      }
    }

    if (Date.now() - startedAt >= textRetryDelayMs) {
      const textOnly = await hasTextOnlyResponse(page, baselineText);
      if (textOnly) {
        const error = new Error("ChatGPT returned text instead of a generated image.");
        error.code = "TEXT_ONLY_RESPONSE";
        throw error;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new Error("Timed out waiting for a generated image.");
}

async function hasTextOnlyResponse(page, baselineText) {
  return page.evaluate((previousText) => {
    const bodyText = document.body.innerText || "";
    const addedText = bodyText.startsWith(previousText) ? bodyText.slice(previousText.length).trim() : bodyText.trim();
    const hasNewGeneratedImage = Array.from(document.images).some((img) => {
      const src = img.currentSrc || img.src || "";
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      return src.includes("/backend-api/estuary/content") && width >= 256 && height >= 256;
    });
    const isStillWorking = Array.from(document.querySelectorAll("button")).some((button) => {
      const text = [
        button.innerText,
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("data-testid"),
      ].filter(Boolean).join(" ");
      return /stop|停止|composer-stop/i.test(text);
    }) || /正在生成|正在创建|请稍候|thinking|generating/i.test(addedText);

    if (hasNewGeneratedImage || isStillWorking) {
      return false;
    }

    return addedText.length >= 20;
  }, baselineText).catch(() => false);
}

async function saveImage(page, imageRef, outputDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `chatgpt-image-${timestamp}`;
  const src = imageRef && imageRef.src ? imageRef.src : "";

  if (src) {
    const base64 = await page.evaluate(async (targetSrc) => {
      const response = await fetch(targetSrc);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    }, src).catch(() => null);

    if (base64) {
      const buffer = Buffer.from(base64, "base64");
      const ext = inferExtension(src, buffer);
      const filePath = path.join(outputDir, `${baseName}.${ext}`);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    }
  }

  const filePath = path.join(outputDir, `${baseName}.png`);
  const screenshotBase64 = await page.evaluate(async (target) => {
    const images = Array.from(document.querySelectorAll("img"));
    const img = images[target.index] || images.find((node) => (node.currentSrc || node.src || "") === target.src);
    if (!img) return "";
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return "";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] || "";
  }, imageRef || {}).catch(() => "");
  if (!screenshotBase64) {
    throw new Error("Could not save generated image from the page DOM.");
  }
  fs.writeFileSync(filePath, Buffer.from(screenshotBase64, "base64"));
  return filePath;
}

async function closeChromeProcesses() {
  try {
    await runCommand("taskkill", ["/IM", "chrome.exe", "/F"]);
  } catch (error) {
    console.warn(`Warning: failed to close all Chrome processes automatically: ${error.message}`);
  }
  await sleep(2000);
}

function resolveCdpUrl(options) {
  if (typeof options["cdp-url"] === "string" && options["cdp-url"].trim()) {
    return String(options["cdp-url"]).replace(/\/+$/, "");
  }

  const port = Number(options.port || DEBUG_PORT);
  return `http://127.0.0.1:${port}`;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === 128) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function waitForDebuggerEndpoint(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const versionUrl = toDebuggerVersionUrl(`http://127.0.0.1:${DEBUG_PORT}`);

  while (Date.now() < deadline) {
    const ok = await isDebuggerEndpointReady(versionUrl);
    if (ok) {
      return true;
    }
    await sleep(500);
  }

  return false;
}

async function assertDebuggerReachable(cdpUrl) {
  const versionUrl = toDebuggerVersionUrl(cdpUrl);
  const ok = await isDebuggerEndpointReady(versionUrl);
  if (!ok) {
    throw new Error(
      `Remote debugging is unavailable on ${versionUrl}. ` +
      `Run "node scripts/chatgpt-image.js check ${renderCheckArgs(cdpUrl)}" first.`
    );
  }
}

function renderCheckArgs(cdpUrl) {
  if (cdpUrl === `http://127.0.0.1:${DEBUG_PORT}`) {
    return "";
  }
  return `--cdp-url ${cdpUrl}`;
}

function toDebuggerVersionUrl(cdpUrl) {
  return `${cdpUrl.replace(/\/+$/, "")}/json/version`;
}

async function isDebuggerEndpointReady(versionUrl) {
  const details = await fetchDebuggerVersion(versionUrl);
  return Boolean(details);
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
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    request.on("error", () => resolve(null));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferExtension(src, buffer) {
  const lowered = src.toLowerCase();
  if (lowered.includes(".jpg") || lowered.includes(".jpeg")) {
    return "jpg";
  }
  if (lowered.includes(".webp")) {
    return "webp";
  }
  if (lowered.includes(".png")) {
    return "png";
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  return "png";
}

function validateImageCommand(options) {
  const imagePath = options.image || options.path || options._;
  if (!imagePath || typeof imagePath !== "string") {
    throw new Error('Missing required argument: --image "path-to-image"');
  }

  const result = validateImageFile(path.resolve(imagePath), options);
  printValidationResult(result);
  if (!result.pass) {
    process.exitCode = 2;
  }
}

function validateImageFile(imagePath, options = {}) {
  if (!fs.existsSync(imagePath)) {
    return {
      pass: false,
      imagePath,
      failures: [`Image not found: ${imagePath}`],
    };
  }

  const buffer = fs.readFileSync(imagePath);
  const basic = readImageBasicInfo(buffer);
  const minWidth = Number(options["min-width"] || 1024);
  const minHeight = Number(options["min-height"] || 720);
  const minBytes = Number(options["min-bytes"] || 180000);
  const minSharpness = Number(options["min-sharpness"] || 18);
  const maxNoise = Number(options["max-noise"] || 42);
  const metrics = readImageQualityMetrics(imagePath);

  const failures = [];
  if (!basic.width || !basic.height) {
    failures.push("could not read image dimensions");
  } else {
    if (basic.width < minWidth) failures.push(`width ${basic.width} < ${minWidth}`);
    if (basic.height < minHeight) failures.push(`height ${basic.height} < ${minHeight}`);
  }
  if (buffer.length < minBytes) failures.push(`file size ${buffer.length} < ${minBytes}`);
  if (metrics && metrics.sharpness < minSharpness) failures.push(`sharpness ${metrics.sharpness.toFixed(2)} < ${minSharpness}`);
  if (metrics && metrics.noise > maxNoise) failures.push(`noise ${metrics.noise.toFixed(2)} > ${maxNoise}`);

  return {
    pass: failures.length === 0,
    imagePath,
    width: basic.width,
    height: basic.height,
    bytes: buffer.length,
    format: basic.format,
    sharpness: metrics ? metrics.sharpness : null,
    noise: metrics ? metrics.noise : null,
    failures,
  };
}

function readImageBasicInfo(buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          format: "jpg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + length;
    }
  }

  return { format: "unknown", width: 0, height: 0 };
}

function readImageQualityMetrics(imagePath) {
  if (process.platform !== "win32") {
    return null;
  }

  const script = `
Add-Type -AssemblyName System.Drawing
$path = [Environment]::GetEnvironmentVariable('CHATGPT_IMAGE_VALIDATE_PATH')
$bmp = [System.Drawing.Bitmap]::new($path)
try {
  $stepX = [Math]::Max(1, [int]($bmp.Width / 160))
  $stepY = [Math]::Max(1, [int]($bmp.Height / 120))
  $prev = $null
  $diffSum = 0.0
  $diffCount = 0
  $lapSum = 0.0
  $lapSqSum = 0.0
  $lapCount = 0
  for ($y = $stepY; $y -lt $bmp.Height - $stepY; $y += $stepY) {
    for ($x = $stepX; $x -lt $bmp.Width - $stepX; $x += $stepX) {
      $c = $bmp.GetPixel($x, $y)
      $g = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($null -ne $prev) {
        $diffSum += [Math]::Abs($g - $prev)
        $diffCount += 1
      }
      $prev = $g
      $l = $bmp.GetPixel($x - $stepX, $y)
      $r = $bmp.GetPixel($x + $stepX, $y)
      $u = $bmp.GetPixel($x, $y - $stepY)
      $d = $bmp.GetPixel($x, $y + $stepY)
      $lg = 0.299 * $l.R + 0.587 * $l.G + 0.114 * $l.B
      $rg = 0.299 * $r.R + 0.587 * $r.G + 0.114 * $r.B
      $ug = 0.299 * $u.R + 0.587 * $u.G + 0.114 * $u.B
      $dg = 0.299 * $d.R + 0.587 * $d.G + 0.114 * $d.B
      $lap = [Math]::Abs(4 * $g - $lg - $rg - $ug - $dg)
      $lapSum += $lap
      $lapSqSum += $lap * $lap
      $lapCount += 1
    }
  }
  $noise = if ($diffCount -gt 0) { $diffSum / $diffCount } else { 999 }
  $sharpness = if ($lapCount -gt 0) { [Math]::Sqrt([Math]::Max(0, ($lapSqSum / $lapCount) - [Math]::Pow($lapSum / $lapCount, 2))) } else { 0 }
  [Console]::WriteLine(($sharpness.ToString('F4') + ',' + $noise.ToString('F4')))
} finally {
  $bmp.Dispose()
}
`;

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, CHATGPT_IMAGE_VALIDATE_PATH: imagePath },
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }

  const [sharpness, noise] = result.stdout.trim().split(",").map(Number);
  if (!Number.isFinite(sharpness) || !Number.isFinite(noise)) {
    return null;
  }
  return { sharpness, noise };
}

function printValidationResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
