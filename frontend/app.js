/* ========================================================
   app.js — YT Downloader Frontend Logic
   ======================================================== */

// Auto-detect: cloud (same origin) vs local dev
const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:5000"
  : window.location.origin;

// DOM refs
const urlInput   = document.getElementById("urlInput");
const fetchBtn   = document.getElementById("fetchBtn");
const pasteBtn   = document.getElementById("pasteBtn");
const errorBox   = document.getElementById("errorBox");
const errorText  = document.getElementById("errorText");
const loadingCard = document.getElementById("loadingCard");
const resultCard = document.getElementById("resultCard");
const formatGrid = document.getElementById("formatGrid");
const downloadBtn = document.getElementById("downloadBtn");
const dlBadge    = document.getElementById("dlBadge");

let currentVideo = null;
let selectedFormat = null;

/* ---- Toast ---- */
function showToast(msg, duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

/* ---- Error ---- */
function showError(msg) {
  errorText.textContent = msg;
  errorBox.style.display = "flex";
}
function hideError() {
  errorBox.style.display = "none";
}

/* ---- Format size helper ---- */
function formatBytes(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

/* ---- View count helper ---- */
function formatViews(n) {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M görüntülenme`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}B görüntülenme`;
  return `${n} görüntülenme`;
}

/* ---- Render format cards ---- */
function renderFormats(formats) {
  formatGrid.innerHTML = "";
  selectedFormat = null;
  downloadBtn.disabled = true;
  dlBadge.textContent = "";

  formats.forEach((f, i) => {
    const item = document.createElement("div");
    item.className = "format-item";
    item.dataset.index = i;

    const sizeStr = formatBytes(f.filesize);

    item.innerHTML = `
      <span class="format-label">${f.label}</span>
      <span class="format-size">${sizeStr || "Boyut bilinmiyor"}</span>
      <span class="format-check">✓</span>
    `;

    item.addEventListener("click", () => {
      // Deselect all
      document.querySelectorAll(".format-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
      selectedFormat = f;
      downloadBtn.disabled = false;
      dlBadge.textContent = f.label.replace(/^[^ ]+ /, ""); // strip emoji
    });

    formatGrid.appendChild(item);
  });
}

/* ---- Fetch video info ---- */
async function fetchVideoInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    showError("Lütfen bir YouTube URL'si girin.");
    return;
  }

  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    showError("Geçerli bir YouTube URL'si girin. (youtube.com veya youtu.be)");
    return;
  }

  hideError();
  resultCard.style.display = "none";
  loadingCard.style.display = "block";
  fetchBtn.disabled = true;
  fetchBtn.querySelector(".btn-text").textContent = "Yükleniyor...";

  try {
    const res = await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Bilinmeyen hata");
    }

    currentVideo = data;
    displayResult(data);

  } catch (err) {
    loadingCard.style.display = "none";
    if (err.message.includes("fetch")) {
      showError("Sunucuya bağlanılamadı. backend/start.bat dosyasını çalıştırdığınızdan emin olun.");
    } else {
      showError(err.message);
    }
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector(".btn-text").textContent = "Video Bilgisini Getir";
    loadingCard.style.display = "none";
  }
}

/* ---- Display result ---- */
function displayResult(data) {
  // Thumbnail
  const thumb = document.getElementById("thumbnail");
  thumb.src = data.thumbnail;
  thumb.alt = data.title;

  // Duration
  const durBadge = document.getElementById("durationBadge");
  durBadge.textContent = data.duration || "";

  // Title & meta
  document.getElementById("videoTitle").textContent = data.title;
  document.getElementById("channelName").textContent = data.channel || "Bilinmiyor";
  document.getElementById("viewCount").textContent = formatViews(data.view_count);

  // Formats
  renderFormats(data.formats);

  resultCard.style.display = "block";
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---- Download ---- */
function startDownload() {
  if (!selectedFormat || !currentVideo) return;

  const params = new URLSearchParams({
    url: currentVideo.url,
    format_id: selectedFormat.format_id,
    ext: selectedFormat.ext,
    title: currentVideo.title
  });

  showToast("⬇️ İndirme başlatılıyor...");

  // Trigger download via anchor
  const a = document.createElement("a");
  a.href = `${API_BASE}/api/download?${params.toString()}`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => showToast("✅ İndirme başladı! Tarayıcınızı kontrol edin."), 1000);
}

/* ---- Paste button ---- */
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      showToast("📋 URL yapıştırıldı!");
      // Auto-fetch if it looks like a YouTube URL
      if (text.includes("youtube.com") || text.includes("youtu.be")) {
        setTimeout(fetchVideoInfo, 300);
      }
    }
  } catch {
    showToast("Panodan okumak için izin gerekli.");
  }
});

/* ---- Fetch button ---- */
fetchBtn.addEventListener("click", fetchVideoInfo);

/* ---- Enter key ---- */
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchVideoInfo();
});

/* ---- Download button ---- */
downloadBtn.addEventListener("click", startDownload);

/* ---- URL change: hide old result ---- */
urlInput.addEventListener("input", () => {
  if (resultCard.style.display !== "none") {
    resultCard.style.display = "none";
  }
  hideError();
});

/* ---- Health check on load ---- */
window.addEventListener("load", async () => {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log("✅ Backend sunucusu aktif.");
    }
  } catch {
    console.warn("⚠️ Backend sunucusu çalışmıyor. backend/start.bat dosyasını açın.");
  }
});
