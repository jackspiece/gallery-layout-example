"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium, firefox } = require("playwright");
const root = path.resolve(__dirname, "..");
let server, browser, origin;

before(async () => {
  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const content = fs.readFileSync(file);
      const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".svg": "image/svg+xml" };
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const type = process.env.BROWSER || "chromium";
  assert(["chromium", "firefox"].includes(type), "BROWSER must be chromium or firefox");
  browser = await ({ chromium, firefox })[type].launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
async function pageFor(t, options = {}, suffix = "") {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  // Browser QA uses local assets only. Source links are inspected, not visited.
  await context.route("**/*", route => route.request().url().startsWith(origin + "/")
    ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(origin + suffix);
  return page;
}
async function assertClosed(page, trigger) {
  await page.waitForFunction(() => !document.querySelector("dialog").open &&
    !document.querySelector("#viewer-image").hasAttribute("src") &&
    !location.hash.startsWith("#artwork-"));
  await page.waitForFunction(element => document.activeElement === element, await trigger.elementHandle());
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
}
async function assertFocusedInViewport(page, trigger) {
  await page.waitForFunction(element => {
    const bounds = element.getBoundingClientRect();
    return document.activeElement === element && bounds.top < innerHeight && bounds.bottom > 0 &&
      bounds.left < innerWidth && bounds.right > 0;
  }, await trigger.elementHandle());
}

test("keyboard opens a named modal, contains focus and restores it on Escape", async t => {
  const page = await pageFor(t);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  const link = page.locator("[data-artwork]").first();
  await link.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("dialog", { name: "Cliff Walk at Pourville" }).isVisible(), true);
  assert.equal(await page.locator("#close-viewer").evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#viewer-caption a").evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#copy-artwork-link").evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Tab");
  // Chromium can temporarily focus the browser chrome on wrapping. A subsequent
  // Tab must return inside the modal, never to a background page control.
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await assertClosed(page, link);
});

test("close, backdrop and repeated opens keep image/title/focus and history correct", async t => {
  const page = await pageFor(t);
  const startUrl = page.url();
  const historyLength = await page.evaluate(() => history.length);
  const links = page.locator("[data-artwork]");
  for (let i = 0; i < 4; i++) {
    const link = links.nth(i);
    await link.click();
    assert.equal(await page.locator("#viewer-title").textContent(), await link.getAttribute("data-title"));
    assert.equal(await page.locator("#viewer-image").getAttribute("alt"), await link.locator("img").getAttribute("alt"));
    await page.locator("#viewer-image").evaluate(image => image.decode());
    await page.locator("#viewer-title").click();
    assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), true);
    if (i % 2) await page.mouse.click(2, 2);
    else await page.locator("#close-viewer").click();
    await assertClosed(page, link);
  }
  assert.equal(page.url(), startUrl);
  // Closing returns to the base entry; one forward artwork entry remains.
  assert.equal(await page.evaluate(() => history.length), historyLength + 1);
});

test("a close followed immediately by another open does not clear the newer artwork", async t => {
  const page = await pageFor(t);
  await page.locator("[data-artwork]").first().click();
  await page.evaluate(() => {
    document.querySelector("dialog").close();
    document.querySelectorAll("[data-artwork]")[1].click();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), true);
  assert.match(await page.locator("#viewer-image").getAttribute("src"), /water-lilies.webp$/);
  assert.equal(await page.locator("#close-viewer").evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Escape");
  await assertClosed(page, page.locator("[data-artwork]").nth(1));
});

test("without JavaScript the image links and Back navigation remain usable", async t => {
  const page = await pageFor(t, { javaScriptEnabled: false });
  for (let i = 0; i < 4; i++) {
    const link = page.locator("[data-artwork]").nth(i);
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForURL(origin + "/" + href);
    assert.equal(await page.locator("img").count(), 1);
    await page.goBack();
    assert.equal(await page.locator("[data-artwork]").count(), 4);
    assert.equal(await page.locator("dialog").isVisible(), false);
  }
});

for (const width of [375, 1280]) {
  test(`layout at ${width}px has no horizontal overflow and uses responsive local images`, async t => {
    const page = await pageFor(t, { viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    for (const image of await page.locator("[data-artwork] img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(element => element.decode());
      assert.equal(await image.evaluate(element => element.naturalWidth > 0 && element.currentSrc.endsWith("-small.webp")), true);
    }
  });
}

for (const width of [375, 1280]) {
  const options = { viewport: { width, height: 900 }, reducedMotion: "reduce" };
  test(`direct links, initial Close and reload stay on this page at ${width}px`, async t => {
    const page = await pageFor(t, options);
    for (const [index, id] of ["cliff-walk", "water-lilies", "sunrise", "garden"].entries()) {
      await page.goto(origin + "/credits.html");
      await page.goto(origin + "/?preview=1#artwork-" + id);
      const length = await page.evaluate(() => history.length);
      const link = page.locator("[data-artwork]").nth(index);
      assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), true);
      assert.equal(await page.locator("#viewer-title").textContent(), await link.getAttribute("data-title"));
      await page.locator("#viewer-image").evaluate(image => image.decode());
      assert.equal(await page.locator("#close-viewer").evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (index % 2) await page.keyboard.press("Escape");
      else await page.locator("#close-viewer").click();
      await assertClosed(page, link);
      await assertFocusedInViewport(page, link);
      assert.equal(page.url(), origin + "/?preview=1");
      assert.equal(await page.evaluate(() => history.length), length);
    }
    await page.locator("[data-artwork]").first().click();
    await page.reload();
    const length = await page.evaluate(() => history.length);
    await page.keyboard.press("Escape");
    await assertClosed(page, page.locator("[data-artwork]").first());
    await assertFocusedInViewport(page, page.locator("[data-artwork]").first());
    assert.equal(page.url(), origin + "/?preview=1");
    assert.equal(await page.evaluate(() => history.length), length);
  });

  test(`Back, Forward, changed artwork and Close restore URL/focus at ${width}px`, async t => {
    const page = await pageFor(t, options, "/#collection");
    const first = page.locator("[data-artwork]").first();
    const second = page.locator("[data-artwork]").nth(1);
    await first.click();
    await page.waitForURL(origin + "/#artwork-cliff-walk");
    const length = await page.evaluate(() => history.length);
    await page.goBack();
    await assertClosed(page, first);
    assert.equal(new URL(page.url()).hash, "#collection");
    await page.goForward();
    assert.equal(await page.getByRole("dialog", { name: "Cliff Walk at Pourville" }).isVisible(), true);
    assert.equal(await page.locator("#close-viewer").evaluate(el => el === document.activeElement), true);
    // A selection while already open replaces the modal visit, not the base entry.
    await second.evaluate(link => link.click());
    assert.equal(new URL(page.url()).hash, "#artwork-water-lilies");
    assert.equal(await page.getByRole("dialog", { name: "Water Lilies" }).isVisible(), true);
    assert.equal(await page.evaluate(() => history.length), length);
    await page.goBack();
    await assertClosed(page, second);
    assert.equal(new URL(page.url()).hash, "#collection");
    await page.goForward();
    assert.equal(await page.getByRole("dialog", { name: "Water Lilies" }).isVisible(), true);
    await page.locator("#close-viewer").click();
    await assertClosed(page, second);
    assert.equal(new URL(page.url()).hash, "#collection");
    await page.goForward();
    assert.equal(await page.getByRole("dialog", { name: "Water Lilies" }).isVisible(), true);
    await page.keyboard.press("Escape");
    await assertClosed(page, second);
  });

  test(`copy success, rejected/unavailable clipboard and selectable fallback at ${width}px`, async t => {
    const page = await pageFor(t, options, "/?preview=1#artwork-garden");
    await page.evaluate(() => {
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async value => window.copied.push(value),
      } });
    });
    await page.locator("#copy-artwork-link").click();
    assert.deepEqual(await page.evaluate(() => window.copied), [origin + "/?preview=1#artwork-garden"]);
    assert.equal(await page.locator("#copy-status").textContent(), "Artwork link copied.");
    assert.equal(await page.locator("#link-fallback").isVisible(), false);
    for (const mode of ["rejected", "unavailable"]) {
      await page.evaluate(mode => Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: mode === "unavailable" ? undefined : { writeText: async () => { throw new Error("Denied"); } },
      }), mode);
      await page.locator("#copy-artwork-link").click();
      const field = page.getByRole("textbox", { name: "Artwork link" });
      assert.equal(await field.inputValue(), origin + "/?preview=1#artwork-garden");
      assert.equal(await field.evaluate(el => el === document.activeElement && el.readOnly &&
        el.selectionStart === 0 && el.selectionEnd === el.value.length), true);
      assert.equal(await page.locator("#copy-status").textContent(), "Copy the selected link below.");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
        document.querySelector("dialog").scrollWidth <= document.querySelector("dialog").clientWidth), true);
    }
    await page.keyboard.press("Escape");
    await assertClosed(page, page.locator("[data-artwork]").nth(3));
    await page.locator("[data-artwork]").first().click();
    assert.equal(await page.locator("#link-fallback").isVisible(), false);
    assert.equal(await page.locator("#copy-status").textContent(), "");
  });
}

for (const width of [375, 1280]) {
  test(`initial Garden Close/Escape reveals focus with either motion preference at ${width}px`, async t => {
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const page = await pageFor(t, { viewport: { width, height: 568 }, reducedMotion }, "/credits.html");
      for (const close of ["button", "Escape"]) {
        await page.goto(origin + "/credits.html");
        await page.goto(origin + "/?shared=garden#artwork-garden");
        const historyLength = await page.evaluate(() => history.length);
        assert.equal(await page.evaluate(() => scrollY), 0);
        if (close === "button") await page.locator("#close-viewer").click();
        else await page.keyboard.press("Escape");
        const link = page.locator('[data-artwork="garden"]');
        await assertClosed(page, link);
        await assertFocusedInViewport(page, link);
        assert.equal(page.url(), origin + "/?shared=garden");
        assert.equal(await page.evaluate(() => history.length), historyLength);
        await page.keyboard.press("Enter");
        assert.equal(await page.getByRole("dialog", { name: await link.getAttribute("data-title") }).isVisible(), true);
        await page.reload();
        await page.keyboard.press("Escape");
        await assertClosed(page, link);
        await assertFocusedInViewport(page, link);
        assert.equal(page.url(), origin + "/?shared=garden");
      }
    }
  });

  test(`ordinary Garden Close/Escape and Back/Forward retain scroll at ${width}px`, async t => {
    const page = await pageFor(t, { viewport: { width, height: 568 }, reducedMotion: "reduce" });
    const link = page.locator('[data-artwork="garden"]');
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    async function assertScroll() {
      await page.waitForFunction(({ x, y }) => Math.abs(scrollX - x) <= 1 && Math.abs(scrollY - y) <= 1, scroll);
    }
    for (const close of ["button", "Escape", "Back"]) {
      await page.keyboard.press("Enter");
      if (close === "button") await page.locator("#close-viewer").click();
      else if (close === "Escape") await page.keyboard.press("Escape");
      else await page.goBack();
      await assertClosed(page, link);
      await assertScroll();
      await assertFocusedInViewport(page, link);
      assert.equal(page.url(), origin + "/");
      await page.goForward();
      assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), true);
      await assertScroll();
      await page.keyboard.press("Escape");
      await assertClosed(page, link);
      await assertScroll();
    }
  });
}

test("unknown and hostile hashes cannot choose URLs, markup or an artwork", async t => {
  const page = await pageFor(t);
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  for (const hash of ["#artwork-unknown", "#artwork-https://example.invalid/image.webp",
    "#artwork-<img src=x onerror=alert(1)>", "#artwork-%3Csvg%20onload=alert(1)%3E", "#artwork-%ZZ", "#about"]) {
    await page.evaluate(hash => { location.hash = hash; }, hash);
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal(await page.locator("#viewer-image").getAttribute("src"), null);
    assert.equal(await page.locator("#viewer-title img, #viewer-title svg").count(), 0);
  }
  await page.locator("[data-artwork]").first().click();
  await page.evaluate(() => { location.hash = "#artwork-unknown"; });
  await page.waitForFunction(() => !document.querySelector("dialog").open && !document.querySelector("#viewer-image").hasAttribute("src"));
  assert.equal(new URL(page.url()).hash, "#artwork-unknown");
  assert.equal(requests.every(url => url.startsWith(origin + "/assets/") || url === origin + "/favicon.svg"), true);
});

test("modified and non-primary clicks retain ordinary image-link behavior", async t => {
  const page = await pageFor(t);
  const results = await page.locator("[data-artwork]").first().evaluate(link => {
    // Observe cancellation after the gallery listener, then suppress actual tab/window creation.
    const cancelled = [];
    link.addEventListener("click", event => { cancelled.push(event.defaultPrevented); event.preventDefault(); });
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...options }));
    }
    return { cancelled, href: link.getAttribute("href") };
  });
  assert.deepEqual(results.cancelled, [false, false, false, false, false]);
  assert.equal(results.href, "assets/cliff-walk.webp");
  assert.equal(await page.locator("dialog").evaluate(dialog => dialog.open), false);
  assert.equal(new URL(page.url()).hash, "");
});

test("a requested close followed immediately by another open survives the pending Back", async t => {
  const page = await pageFor(t);
  await page.locator("[data-artwork]").first().click();
  await page.evaluate(() => {
    document.querySelector("#close-viewer").click();
    document.querySelectorAll("[data-artwork]")[1].click();
    document.querySelectorAll("[data-artwork]")[2].click();
  });
  await page.waitForFunction(() => document.querySelector("dialog").open && location.hash === "#artwork-sunrise");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.locator("#viewer-image").getAttribute("src"), /sunrise.webp$/);
  assert.equal(await page.locator("#close-viewer").evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Escape");
  await assertClosed(page, page.locator("[data-artwork]").nth(2));
});

test("late clipboard results cannot change a newer view or steal restored focus", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: () => new Promise((resolve, reject) => { window.finishCopy = { resolve, reject }; }),
  } }));
  await page.locator("[data-artwork]").first().click();
  await page.locator("#copy-artwork-link").click();
  await page.locator("#close-viewer").click();
  await assertClosed(page, page.locator("[data-artwork]").first());
  await page.locator("[data-artwork]").nth(1).click();
  await page.evaluate(() => window.finishCopy.reject(new Error("Late denial")));
  assert.equal(await page.locator("#copy-status").textContent(), "");
  assert.equal(await page.locator("#link-fallback").isVisible(), false);
  assert.equal(await page.locator("#close-viewer").evaluate(el => el === document.activeElement), true);
  await page.locator("#copy-artwork-link").click();
  await page.locator("#close-viewer").click();
  await assertClosed(page, page.locator("[data-artwork]").nth(1));
  await page.evaluate(() => window.finishCopy.resolve());
  assert.equal(await page.locator("#copy-status").textContent(), "");
  assert.equal(await page.locator("[data-artwork]").nth(1).evaluate(el => el === document.activeElement), true);
});
