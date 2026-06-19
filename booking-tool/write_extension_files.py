#!/usr/bin/env python3
"""Write updated Maps Scraper extension files to Desktop."""

import os

DESKTOP = os.path.expanduser("~/Desktop/maps-scraper-extension final (1)")

# ─── 1. BACKGROUND.JS ────────────────────────────────
background_js = """\
// background.js v2.0 — Persistent Service Worker for Maps Lead Scraper
let sessionState = {
  isRunning: false,
  data: [],
  targetCount: 50,
  currentTabId: null,
  currentQuery: "",
  currentCity: "",
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Start a new scrape session (from popup)
  if (msg.action === "NEW_SCRAPE") {
    sessionState.isRunning = true;
    sessionState.data = [];
    sessionState.targetCount = msg.count || 50;
    sessionState.currentQuery = msg.query || "";
    sessionState.currentCity = msg.city || "";
    sessionState.currentTabId = msg.tabId;

    const url = `https://www.google.com/maps/search/${msg.query} in ${msg.city}`;
    chrome.tabs.update(msg.tabId, { url }).then(() => {
      chrome.tabs.onUpdated.addListener(function listener(id, info) {
        if (id === msg.tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => injectAndStart(msg.tabId, msg.count), 3000);
        }
      });
    });
    sendResponse({ success: true, message: "Scrape session started" });
    return true;
  }

  // Progress updates from content script
  if (msg.action === "PROGRESS") {
    if (msg.data) sessionState.data = msg.data;
    sessionState.isRunning = msg.isRunning !== undefined ? msg.isRunning : sessionState.isRunning;
    chrome.runtime.sendMessage({
      action: "PROGRESS_UPDATE",
      count: msg.count || 0,
      target: msg.target || sessionState.targetCount,
      isRunning: sessionState.isRunning,
    }).catch(() => {});
    sendResponse({ received: true });
    return true;
  }

  // Get session data (from popup)
  if (msg.action === "GET_SESSION") {
    sendResponse({
      isRunning: sessionState.isRunning,
      data: sessionState.data,
      targetCount: sessionState.targetCount,
    });
    return true;
  }

  // Stop session (from popup)
  if (msg.action === "STOP_SESSION") {
    sessionState.isRunning = false;
    if (sessionState.currentTabId) {
      chrome.tabs.sendMessage(sessionState.currentTabId, { action: "STOP_SCRAPE" }).catch(() => {});
    }
    sendResponse({ success: true, data: sessionState.data });
    return true;
  }

  // Download CSV (from popup)
  if (msg.action === "DOWNLOAD_CSV") {
    const data = sessionState.data;
    if (!data || data.length === 0) {
      sendResponse({ success: false, error: "No data to download" });
      return true;
    }

    const headers = ["Name","Rating","Reviews","Category","Address","Phone","Website","Email"];
    const rows = data.map(b =>
      [b.name,b.rating,b.reviews,b.category,b.address,b.phone,b.website,b.email]
        .map(v => `"${(v || "").toString().replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    // Use data URI instead of Blob URL — URL.createObjectURL is not available in service workers
    const dataUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);

    chrome.downloads.download({ url: dataUrl, filename: `leads_${Date.now()}.csv`, saveAs: false }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function injectAndStart(tabId, count) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await sleep(2000);
    const res = await chrome.tabs.sendMessage(tabId, { action: "START_SCRAPE", count });
    if (res && res.success) {
      sessionState.data = res.data || [];
      sessionState.isRunning = false;
      chrome.runtime.sendMessage({ action: "SCRAPE_COMPLETE", count: sessionState.data.length, data: sessionState.data }).catch(() => {});
    }
  } catch (e) {
    console.error("Inject/start failed:", e);
    sessionState.isRunning = false;
    chrome.runtime.sendMessage({ action: "SCRAPE_ERROR", error: e.message }).catch(() => {});
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
chrome.runtime.onInstalled.addListener(() => console.log("Maps Lead Scraper background worker v2.0 installed"));
"""

# ─── 2. CONTENT.JS v2.0 — HUMAN-LIKE SCROLLING ──────
content_js = """\
// content.js v2.0 — Google Maps business scraper with human-like scrolling
console.log("✅ Content script v2.0 LOADED");

let scrapedData = [];
let isRunning = false;
let targetCount = 50;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_SCRAPE') {
    targetCount = msg.count || 50;
    scrapedData = [];
    isRunning = true;
    startScraping().then(() => {
      sendResponse({ success: true, data: scrapedData });
    });
    return true;
  }
  if (msg.action === 'STOP_SCRAPE') {
    isRunning = false;
    sendResponse({ success: true, data: scrapedData });
    return true;
  }
  if (msg.action === 'GET_DATA') {
    sendResponse({ data: scrapedData });
    return true;
  }
});

// ─── HUMAN-LIKE SCROLLING ────────────────────
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanScroll(container) {
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  const currentScroll = container.scrollTop;
  const remaining = scrollHeight - currentScroll - clientHeight;

  if (remaining <= 0) return;

  // Scroll in small, random increments like a human
  const scrollAmount = Math.min(
    remaining,
    randomDelay(150, 400)  // 150-400px per scroll, like a person scanning
  );

  container.scrollBy({ top: scrollAmount, behavior: 'smooth' });

  // Random pause between scrolls (800-2000ms)
  await sleep(randomDelay(800, 2000));

  // 30% chance of a micro-pause (hesitation)
  if (Math.random() < 0.3) {
    await sleep(randomDelay(400, 1200));
  }
}

async function humanScrollPattern(panel) {
  // Scroll in multiple small bursts with varying delays
  for (let i = 0; i < randomDelay(2, 4); i++) {
    if (!isRunning) return;
    await humanScroll(panel);

    // 20% chance of a "double scroll" - two quick scrolls in a row
    if (Math.random() < 0.2) {
      await sleep(300);
      await humanScroll(panel);
    }
  }
}

// ─── START SCRAPING ─────────────────────────
async function startScraping() {
  // Initial wait for Maps to fully render
  await sleep(randomDelay(3000, 5000));

  const panel = getResultsPanel();
  if (!panel) {
    console.log("❌ No results panel found");
    chrome.runtime.sendMessage({
      action: 'PROGRESS',
      count: 0,
      target: targetCount,
      isRunning: false,
      data: scrapedData
    });
    return;
  }
  console.log("✅ Found results panel");

  let lastCount = 0;
  let stallCount = 0;
  let consecutiveNoNewData = 0;

  while (isRunning && scrapedData.length < targetCount) {
    // Extract visible data
    await extractAll();

    // Report progress to background worker
    chrome.runtime.sendMessage({
      action: 'PROGRESS',
      count: scrapedData.length,
      target: targetCount,
      isRunning: isRunning,
      data: scrapedData
    });

    // Human-like scrolling pattern
    await humanScrollPattern(panel);

    // Check progress
    if (scrapedData.length === lastCount) {
      stallCount++;
      consecutiveNoNewData++;

      // After 3 stalls, try a bigger scroll
      if (stallCount >= 3) {
        console.log("🔄 Big scroll to trigger lazy load...");
        panel.scrollTop = panel.scrollHeight;
        await sleep(randomDelay(3000, 5000));
      }

      if (stallCount >= 6) {
        console.log("⏹️ No progress after 6 attempts, stopping");
        break;
      }
    } else {
      stallCount = 0;
      consecutiveNoNewData = 0;
    }

    lastCount = scrapedData.length;
  }

  isRunning = false;
  chrome.runtime.sendMessage({
    action: 'PROGRESS',
    count: scrapedData.length,
    target: targetCount,
    isRunning: false,
    data: scrapedData
  });
}

// ─── FIND RESULTS PANEL ─────────────────────
function getResultsPanel() {
  const selectors = [
    'div[role="feed"]',
    '[aria-label*="Results for"]',
    '[aria-label*="results"]',
    '.m6QErb',
    '.section-scrollbox',
    '.section-layout',
    '[data-item-index]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight) return el;
  }

  // Fallback: find large scrollable container on the left
  const allDivs = document.querySelectorAll('div');
  for (const div of allDivs) {
    const rect = div.getBoundingClientRect();
    const style = window.getComputedStyle(div);
    if (rect.left < 400 && rect.height > 400 &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll' || div.scrollHeight > div.clientHeight + 100)) {
      return div;
    }
  }
  return null;
}

// ─── GET BUSINESS CARDS ─────────────────────
function getCards() {
  const selectors = [
    'a[href*="/maps/place/"]',
    'div[role="article"]',
    'div[data-result-index]',
    '[data-item-index]',
    '.Nv2PK',
    '.THQddc',
  ];

  let bestCards = [];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > bestCards.length) {
      bestCards = Array.from(els);
    }
  }

  if (bestCards.length > 0) {
    console.log(`Found ${bestCards.length} cards`);
  }
  return bestCards;
}

// ─── EXTRACT ALL ────────────────────────────
async function extractAll() {
  await sleep(1000);
  const cards = getCards();
  console.log("Processing cards:", cards.length);

  for (const card of cards) {
    try {
      const data = extractFromCard(card);
      if (data && data.name) addIfNew(data);
    } catch (e) {
      console.log("Error parsing card:", e);
    }
  }
}

// ─── EXTRACT FROM CARD ──────────────────────
function extractFromCard(card) {
  const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/maps/place/"]');

  // Get container for more data
  let container = card;
  if (link && card === link) {
    for (let i = 0; i < 5; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      if (container.querySelector('h3, .fontHeadlineSmall, [class*="title"], [class*="name"]')) break;
    }
  }

  // NAME
  let name = '';
  const nameSelectors = ['h3', '.fontHeadlineSmall', '.qBF1Pd', '[class*="title"]', '[class*="name"]', 'span[aria-label]', '.Io6YTe'];
  for (const sel of nameSelectors) {
    const el = container.querySelector(sel) || card.querySelector(sel);
    if (el) {
      name = clean(el.textContent || el.getAttribute('aria-label') || '');
      if (name) break;
    }
  }
  if (!name && link) {
    const label = link.getAttribute('aria-label');
    if (label) name = clean(label);
  }
  if (!name || name.length < 2) return null;

  // RATING
  let rating = '';
  const texts = container.textContent || '';
  const ratingMatch = texts.match(/([\\d.]+)\\s*star/i);
  if (ratingMatch) rating = ratingMatch[1];

  // REVIEWS
  let reviews = '';
  const reviewMatch = texts.match(/\\(([\\d,]+)\\)/);
  if (reviewMatch) reviews = reviewMatch[1];

  // CATEGORY
  let category = '';
  const categorySelectors = ['.W4Efsd:first-child span', '.subtitle', '[class*="category"]'];
  for (const sel of categorySelectors) {
    const el = container.querySelector(sel) || card.querySelector(sel);
    if (el) {
      const text = clean(el.textContent);
      if (text && text.length > 2 && text.length < 50 && !text.match(/^[\\d.]+$/) && text !== name) {
        category = text;
        break;
      }
    }
  }

  // ADDRESS
  let address = '';
  const allSpans = container.querySelectorAll('span, div');
  for (const span of allSpans) {
    const text = span.textContent || '';
    if (text.match(/\\d+\\s+[^,]+,\\s*[^,]+/) || text.match(/.+\\d{5,}/)) {
      address = clean(text);
      break;
    }
  }

  // PHONE
  let phone = '';
  const phoneMatches = texts.match(/(\\+?1?[-.\\s]?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4})/g);
  if (phoneMatches) phone = phoneMatches[0];

  // WEBSITE
  let website = '';
  const webSelectors = ['a[data-value="Website"]', 'a[aria-label*="website"]', 'a[aria-label*="Website"]'];
  for (const sel of webSelectors) {
    const el = container.querySelector(sel) || card.querySelector(sel);
    if (el && el.href && !el.href.includes('google')) { website = el.href; break; }
  }
  if (!website) {
    const allLinks = container.querySelectorAll('a[href^="http"]');
    for (const l of allLinks) {
      if (!l.href.includes('google.com') && !l.href.includes('goo.gl')) { website = l.href; break; }
    }
  }

  // EMAIL
  let email = '';
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
  const emailMatches = texts.match(emailRegex);
  if (emailMatches) {
    for (const match of emailMatches) {
      if (!match.toLowerCase().match(/\\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
        email = match;
        break;
      }
    }
  }

  return { name, rating, reviews, category, address, phone, website, email, scrapedAt: new Date().toISOString() };
}

// ─── HELPERS ────────────────────────────────
function addIfNew(biz) {
  const key = biz.name.toLowerCase().trim();
  if (!scrapedData.some(d => d.name.toLowerCase().trim() === key)) {
    scrapedData.push(biz);
    console.log("✅ Added:", biz.name);
  }
}

function clean(text) {
  if (!text) return '';
  return text.trim().replace(/\\s+/g, ' ').replace(/\\n/g, ' ');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
"""

# ─── 3. POPUP.JS v2.0 — BACKGROUND WORKER COMMS ─────
popup_js = """\
// popup.js v2.0 — Communicates via background service worker
let allData = [];

const btnStart = document.getElementById('btn-start');
const btnStop  = document.getElementById('btn-stop');
const btnCsv   = document.getElementById('btn-csv');
const statusEl = document.getElementById('status');
const tbody    = document.getElementById('tbody');

// 🚀 START
btnStart.addEventListener('click', async () => {
  const query = document.getElementById('query').value.trim();
  const city  = document.getElementById('city').value.trim();
  const count = parseInt(document.getElementById('count').value);

  if (!query || !city) {
    setStatus('Enter business type & city', 'err');
    return;
  }

  setStatus('Starting scraper via background worker...');
  btnStart.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Send to background worker — it handles navigation, injection, scraping
    const res = await chrome.runtime.sendMessage({
      action: 'NEW_SCRAPE',
      tabId: tab.id,
      query,
      city,
      count,
    });

    if (res && res.success) {
      setStatus('Scraping in progress...');
      btnStop.style.display = 'inline-block';

      // Listen for updates from background worker
      chrome.runtime.onMessage.addListener(function listener(msg) {
        if (msg.action === 'PROGRESS_UPDATE') {
          setStatus(`Scraping... ${msg.count}/${msg.target}`);
        }
        if (msg.action === 'SCRAPE_COMPLETE') {
          chrome.runtime.onMessage.removeListener(listener);
          allData = msg.data || [];
          renderTable(allData);
          btnCsv.disabled = false;
          btnStart.disabled = false;
          btnStop.style.display = 'none';
          setStatus(`✅ Done! ${allData.length} leads scraped`, 'ok');
        }
        if (msg.action === 'SCRAPE_ERROR') {
          chrome.runtime.onMessage.removeListener(listener);
          btnStart.disabled = false;
          btnStop.style.display = 'none';
          setStatus('❌ Error: ' + (msg.error || 'Unknown'), 'err');
        }
      });
    } else {
      throw new Error('Failed to start scrape session');
    }
  } catch (e) {
    setStatus('❌ Error: ' + e.message, 'err');
    btnStart.disabled = false;
  }
});

// 🛑 STOP
btnStop.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'STOP_SESSION' });
    allData = res?.data || [];
    renderTable(allData);
    setStatus('⛔ Stopped');
    btnStop.style.display = 'none';
    btnStart.disabled = false;
    btnCsv.disabled = !allData.length;
  } catch (e) {
    setStatus('Stop failed: ' + e.message, 'err');
    btnStart.disabled = false;
  }
});

// 📥 DOWNLOAD CSV — via background worker
btnCsv.addEventListener('click', async () => {
  if (!allData.length) return;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'DOWNLOAD_CSV' });
    if (res && res.success) {
      setStatus('📁 CSV Downloaded!', 'ok');
    } else {
      setStatus('❌ Download failed: ' + (res?.error || 'Unknown'), 'err');
    }
  } catch (e) {
    setStatus('❌ Download error: ' + e.message, 'err');
  }
});

// 📋 Handle stop errors gracefully
btnStop.addEventListener('error', () => {
  btnStart.disabled = false;
});

// 📊 RENDER TABLE
function renderTable(data) {
  tbody.innerHTML = '';
  let phoneCount = 0;
  let emailCount = 0;

  data.slice(0, 30).forEach(b => {
    if (b.phone) phoneCount++;
    if (b.email) emailCount++;

    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.name}</td><td>${b.rating || '-'}</td><td>${b.phone || '-'}</td><td>${b.email || '-'}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('total').textContent = data.length;
  document.getElementById('phones').textContent = phoneCount;
  document.getElementById('emails').textContent = emailCount;
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (type || '');
}

// Initialize: check if there's a running session
chrome.runtime.sendMessage({ action: 'GET_SESSION' }).then(session => {
  if (session && session.data && session.data.length > 0) {
    allData = session.data;
    renderTable(allData);
    btnCsv.disabled = false;
    if (session.isRunning) {
      setStatus(`Scraping... ${allData.length}/${session.targetCount}`);
      btnStop.style.display = 'inline-block';
    } else {
      setStatus(`✅ ${allData.length} leads from previous session`, 'ok');
    }
  }
}).catch(() => {});
"""

# ─── WRITE FILES ─────────────────────────────
files = {
    "background.js": background_js,
    "content.js": content_js,
    "popup.js": popup_js,
}

for filename, content in files.items():
    path = os.path.join(DESKTOP, filename)
    with open(path, 'w') as f:
        f.write(content.lstrip('\n'))
    print(f"✅ Written: {filename} ({len(content)} bytes)")

print("\n🎉 All files updated! Reload the extension in chrome://extensions")
