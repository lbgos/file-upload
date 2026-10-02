// Project page: copy buttons for snippets and the owner sign-in, which trades the token for a session cookie.
for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const code = button.parentElement.querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "copied";
    } catch {
      button.textContent = "copy failed";
    }
    setTimeout(() => { button.textContent = "copy"; }, 1200);
  });
}

const form = document.querySelector("#sign-in");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#sign-in-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "X-Upload-Token": tokenInput.value.trim() },
  }).catch(() => undefined);

  if (response?.ok) {
    location.reload();
    return;
  }
  tokenInput.value = "";
  status.textContent = response?.status === 401 ? "Wrong token" : "Network error, try again";
});
