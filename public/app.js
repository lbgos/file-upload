// Owner upload page. Requests authenticate with the HttpOnly session cookie set by POST /api/session.
const signOut = document.querySelector("#sign-out");
const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const uploadList = document.querySelector("#upload-list");

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

signOut.addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
  location.reload();
});

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  queueFiles(fileInput.files);
  fileInput.value = "";
});

// The whole window is a drop target; the zone only highlights.
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("active");
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) dropZone.classList.remove("active");
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("active");
  queueFiles(event.dataTransfer.files);
});
document.addEventListener("paste", (event) => {
  if (event.clipboardData.files.length) queueFiles(event.clipboardData.files);
});

function queueFiles(fileList) {
  for (const file of fileList) uploadFile(file);
}

function uploadFile(file) {
  const name = el("span", { className: "name", textContent: file.name, title: file.name });
  const status = el("span", { className: "status", textContent: "0%" });
  const actions = el("span", { className: "actions" });
  const bar = el("span", { className: "bar" });
  const row = el("li", {}, name, el("span", { className: "size", textContent: formatBytes(file.size) }), status, actions, bar);
  uploadList.prepend(row);

  const fail = (message) => {
    row.classList.add("failed");
    status.textContent = message;
  };

  const request = new XMLHttpRequest();
  request.open("PUT", `/${encodeURIComponent(file.name)}`);
  request.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    bar.style.width = `${percent}%`;
    status.textContent = `${percent}%`;
  });
  request.addEventListener("error", () => fail("network error"));
  request.addEventListener("load", () => {
    if (request.status === 401) {
      fail("signed out");
      return;
    }
    if (request.status !== 201) {
      let message = `error ${request.status}`;
      try { message = JSON.parse(request.responseText).error.message; } catch {}
      fail(message);
      return;
    }
    const url = request.responseText.trim();
    const [, , id, publicName] = new URL(url).pathname.split("/");
    row.classList.add("done");
    name.replaceChildren(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", textContent: publicName }));
    name.title = url;
    status.textContent = "ready";
    actions.append(copyButton(url), deleteButton(id, row, status));
  });
  request.send(file);
}

function copyButton(url) {
  const button = el("button", { type: "button", textContent: "copy" });
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "copied";
    } catch {
      button.textContent = "copy failed";
    }
    setTimeout(() => { button.textContent = "copy"; }, 1200);
  });
  return button;
}

function deleteButton(id, row, status) {
  const button = el("button", { type: "button", textContent: "delete" });
  button.addEventListener("click", async () => {
    button.disabled = true;
    const response = await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (response?.ok) {
      row.remove();
      return;
    }
    status.textContent = "delete failed";
    button.disabled = false;
  });
  return button;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${units[unit - 1]}`;
}
