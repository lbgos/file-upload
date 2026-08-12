const tokenInput = document.querySelector("#token");
const toggleToken = document.querySelector("#toggle-token");
const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const uploadsSection = document.querySelector("#uploads-section");
const uploadList = document.querySelector("#upload-list");
const clearComplete = document.querySelector("#clear-complete");
const announcement = document.querySelector("#announcement");

let uploadNumber = 0;

toggleToken.addEventListener("click", () => {
  const reveal = tokenInput.type === "password";
  tokenInput.type = reveal ? "text" : "password";
  toggleToken.textContent = reveal ? "hide" : "show";
  toggleToken.setAttribute("aria-label", reveal ? "Hide token" : "Show token");
});

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => queueFiles(fileInput.files));

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => queueFiles(event.dataTransfer.files));

clearComplete.addEventListener("click", () => {
  for (const item of uploadList.querySelectorAll("[data-finished='true']")) item.remove();
  if (!uploadList.children.length) uploadsSection.hidden = true;
});

function queueFiles(fileList) {
  const token = tokenInput.value.trim();
  if (!token) {
    tokenInput.focus();
    announcement.textContent = "Enter the upload token first.";
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      tokenInput.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }],
        { duration: 250 },
      );
    }
    return;
  }

  const files = [...fileList];
  if (!files.length) return;
  uploadsSection.hidden = false;
  announcement.textContent = `Uploading ${files.length} file${files.length === 1 ? "" : "s"}.`;
  for (const file of files) uploadFile(file, token);
  fileInput.value = "";
}

function uploadFile(file, token) {
  uploadNumber += 1;
  const item = document.createElement("li");
  item.className = "upload-item";
  item.dataset.finished = "false";

  const mark = document.createElement("span");
  mark.className = "file-mark";
  mark.textContent = String(uploadNumber).padStart(2, "0");

  const copy = document.createElement("div");
  copy.className = "file-copy";
  const name = document.createElement("p");
  name.className = "file-name";
  name.textContent = file.name;
  const meta = document.createElement("div");
  meta.className = "file-meta";
  const size = document.createElement("span");
  size.textContent = formatBytes(file.size);
  const state = document.createElement("span");
  state.textContent = "waiting";
  meta.append(size, state);
  const track = document.createElement("div");
  track.className = "progress-track";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  track.append(bar);
  copy.append(name, meta, track);

  const actions = document.createElement("div");
  actions.className = "file-actions";
  item.append(mark, copy, actions);
  uploadList.prepend(item);

  const request = new XMLHttpRequest();
  request.open("PUT", `/${encodeURIComponent(file.name)}`);
  request.setRequestHeader("X-Upload-Token", token);
  state.textContent = "uploading";

  request.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) bar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
  });

  request.addEventListener("load", () => {
    item.dataset.finished = "true";
    if (request.status !== 201) {
      let message = `Upload failed (${request.status})`;
      try { message = JSON.parse(request.responseText)?.error?.message || message; } catch {}
      fail(message);
      return;
    }
    const url = request.responseText.trim();
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    const id = segments[2];
    const publicName = decodeURIComponent(segments.at(-1));
    bar.style.width = "100%";
    state.textContent = "ready";
    state.className = "ok";
    name.textContent = publicName;
    addActions(actions, { url, id }, token, item, state);
    announcement.textContent = `${publicName} is ready to share.`;
  });

  request.addEventListener("error", () => {
    item.dataset.finished = "true";
    fail("Network error");
  });

  request.addEventListener("abort", () => {
    item.dataset.finished = "true";
    fail("Cancelled");
  });

  request.send(file);

  function fail(message) {
    state.textContent = message;
    state.className = "error";
    bar.style.background = "var(--red)";
    announcement.textContent = `${file.name}: ${message}`;
  }
}

function addActions(container, result, token, item, state) {
  const open = document.createElement("a");
  open.href = result.url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "open ↗";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(result.url);
    copy.textContent = "copied";
    setTimeout(() => { copy.textContent = "copy"; }, 1200);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "delete";
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    const response = await fetch(`/api/files/${result.id}`, {
      method: "DELETE",
      headers: { "X-Upload-Token": token },
    });
    if (response.ok) {
      item.remove();
      if (!uploadList.children.length) uploadsSection.hidden = true;
    } else {
      state.textContent = "delete failed";
      state.className = "error";
      remove.disabled = false;
    }
  });

  container.append(open, copy, remove);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
