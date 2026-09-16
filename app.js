/**
 * ESPX Online Web Flasher
 * Supports: ESP32, ESP32-S2, ESP32-S3, ESP32-C3, ESP32-C6, ESP8266
 * Uses: esptool-js & Web Serial API
 */

import { ESPLoader, Transport } from "./lib/esptool-bundle.js";

// Danh mục các phiên bản Firmware ESPX có sẵn
const FIRMWARE_MANIFEST = [
  {
    id: "v1.1c3mini",
    name: "ESPX V1.1 cho Esp32 c3(Super Mini)",
    chipFamily: "ESP32 c3",
    infoFile: "info/v1.1.txt",
    files: [
      { name: "bootloader_v2.1.0.bin", path: "firmware/v1.1.bootloader.bin", offset: 0x1000, desc: "Bootloader" },
      { name: "partitions_v2.1.0.bin", path: "firmware/v1.1.partitions.bin", offset: 0x8000, desc: "Partitions" },
      { name: "espx_main_v2.1.0.bin", path: "firmware/v1.1.bin", offset: 0x10000, desc: "Main Code" }
    ]
  }
  ];

// App State
let port = null;
let esploader = null;
let transport = null;
let isConnected = false;
let currentRawReadmeText = "";
let currentActiveTab = "presetTab";

// DOM Elements
const baudRateSelect = document.getElementById("baudRateSelect");
const eraseFlashCheckbox = document.getElementById("eraseFlashCheckbox");
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");
const btnFlash = document.getElementById("btnFlash");
const btnResetBoard = document.getElementById("btnResetBoard");
const btnClearConsole = document.getElementById("btnClearConsole");
const serialStatusIndicator = document.getElementById("serialStatusIndicator");
const statusLabel = document.getElementById("statusLabel");
const chipDetectedBadge = document.getElementById("chipDetectedBadge");
const deviceDetails = document.getElementById("deviceDetails");
const valChipName = document.getElementById("valChipName");
const valChipMac = document.getElementById("valChipMac");
const valChipFeatures = document.getElementById("valChipFeatures");
const valChipCrystal = document.getElementById("valChipCrystal");
const serialConsole = document.getElementById("serialConsole");
const unsupportedWarning = document.getElementById("unsupportedWarning");

const versionSelect = document.getElementById("versionSelect");
const presetBootOffset = document.getElementById("presetBootOffset");
const presetBootFile = document.getElementById("presetBootFile");
const presetPartOffset = document.getElementById("presetPartOffset");
const presetPartFile = document.getElementById("presetPartFile");
const presetAppOffset = document.getElementById("presetAppOffset");
const presetAppFile = document.getElementById("presetAppFile");

const flashProgressContainer = document.getElementById("flashProgressContainer");
const flashProgressBar = document.getElementById("flashProgressBar");
const flashProgressText = document.getElementById("flashProgressText");
const flashProgressPercent = document.getElementById("flashProgressPercent");

const currentInfoFilePath = document.getElementById("currentInfoFilePath");
const readmeContent = document.getElementById("readmeContent");
const btnCopyReadme = document.getElementById("btnCopyReadme");
const btnDownloadTxt = document.getElementById("btnDownloadTxt");

// Custom tab inputs
const customBootOffset = document.getElementById("customBootOffset");
const fileCustomBoot = document.getElementById("fileCustomBoot");
const customPartOffset = document.getElementById("customPartOffset");
const fileCustomPart = document.getElementById("fileCustomPart");
const customAppOffset = document.getElementById("customAppOffset");
const fileCustomApp = document.getElementById("fileCustomApp");

// Custom Terminal Logger for ESPLoader
const espTerminal = {
  clean() {
    serialConsole.innerHTML = "";
  },
  writeLine(text) {
    appendLog(text, "info-text");
  },
  write(text) {
    appendLog(text, "info-text", false);
  }
};

function appendLog(message, className = "info-text", newline = true) {
  if (!message) return;
  const line = document.createElement("div");
  line.className = `term-line ${className}`;
  line.textContent = message;
  serialConsole.appendChild(line);
  serialConsole.scrollTop = serialConsole.scrollHeight;
}

// Markdown Mini Parser mô phỏng Github Readme
function renderMarkdown(md) {
  let html = md
    // Escape HTML special tags
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks ```
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Headers # ## ###
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquotes >
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Horizontal rules ---
  html = html.replace(/^---$/gim, '<hr>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables markdown
  html = html.replace(/((?:\|.*?\|\r?\n)+)/g, (match) => {
    const rows = match.trim().split("\n");
    let tableHtml = "<table>";
    let isHeader = true;
    for (let row of rows) {
      if (row.includes("| :---") || row.includes("|:---") || row.includes("| ---")) {
        continue; // separator
      }
      const cells = row.split("|").slice(1, -1);
      tableHtml += "<tr>";
      cells.forEach(c => {
        const tag = isHeader ? "th" : "td";
        tableHtml += `<${tag}>${c.trim()}</${tag}>`;
      });
      tableHtml += "</tr>";
      isHeader = false;
    }
    tableHtml += "</table>";
    return tableHtml;
  });

  // Unordered list items * or -
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gims, (match) => `<ul>${match}</ul>`);

  // Ordered lists 1. 2.
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');

  // Paragraphs
  const blocks = html.split(/\n\s*\n/);
  html = blocks.map(b => {
    b = b.trim();
    if (!b) return "";
    if (b.startsWith("<h") || b.startsWith("<table") || b.startsWith("<pre") || b.startsWith("<ul") || b.startsWith("<ol") || b.startsWith("<hr") || b.startsWith("<blockquote")) {
      return b;
    }
    return `<p>${b.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  return html;
}

// Tải file .txt trong thư mục /info và hiển thị
async function loadVersionInfo(infoPath) {
  currentInfoFilePath.textContent = infoPath;
  btnDownloadTxt.href = infoPath;
  readmeContent.innerHTML = '<div class="loading-spinner">Đang nạp file thông tin từ <code>' + infoPath + '</code>...</div>';

  try {
    const res = await fetch(infoPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Không tìm thấy file thông tin`);
    const text = await res.text();
    currentRawReadmeText = text;
    readmeContent.innerHTML = renderMarkdown(text);
  } catch (err) {
    readmeContent.innerHTML = `<div class="term-line error-text">Không thể đọc file: ${err.message}</div>`;
  }
}

// Khởi tạo danh sách phiên bản
function initVersionSelector() {
  versionSelect.innerHTML = "";
  FIRMWARE_MANIFEST.forEach((fw, idx) => {
    const opt = document.createElement("option");
    opt.value = fw.id;
    opt.textContent = fw.name;
    versionSelect.appendChild(opt);
  });

  versionSelect.addEventListener("change", () => {
    const selected = FIRMWARE_MANIFEST.find(f => f.id === versionSelect.value);
    if (selected) {
      updatePresetDisplay(selected);
      loadVersionInfo(selected.infoFile);
    }
  });

  // Chọn mặc định bản đầu tiên
  if (FIRMWARE_MANIFEST.length > 0) {
    updatePresetDisplay(FIRMWARE_MANIFEST[0]);
    loadVersionInfo(FIRMWARE_MANIFEST[0].infoFile);
  }
}

function updatePresetDisplay(fw) {
  const boot = fw.files.find(f => f.desc === "Bootloader") || fw.files[0];
  const part = fw.files.find(f => f.desc === "Partitions") || fw.files[1];
  const app = fw.files.find(f => f.desc === "Main Code") || fw.files[2];

  presetBootOffset.textContent = "0x" + boot.offset.toString(16).toUpperCase();
  presetBootFile.textContent = boot.name;

  presetPartOffset.textContent = "0x" + part.offset.toString(16).toUpperCase();
  presetPartFile.textContent = part.name;

  presetAppOffset.textContent = "0x" + app.offset.toString(16).toUpperCase();
  presetAppFile.textContent = app.name;
}

// Tab Switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.getAttribute("data-tab");
    document.getElementById(target).classList.add("active");
    currentActiveTab = target;
  });
});

// Sao chép nội dung Readme raw
btnCopyReadme.addEventListener("click", async () => {
  if (!currentRawReadmeText) return;
  try {
    await navigator.clipboard.writeText(currentRawReadmeText);
    const oldText = btnCopyReadme.textContent;
    btnCopyReadme.textContent = "✓ Đã sao chép";
    setTimeout(() => { btnCopyReadme.textContent = oldText; }, 2000);
  } catch (e) {
    alert("Không thể sao chép: " + e.message);
  }
});

btnClearConsole.addEventListener("click", () => {
  serialConsole.innerHTML = "";
});

// Kiểm tra Web Serial API
if (!("serial" in navigator)) {
  unsupportedWarning.classList.remove("hidden");
  btnConnect.disabled = true;
  appendLog("⚠️ Trình duyệt của bạn không hỗ trợ Web Serial API. Vui lòng mở trang web này bằng Google Chrome hoặc Microsoft Edge.", "error-text");
}

// Kết nối ESP32 qua Web Serial
btnConnect.addEventListener("click", async () => {
  try {
    appendLog("⏳ Đang yêu cầu cấp quyền cổng Serial (Web Serial API)...");
    port = await navigator.serial.requestPort();
    
    transport = new Transport(port);
    const baudRate = parseInt(baudRateSelect.value, 10) || 115200;

    appendLog(`🔌 Đang kết nối thiết bị với baudrate ban đầu 115200 bps...`);
    
    esploader = new ESPLoader({
      transport: transport,
      baudrate: baudRate,
      terminal: espTerminal,
      romBaudrate: 115200
    });

    const chip = await esploader.main();
    isConnected = true;

    // Cập nhật UI kết nối thành công
    serialStatusIndicator.classList.add("connected");
    statusLabel.textContent = `Đã kết nối (${chip})`;
    chipDetectedBadge.textContent = chip;
    chipDetectedBadge.classList.add("active");
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    btnResetBoard.disabled = false;

    // Đọc thông số chip
    valChipName.textContent = chip;
    try {
      const mac = await esploader.chip.readMac(esploader);
      valChipMac.textContent = mac;
    } catch {
      valChipMac.textContent = "N/A";
    }

    try {
      const features = await esploader.chip.getChipFeatures(esploader);
      valChipFeatures.textContent = Array.isArray(features) ? features.join(", ") : String(features);
    } catch {
      valChipFeatures.textContent = "Standard";
    }

    try {
      const xtal = await esploader.chip.getCrystalFreq(esploader);
      valChipCrystal.textContent = xtal ? `${xtal} MHz` : "40 MHz";
    } catch {
      valChipCrystal.textContent = "40 MHz";
    }

    deviceDetails.classList.remove("hidden");
    appendLog(`🎉 Kết nối vi điều khiển thành công! Dòng chip: ${chip}`, "success-text");

  } catch (err) {
    console.error(err);
    appendLog(`❌ Lỗi kết nối: ${err.message}`, "error-text");
    disconnectDevice();
  }
});

// Ngắt kết nối
async function disconnectDevice() {
  if (transport) {
    try {
      await transport.disconnect();
    } catch (e) {
      console.warn(e);
    }
  }
  if (port) {
    try {
      await port.close();
    } catch (e) {
      console.warn(e);
    }
  }
  port = null;
  transport = null;
  esploader = null;
  isConnected = false;

  serialStatusIndicator.classList.remove("connected");
  statusLabel.textContent = "Chưa kết nối cổng COM";
  chipDetectedBadge.textContent = "Chưa nhận diện";
  chipDetectedBadge.classList.remove("active");
  deviceDetails.classList.add("hidden");

  btnConnect.disabled = false;
  btnDisconnect.disabled = true;
  btnResetBoard.disabled = true;

  appendLog("🔌 Đã ngắt kết nối cổng COM.", "info-text");
}

btnDisconnect.addEventListener("click", disconnectDevice);

// Đọc File thành chuỗi nhị phân (Binary string)
function readFileAsBinary(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

// Tải file từ Server/Github thành binary string
async function fetchBinaryFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được file ${url}: ${res.statusText}`);
  const blob = await res.blob();
  return readFileAsBinary(blob);
}

// Bắt đầu Flash Firmware
btnFlash.addEventListener("click", async () => {
  if (!isConnected || !esploader) {
    alert("Vui lòng kết nối với ESP32 qua nút 'Kết nối cổng COM' trước khi nạp!");
    return;
  }

  const fileArray = [];

  try {
    btnFlash.disabled = true;
    flashProgressContainer.classList.remove("hidden");
    flashProgressBar.style.width = "0%";
    flashProgressPercent.textContent = "0%";
    flashProgressText.textContent = "Đang chuẩn bị file firmware...";

    if (currentActiveTab === "presetTab") {
      const selected = FIRMWARE_MANIFEST.find(f => f.id === versionSelect.value);
      if (!selected) throw new Error("Chưa chọn phiên bản firmware hợp lệ!");

      appendLog(`📦 Đang chuẩn bị 3 file nhị phân cho phiên bản: ${selected.name}...`);
      for (let item of selected.files) {
        flashProgressText.textContent = `Đang nạp file ${item.name}...`;
        appendLog(`⬇️ Đang tải ${item.name} (${item.desc}) từ máy chủ...`);
        const data = await fetchBinaryFromUrl(item.path);
        fileArray.push({
          data: data,
          address: item.offset
        });
      }
    } else {
      // Custom Tab: Lấy file từ máy tính
      const bootFile = fileCustomBoot.files[0];
      const partFile = fileCustomPart.files[0];
      const appFile = fileCustomApp.files[0];

      if (!bootFile && !partFile && !appFile) {
        throw new Error("Vui lòng chọn ít nhất 1 file .bin để tiến hành nạp!");
      }

      if (bootFile) {
        const offset = parseInt(customBootOffset.value, 16);
        const data = await readFileAsBinary(bootFile);
        fileArray.push({ data, address: offset });
        appendLog(`📁 Đã nạp file Bootloader: ${bootFile.name} @ 0x${offset.toString(16)}`);
      }
      if (partFile) {
        const offset = parseInt(customPartOffset.value, 16);
        const data = await readFileAsBinary(partFile);
        fileArray.push({ data, address: offset });
        appendLog(`📁 Đã nạp file Partitions: ${partFile.name} @ 0x${offset.toString(16)}`);
      }
      if (appFile) {
        const offset = parseInt(customAppOffset.value, 16);
        const data = await readFileAsBinary(appFile);
        fileArray.push({ data, address: offset });
        appendLog(`📁 Đã nạp file Main Code: ${appFile.name} @ 0x${offset.toString(16)}`);
      }
    }

    const eraseAll = eraseFlashCheckbox.checked;
    appendLog(`⚡ Bắt đầu tiến trình Flash (${fileArray.length} phân vùng, Erase All = ${eraseAll})...`, "warn-text");

    const flashOptions = {
      fileArray: fileArray,
      flashSize: "keep",
      eraseAll: eraseAll,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const percent = Math.floor((written / total) * 100);
        flashProgressBar.style.width = `${percent}%`;
        flashProgressPercent.textContent = `${percent}%`;
        flashProgressText.textContent = `Đang ghi phân vùng ${fileIndex + 1}/${fileArray.length}: ${percent}% (${written}/${total} bytes)`;
      },
      calculateMD5Hash: (image) => CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)).toString()
    };

    await esploader.writeFlash(flashOptions);

    flashProgressBar.style.width = "100%";
    flashProgressPercent.textContent = "100%";
    flashProgressText.textContent = "✅ Nạp Firmware ESPX hoàn tất thành công!";
    appendLog("🎉🎉🎉 CHÚC MỪNG! Nạp Firmware ESPX hoàn tất thành công 100%!", "success-text");
    appendLog("💡 Hãy nhấn nút 'Reset Chip' hoặc nhấn nút EN/RST trên bo mạch để chạy phần mềm mới.");

  } catch (err) {
    console.error(err);
    appendLog(`❌ Lỗi khi nạp Firmware: ${err.message}`, "error-text");
    flashProgressText.textContent = `Lỗi: ${err.message}`;
  } finally {
    btnFlash.disabled = false;
  }
});

// Nút Reset Chip cứng
btnResetBoard.addEventListener("click", async () => {
  if (!esploader) return;
  try {
    appendLog("🔄 Đang gửi tín hiệu Reset chip ESP32...");
    await esploader.hardReset();
    appendLog("✅ Đã kích hoạt Reset chip thành công!", "success-text");
  } catch (err) {
    appendLog(`❌ Lỗi reset: ${err.message}`, "error-text");
  }
});

// Khởi chạy khi tải trang
initVersionSelector();
