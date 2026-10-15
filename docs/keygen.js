"use strict";
// No external dependencies or network calls. This code runs locally in the browser.
const button = document.getElementById("generate");
const copyButton = document.getElementById("copy");
const keyField = document.getElementById("key");
const status = document.getElementById("status");

function makeKey() {
  if (!window.isSecureContext || !window.crypto || typeof window.crypto.getRandomValues !== "function") {
    status.textContent = "Se necesita una conexión HTTPS y un navegador compatible.";
    return;
  }
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  keyField.value = window.btoa(binary);
  bytes.fill(0);
  status.textContent = "Clave de 256 bits generada en tu teléfono. Cópiala y pégala en Cloudflare como Secret.";
}

async function copyKey() {
  if (!keyField.value) {
    status.textContent = "Primero genera una clave.";
    return;
  }
  try {
    await navigator.clipboard.writeText(keyField.value);
    status.textContent = "Copiada. Pégala únicamente en Cloudflare, en TOKEN_ENCRYPTION_KEY.";
  } catch {
    keyField.focus();
    keyField.select();
    status.textContent = "Seleccionada. Copia manualmente con el menú de tu teléfono.";
  }
}
button.addEventListener("click", makeKey);
copyButton.addEventListener("click", copyKey);
window.addEventListener("pagehide", () => { keyField.value = ""; });
