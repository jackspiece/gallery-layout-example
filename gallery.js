"use strict";

const viewer = document.querySelector("#art-viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerTitle = document.querySelector("#viewer-title");
const viewerCaption = document.querySelector("#viewer-caption");
const closeButton = document.querySelector("#close-viewer");
const copyButton = document.querySelector("#copy-artwork-link");
const copyStatus = document.querySelector("#copy-status");
const linkFallback = document.querySelector("#link-fallback");
const linkField = document.querySelector("#artwork-link");
let trigger = null;

if (viewer && typeof viewer.showModal === "function") {
  // Hashes only select these authored links; they never supply an image URL or HTML.
  const artworks = new Map(Array.from(document.querySelectorAll("a[data-artwork]"),
    link => ["#artwork-" + link.dataset.artwork, link]));
  const ownedEntries = new Set();
  const session = Date.now() + ":" + Math.random();
  let serial = 0, copyRequest = 0, closing = false, queuedLink = null, closingTrigger = null;

  function resetCopy() {
    copyRequest++;
    copyStatus.textContent = "";
    linkFallback.hidden = true;
    linkField.value = "";
  }

  function showArtwork(link) {
    if (viewer.open && trigger === link) return;
    resetCopy();
    trigger = link;
    viewerTitle.textContent = link.dataset.title;
    viewerImage.src = link.href;
    viewerImage.alt = link.querySelector("img").alt;
    viewerCaption.replaceChildren();
    viewerCaption.append(`Claude Monet, ${link.dataset.year}. ${link.dataset.museum}. `);
    const source = document.createElement("a");
    source.href = link.dataset.source;
    source.textContent = "Image source";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    viewerCaption.append(source);
    if (!viewer.open) viewer.showModal();
    closeButton.focus();
  }

  function restoreFocus(link, reveal = false) {
    const request = copyRequest;
    const url = location.href;
    // Fragment traversal may move focus after popstate; restore it afterwards.
    requestAnimationFrame(() => {
      if (request === copyRequest && url === location.href && !viewer.open && link?.isConnected) {
        link.focus({ preventScroll: !reveal });
      }
    });
  }

  function hideArtwork() {
    const previous = trigger;
    trigger = null;
    resetCopy();
    if (viewer.open) viewer.close();
    viewerImage.removeAttribute("src");
    restoreFocus(previous);
  }

  function openArtwork(link) {
    // Finish an already-requested Back before opening the newest selection.
    if (closing) { queuedLink = link; return; }
    const url = new URL(location.href);
    url.hash = "artwork-" + link.dataset.artwork;
    if (trigger) {
      // One history entry per modal visit, including a changed artwork.
      history.replaceState(history.state, "", url);
    } else {
      const entry = session + ":" + ++serial;
      history.pushState({ galleryArtwork: entry }, "", url);
      ownedEntries.add(entry);
    }
    showArtwork(link);
  }

  function closeArtwork() {
    if (closing || !trigger) return;
    const canGoBack = ownedEntries.has(history.state?.galleryArtwork);
    closingTrigger = trigger;
    hideArtwork();
    if (canGoBack) {
      closing = true;
      history.back();
    } else if (artworks.has(location.hash)) {
      // A pasted/reloaded deep link has no known same-page predecessor.
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState(history.state, "", url);
      // There was no visible opener; reveal the shared artwork on dismissal.
      restoreFocus(closingTrigger, true);
      closingTrigger = null;
    }
  }

  function syncLocation() {
    closing = false;
    const next = queuedLink;
    const previous = closingTrigger;
    queuedLink = closingTrigger = null;
    if (next) { openArtwork(next); return; }
    const link = artworks.get(location.hash);
    if (link) showArtwork(link);
    else if (trigger) hideArtwork();
    else if (previous) restoreFocus(previous);
  }

  artworks.forEach(link => link.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openArtwork(link);
  }));
  closeButton.addEventListener("click", closeArtwork);
  viewer.addEventListener("cancel", event => {
    event.preventDefault();
    closeArtwork();
  });
  viewer.addEventListener("click", event => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) closeArtwork();
  });
  viewer.addEventListener("close", () => {
    // A queued close event may arrive after another artwork has opened.
    if (viewer.open) return;
    closeArtwork();
  });
  copyButton.addEventListener("click", async () => {
    if (!trigger) return;
    resetCopy();
    const request = copyRequest;
    const url = new URL(location.href);
    url.hash = "artwork-" + trigger.dataset.artwork;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url.href);
      if (request === copyRequest && viewer.open) copyStatus.textContent = "Artwork link copied.";
    } catch {
      if (request !== copyRequest || !viewer.open) return;
      copyStatus.textContent = "Copy the selected link below.";
      linkField.value = url.href;
      linkFallback.hidden = false;
      linkField.focus();
      linkField.select();
    }
  });
  window.addEventListener("popstate", syncLocation);
  window.addEventListener("hashchange", syncLocation);
  syncLocation();
}
