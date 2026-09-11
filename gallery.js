"use strict";

const viewer = document.querySelector("#art-viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerTitle = document.querySelector("#viewer-title");
const viewerCaption = document.querySelector("#viewer-caption");
const closeButton = document.querySelector("#close-viewer");
let trigger = null;

if (viewer && typeof viewer.showModal === "function") {
  document.querySelectorAll("a[data-artwork]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
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
      viewer.showModal();
      closeButton.focus();
    });
  });
  closeButton.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) viewer.close();
  });
  viewer.addEventListener("close", () => {
    viewerImage.removeAttribute("src");
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
}
