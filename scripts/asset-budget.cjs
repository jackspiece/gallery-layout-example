"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const bytes = file => fs.statSync(path.join(root, file)).size;
const assets = fs.readdirSync(path.join(root, "assets")).filter(name => name.endsWith(".webp"));
const small = assets.filter(name => name.endsWith("-small.webp"));
const full = assets.filter(name => !name.endsWith("-small.webp"));
const result = {
  shell_bytes: ["index.html", "styles.css", "gallery.js", "favicon.svg"].reduce((sum, file) => sum + bytes(file), 0),
  all_thumbnail_bytes: small.reduce((sum, file) => sum + bytes("assets/" + file), 0),
  largest_full_image_bytes: Math.max(...full.map(file => bytes("assets/" + file))),
  total_artwork_bytes: assets.reduce((sum, file) => sum + bytes("assets/" + file), 0),
};
assert(result.shell_bytes <= 24 * 1024, "HTML/CSS/JS/icon shell exceeds 24 KiB");
assert(result.all_thumbnail_bytes <= 700 * 1024, "Thumbnail set exceeds 700 KiB");
assert(result.largest_full_image_bytes <= 2 * 1024 * 1024, "One full image exceeds 2 MiB");
assert(result.total_artwork_bytes <= 5 * 1024 * 1024, "Artwork set exceeds 5 MiB");
console.log(JSON.stringify({ ...result, budgets_passed: true }, null, 2));
