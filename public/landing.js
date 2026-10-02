// Owner sign-in: trades the token for the HttpOnly session cookie, then reloads into the upload page.
const form = document.querySelector("#sign-in");
const tokenInput = document.querySelector("#token");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "X-Upload-Token": tokenInput.value.trim() },
  }).catch(() => undefined);

  if (response?.ok) {
    location.reload();
    return;
  }
  tokenInput.value = "";
  tokenInput.placeholder = response?.status === 401 ? "wrong token" : "network error";
  form.classList.add("failed");
});

tokenInput.addEventListener("input", () => form.classList.remove("failed"));
