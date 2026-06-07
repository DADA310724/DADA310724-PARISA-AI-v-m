(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const BASE = (() => { const p = location.pathname.replace(/\/$/, ""); return p || ""; })();
  const api = (path) => `${BASE}${path}`;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ── LocalStorage keys ────────────────────────────────────────────
  const LS_SETTINGS = "parisa.settings.v2";
  const LS_CHATS    = "parisa.chats.v1";
  const LS_ACTIVE   = "parisa.active.v1";
  const LS_WELCOMED = "parisa.welcomed.v1";

  const WELCOME_TEXT = `আসসালামু ওয়ালাইকুম।
PARISA MEMORY PORTAL এ আপনাকে স্বাগতম।

আমি এই সিস্টেমের অফিশিয়াল এআই রিপ্রেজেন্টেটিভ (PARISA)।
আমাকে তৈরী করেছেন আমার ডেভলপার (দাদা)।

আমার কাজ হল পারিসা মেমোরি পোর্টালের এআই সহকারী হিসেবে "পারিসা ও রুবেল" — তাদের বৈবাহিক সম্পর্ক, তাদের জীবনের দীর্ঘ এই আড়াই বছরের ঘটনা ও অজানা বাস্তব প্রমাণ সহকারে তুলে ধরা। পারিসার পরিবারের বিভিন্ন পদক্ষেপ এবং এর পেছনের যাবতীয় আইনি ধারা ও ব্ল্যাক ম্যাজিক সম্পর্কিত নিখুঁত তদন্তের রিপোর্ট বিশ্লেষণ করার দায়িত্ব আমার।

আমার কাছে রুবেল ও পারিসার ভালোবাসা, বিবাহ, জীবনের সকল স্মৃতি এবং প্রমাণ সংরক্ষিত আছে।

আমি যা করতে পারি:
• তাদের সম্পর্কের গল্প ও ইতিহাস বলতে পারি
• চ্যাট হিস্টরি, ছবি, স্ক্রিনশট বিশ্লেষণ করে সত্যতা প্রমাণ করতে পারি
• বাংলাদেশের বিবাহ আইন, ডিভোর্স আইন সম্পর্কে বিস্তারিত আইনি ধারা বলতে পারি
• ব্ল্যাক ম্যাজিকের ভয়াবহ প্রভাব সম্পর্কে বিশ্লেষণ করে বলতে পারি

বলুন, আজ আপনাকে কীভাবে সহযোগিতা করতে পারি?`;

  // ── Settings ─────────────────────────────────────────────────────
  const defaultSettings = { voiceGender: "female", userName: "দাদা" };

  let settings = loadSettings();
  let chats    = loadChats();
  let activeId = localStorage.getItem(LS_ACTIVE) || null;
  let pendingAttachment = null;

  function loadSettings() {
    try { return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}")) }; }
    catch { return { ...defaultSettings }; }
  }
  function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

  function loadChats() {
    try { return JSON.parse(localStorage.getItem(LS_CHATS) || "{}"); } catch { return {}; }
  }
  function persistChats() { localStorage.setItem(LS_CHATS, JSON.stringify(chats)); }

  function newChat() {
    const id = uid();
    chats[id] = { id, title: "নতুন চ্যাট", messages: [], pinned: false, updatedAt: Date.now() };
    activeId = id;
    localStorage.setItem(LS_ACTIVE, id);
    persistChats();
    renderChat();
    renderSidebar();
  }
  function getActive() {
    if (!activeId || !chats[activeId]) return null;
    return chats[activeId];
  }

  // ── Rendering ────────────────────────────────────────────────────
  const messagesEl = $("#messages");
  const welcomeEl  = $("#welcome");

  function renderChat() {
    const c = getActive();
    messagesEl.innerHTML = "";
    if (!c || c.messages.length === 0) {
      welcomeEl.style.display = "flex";
      messagesEl.classList.remove("show");
      return;
    }
    welcomeEl.style.display = "none";
    messagesEl.classList.add("show");
    for (const m of c.messages) appendMessage(m, false);
    scrollToBottom();
  }

  function appendMessage(m, animate = true) {
    const row = document.createElement("div");
    row.className = "msg-row " + (m.role === "user" ? "user" : "assistant");
    const bubble = document.createElement("div");
    bubble.className = "msg " + (m.role === "user" ? "user" : "assistant");
    if (m.image) {
      const img = document.createElement("img");
      img.className = "attached"; img.src = m.image;
      bubble.appendChild(img);
    }
    const body = document.createElement("div");
    body.className = "msg-body";
    if (m.role === "assistant") {
      body.innerHTML = renderMarkdown(m.text || "");
    } else {
      body.textContent = m.text || "";
    }
    bubble.appendChild(body);
    if (m.role === "assistant" && m.text) bubble.appendChild(makeMsgActions(m.text, bubble));
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    if (animate) scrollToBottom();
    return { row, bubble, body };
  }

  function makeMsgActions(text, bubble) {
    const acts = document.createElement("div");
    acts.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.innerHTML = `<svg class="ic"><use href="#i-copy"/></svg> কপি`;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text);
      copyBtn.innerHTML = `<svg class="ic"><use href="#i-copy"/></svg> হয়েছে`;
      setTimeout(() => (copyBtn.innerHTML = `<svg class="ic"><use href="#i-copy"/></svg> কপি`), 1200);
    };
    const speakBtn = document.createElement("button");
    speakBtn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> ভয়েস`;
    speakBtn.onclick = () => speak(text, speakBtn);
    acts.append(copyBtn, speakBtn);
    return acts;
  }

  function renderMarkdown(text) {
    try { return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true })); }
    catch { return text.replace(/\n/g, "<br/>"); }
  }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }

  // ── Sidebar ──────────────────────────────────────────────────────
  function renderSidebar() {
    const pinned = $("#pinnedList"), recent = $("#recentList");
    pinned.innerHTML = ""; recent.innerHTML = "";
    const list = Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const c of list) (c.pinned ? pinned : recent).appendChild(makeChatItem(c));
    if (!pinned.children.length) pinned.innerHTML = `<div style="opacity:.45;font-size:12px;padding:6px 4px;">কিছুই পিন করা নেই</div>`;
    if (!recent.children.length) recent.innerHTML = `<div style="opacity:.45;font-size:12px;padding:6px 4px;">সাম্প্রতিক কোনো চ্যাট নেই</div>`;
  }
  function makeChatItem(c) {
    const el = document.createElement("div");
    el.className = "chat-item" + (c.id === activeId ? " active" : "");
    el.innerHTML = `<div class="ci-title">${escapeHtml(c.title || "নতুন চ্যাট")}</div>
      <div class="ci-act">
        <button title="পিন"><svg class="ic"><use href="#i-pin"/></svg></button>
        <button title="রিনেম"><svg class="ic"><use href="#i-edit"/></svg></button>
        <button title="ডিলিট"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>`;
    const [pinBtn, renameBtn, delBtn] = el.querySelectorAll(".ci-act button");
    el.querySelector(".ci-title").onclick = () => {
      activeId = c.id; localStorage.setItem(LS_ACTIVE, c.id);
      renderChat(); renderSidebar(); closeSidebar();
    };
    pinBtn.onclick = (e) => { e.stopPropagation(); c.pinned = !c.pinned; persistChats(); renderSidebar(); };
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      const t = prompt("নতুন নাম:", c.title);
      if (t != null) { c.title = t.trim() || c.title; persistChats(); renderSidebar(); }
    };
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm("চ্যাট ডিলিট করবেন?")) {
        delete chats[c.id];
        if (activeId === c.id) activeId = null;
        persistChats(); renderSidebar(); renderChat();
      }
    };
    return el;
  }

  // ── Sidebar open/close ───────────────────────────────────────────
  function openSidebar()  { $("#sidebar").classList.add("open"); $("#sidebarScrim").classList.add("show"); }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebarScrim").classList.remove("show"); }
  $("#openSidebar").onclick  = openSidebar;
  $("#closeSidebar").onclick = closeSidebar;
  $("#sidebarScrim").onclick = closeSidebar;
  $("#newChatBtn").onclick   = () => { newChat(); closeSidebar(); };

  // ── Settings modal ───────────────────────────────────────────────
  const settingsModal = $("#settingsModal");
  const settingsScrim = $("#settingsScrim");

  function openSettings() {
    const g = settings.voiceGender || "female";
    document.querySelector(`input[name="voiceGender"][value="${g}"]`).checked = true;
    $("#userName").value = settings.userName || "";
    settingsModal.classList.add("show");
    settingsScrim.classList.add("show");
  }
  function closeSettings() {
    settingsModal.classList.remove("show");
    settingsScrim.classList.remove("show");
  }
  $("#openSettings").onclick  = openSettings;
  $("#closeSettings").onclick = closeSettings;
  settingsScrim.onclick       = closeSettings;

  $("#saveSettings").onclick = () => {
    const sel = document.querySelector('input[name="voiceGender"]:checked');
    settings.voiceGender = sel ? sel.value : "female";
    settings.userName    = $("#userName").value.trim() || "দাদা";
    saveSettings();
    closeSettings();
  };
  $("#resetSettings").onclick = () => {
    if (confirm("সব সেটিংস রিসেট করবেন?")) {
      settings = { ...defaultSettings };
      saveSettings();
      openSettings();
    }
  };
  $("#testVoice").onclick = () => {
    speak("আসসালামু ওয়ালাইকুম। আমি পারিসা, আপনাকে স্বাগতম।");
  };

  // ── Voice: Microsoft Edge TTS ─────────────────────────────────────
  let currentAudio = null;

  async function speak(text, btn = null) {
    if (!text || !text.trim()) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (btn) btn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> লোড…`;
    try {
      const r = await fetch(api("/voice"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 1500), gender: settings.voiceGender || "female" }),
      });
      if (!r.ok || r.status === 204) {
        if (btn) btn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> ভয়েস`;
        return;
      }
      const blob = await r.blob();
      currentAudio = new Audio(URL.createObjectURL(blob));
      if (btn) {
        btn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> চলছে`;
        currentAudio.onended = () => (btn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> ভয়েস`);
      }
      await currentAudio.play();
    } catch {
      if (btn) btn.innerHTML = `<svg class="ic"><use href="#i-volume"/></svg> ভয়েস`;
    }
  }

  function speakAndWait(text) {
    return new Promise(async (resolve) => {
      if (!text || !text.trim()) return resolve();
      try {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const r = await fetch(api("/voice"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 1500), gender: settings.voiceGender || "female" }),
        });
        if (!r.ok || r.status === 204) return resolve();
        const blob = await r.blob();
        currentAudio = new Audio(URL.createObjectURL(blob));
        currentAudio.onended = () => resolve();
        currentAudio.onerror = () => resolve();
        await currentAudio.play();
      } catch { resolve(); }
    });
  }

  // ── Composer ─────────────────────────────────────────────────────
  const composerInput = $("#composerInput");
  composerInput.addEventListener("input", () => {
    composerInput.style.height = "auto";
    composerInput.style.height = Math.min(composerInput.scrollHeight, 180) + "px";
  });
  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $("#sendBtn").onclick  = sendMessage;
  $("#attachBtn").onclick = () => $("#fileInput").click();
  $("#fileInput").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    pendingAttachment = { dataUrl, mime: f.type || "application/octet-stream", name: f.name };
    renderAttachedBar();
    e.target.value = "";
  });
  function renderAttachedBar() {
    const bar = $("#attachedBar");
    bar.innerHTML = "";
    if (!pendingAttachment) return;
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `📎 ${escapeHtml(pendingAttachment.name)} <button title="বাদ দিন">✕</button>`;
    chip.querySelector("button").onclick = () => { pendingAttachment = null; renderAttachedBar(); };
    bar.appendChild(chip);
  }
  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Suggestion buttons
  $$(".sugg").forEach(b => b.addEventListener("click", () => {
    composerInput.value = b.textContent.trim();
    sendMessage();
  }));

  // ── Send message ─────────────────────────────────────────────────
  async function sendMessage() {
    const text = composerInput.value.trim();
    if (!text && !pendingAttachment) return;
    if (!getActive()) newChat();
    const c = getActive();

    const userMsg = { role: "user", text: text || "এই ফাইলটা দেখো", image: pendingAttachment?.dataUrl };
    c.messages.push(userMsg);
    if (c.messages.length === 1) c.title = (text || "ফাইল").slice(0, 36);
    c.updatedAt = Date.now();
    persistChats(); renderSidebar();

    welcomeEl.style.display = "none";
    messagesEl.classList.add("show");
    appendMessage(userMsg);

    composerInput.value = "";
    composerInput.style.height = "auto";

    const typing = document.createElement("div");
    typing.className = "msg-row assistant";
    typing.innerHTML = `<div class="msg assistant"><div class="typing"><span></span><span></span><span></span></div></div>`;
    messagesEl.appendChild(typing);
    scrollToBottom();

    const attachment = pendingAttachment;
    pendingAttachment = null;
    renderAttachedBar();

    try {
      let reply;
      if (attachment && !attachment.mime.startsWith("image/")) {
        const r = await fetch(api("/analyze"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text || "এই ফাইলটা বিশ্লেষণ করে বাংলায় বল।",
            file: attachment.dataUrl, mime: attachment.mime,
            userName: settings.userName,
          }),
        });
        reply = (await r.json()).reply;
      } else {
        const msgs = c.messages.map(m => ({ role: m.role, text: m.text }));
        const r = await fetch(api("/chat"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs,
            userName: settings.userName,
            image: attachment?.dataUrl,
          }),
        });
        reply = (await r.json()).reply;
      }

      typing.remove();
      const botMsg = { role: "assistant", text: reply || "(কোনো উত্তর নেই)" };
      c.messages.push(botMsg);
      c.updatedAt = Date.now();
      persistChats(); renderSidebar();

      // Typing animation + auto-play voice
      typeOut(botMsg, () => {});
      speak(botMsg.text);          // auto-play immediately

    } catch {
      typing.remove();
      const botMsg = { role: "assistant", text: "দুঃখিত, এই মুহূর্তে যোগাযোগ করতে পারছি না।" };
      c.messages.push(botMsg);
      persistChats();
      appendMessage(botMsg);
      speak(botMsg.text);
    }
  }

  // ── Typing animation ─────────────────────────────────────────────
  function typeOut(m, onDone = () => {}) {
    const { body, bubble } = appendMessage({ role: "assistant", text: "" });
    const full = m.text;
    let i = 0;
    const step = Math.max(1, Math.floor(full.length / 200));
    const iv = setInterval(() => {
      i = Math.min(full.length, i + step);
      body.innerHTML = renderMarkdown(full.slice(0, i));
      scrollToBottom();
      if (i >= full.length) {
        clearInterval(iv);
        bubble.appendChild(makeMsgActions(full, bubble));
        onDone();
      }
    }, 18);
  }

  // ── Speech-to-text ────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null, recOn = false;
  function makeRecognizer(lang = "bn-BD") {
    if (!SR) return null;
    const r = new SR();
    r.lang = lang; r.interimResults = true; r.continuous = false;
    return r;
  }
  $("#micBtn").onclick = () => {
    if (!SR) { alert("আপনার ব্রাউজার ভয়েস ইনপুট সাপোর্ট করে না।"); return; }
    if (recOn && recognizer) { recognizer.stop(); return; }
    recognizer = makeRecognizer();
    recOn = true;
    $("#micBtn").classList.add("active");
    let finalText = "";
    recognizer.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      composerInput.value = finalText || interim;
    };
    recognizer.onend = () => {
      recOn = false; $("#micBtn").classList.remove("active");
      if (composerInput.value.trim()) sendMessage();
    };
    recognizer.onerror = () => { recOn = false; $("#micBtn").classList.remove("active"); };
    recognizer.start();
  };

  // ── Camera mode ───────────────────────────────────────────────────
  let camStream = null, camFacing = "environment";
  async function startCam(view, video, facing) {
    try {
      if (camStream) camStream.getTracks().forEach(t => t.stop());
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
      video.srcObject = camStream; view.hidden = false;
    } catch (e) { alert("ক্যামেরা চালু করা যাচ্ছে না: " + e.message); }
  }
  function stopCam() { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }
  function snapshot(video, canvas) {
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  $("#cameraBtn").onclick = () => startCam($("#cameraView"), $("#camVideo"), camFacing);
  $("#closeCam").onclick  = () => { stopCam(); $("#cameraView").hidden = true; };
  $("#flipCam").onclick   = () => { camFacing = camFacing === "environment" ? "user" : "environment"; startCam($("#cameraView"), $("#camVideo"), camFacing); };

  async function askAboutCamera(promptText) {
    const cap = $("#camCaption");
    cap.textContent = "দেখছি…";
    const img = snapshot($("#camVideo"), $("#camCanvas"));
    try {
      const r = await fetch(api("/analyze"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText || "এই ছবিতে কী দেখা যাচ্ছে? বাংলায় সংক্ষেপে বল।", file: img, mime: "image/jpeg", userName: settings.userName }),
      });
      const data = await r.json();
      cap.textContent = data.reply || "কিছু বুঝতে পারলাম না।";
      speak(cap.textContent);
    } catch { cap.textContent = "নেটওয়ার্ক সমস্যা।"; }
  }
  $("#askCamBtn").onclick = () => askAboutCamera();
  $("#camMicBtn").onclick = () => {
    if (!SR) { askAboutCamera(); return; }
    const r = makeRecognizer();
    $("#camCaption").textContent = "শুনছি…";
    let finalText = "";
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript; $("#camCaption").textContent = finalText; };
    r.onend = () => askAboutCamera(finalText.trim() || "এটা কী?");
    r.start();
  };

  // ── Audio call ─────────────────────────────────────────────────────
  let callOn = false, callRecognizer = null;
  $("#audioCallBtn").onclick  = () => startAudioCall();
  $("#endAudioCall").onclick  = () => endAudioCall();
  $("#muteAudioCall").onclick = () => { if (callRecognizer) callRecognizer.stop(); };

  async function startAudioCall() {
    if (!SR) { alert("ব্রাউজার ভয়েস কল সাপোর্ট করে না।"); return; }
    callOn = true;
    $("#audioCallView").hidden = false;
    $("#audioCallStatus").textContent = "শুনছি…";
    $("#audioCallCaption").textContent = "";
    callLoop();
  }
  function endAudioCall() {
    callOn = false;
    if (callRecognizer) { try { callRecognizer.stop(); } catch {} }
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    $("#audioCallView").hidden = true;
  }
  function callLoop() {
    if (!callOn) return;
    callRecognizer = makeRecognizer();
    if (!callRecognizer) return;
    let finalText = "";
    callRecognizer.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      $("#audioCallCaption").textContent = finalText;
    };
    callRecognizer.onerror = () => { if (callOn) setTimeout(callLoop, 600); };
    callRecognizer.onend = async () => {
      if (!callOn) return;
      const said = finalText.trim();
      if (!said) return setTimeout(callLoop, 200);
      $("#audioCallStatus").textContent = "ভাবছি…";
      const reply = await callChat(said);
      if (!callOn) return;
      $("#audioCallStatus").textContent = "বলছি…";
      $("#audioCallCaption").textContent = reply;
      await speakAndWait(reply);
      if (!callOn) return;
      $("#audioCallStatus").textContent = "শুনছি…";
      callLoop();
    };
    callRecognizer.start();
  }
  async function callChat(text) {
    if (!getActive()) newChat();
    const c = getActive();
    c.messages.push({ role: "user", text }); c.updatedAt = Date.now(); persistChats();
    try {
      const r = await fetch(api("/chat"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: c.messages.map(m => ({ role: m.role, text: m.text })), userName: settings.userName }),
      });
      const data = await r.json();
      const reply = data.reply || "...";
      c.messages.push({ role: "assistant", text: reply }); persistChats();
      return reply;
    } catch { return "দুঃখিত, যোগাযোগ করতে পারছি না।"; }
  }

  // ── Video call ─────────────────────────────────────────────────────
  let vcStream = null, vcFacing = "user", vcOn = false, vcRecognizer = null;
  $("#videoCallBtn").onclick   = () => startVideoCall();
  $("#endVideoCall").onclick   = () => endVideoCall();
  $("#flipVideoCall").onclick  = async () => { vcFacing = vcFacing === "user" ? "environment" : "user"; await openVcCam(); };
  $("#muteVideoCall").onclick  = () => { if (vcRecognizer) vcRecognizer.stop(); };

  async function openVcCam() {
    try {
      if (vcStream) vcStream.getTracks().forEach(t => t.stop());
      vcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: vcFacing }, audio: false });
      $("#videoCallVideo").srcObject = vcStream;
    } catch (e) { alert("ক্যামেরা চালু করা যাচ্ছে না: " + e.message); }
  }
  async function startVideoCall() {
    if (!SR) { alert("ব্রাউজার ভয়েস ইনপুট সাপোর্ট করে না।"); return; }
    vcOn = true;
    $("#videoCallView").hidden = false;
    $("#videoCallStatus").textContent = "কানেক্টেড";
    $("#videoCallCaption").textContent = "";
    await openVcCam();
    videoCallLoop();
  }
  function endVideoCall() {
    vcOn = false;
    if (vcRecognizer) { try { vcRecognizer.stop(); } catch {} }
    if (vcStream) { vcStream.getTracks().forEach(t => t.stop()); vcStream = null; }
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    $("#videoCallView").hidden = true;
  }
  function videoCallLoop() {
    if (!vcOn) return;
    vcRecognizer = makeRecognizer();
    if (!vcRecognizer) return;
    let finalText = "";
    vcRecognizer.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript; $("#videoCallCaption").textContent = finalText; };
    vcRecognizer.onerror = () => { if (vcOn) setTimeout(videoCallLoop, 600); };
    vcRecognizer.onend = async () => {
      if (!vcOn) return;
      const said = finalText.trim();
      if (!said) return setTimeout(videoCallLoop, 200);
      $("#videoCallStatus").textContent = "ভাবছি…";
      const img = snapshot($("#videoCallVideo"), $("#videoCallCanvas"));
      try {
        const r = await fetch(api("/analyze"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: said, file: img, mime: "image/jpeg", userName: settings.userName }),
        });
        const data = await r.json();
        const reply = data.reply || "কিছু বুঝতে পারলাম না।";
        $("#videoCallStatus").textContent = "বলছি…";
        $("#videoCallCaption").textContent = reply;
        await speakAndWait(reply);
      } catch { $("#videoCallCaption").textContent = "নেটওয়ার্ক সমস্যা"; }
      if (!vcOn) return;
      $("#videoCallStatus").textContent = "কানেক্টেড";
      videoCallLoop();
    };
    vcRecognizer.start();
  }

  // ── Welcome message (one-time) ────────────────────────────────────
  function showWelcomeIfFirst() {
    if (localStorage.getItem(LS_WELCOMED)) return;
    localStorage.setItem(LS_WELCOMED, "1");
    if (!getActive()) newChat();
    const c = getActive();
    const welcomeMsg = { role: "assistant", text: WELCOME_TEXT };
    c.messages.push(welcomeMsg);
    c.updatedAt = Date.now();
    persistChats();
    renderChat();
    // Auto-play short intro after 1.5s
    setTimeout(() => speak("আসসালামু ওয়ালাইকুম। পারিসা মেমোরি পোর্টালে আপনাকে স্বাগতম।"), 1500);
  }

  // ── PWA service worker ────────────────────────────────────────────
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ── Init ──────────────────────────────────────────────────────────
  if (Object.keys(chats).length === 0) newChat();
  else { renderChat(); renderSidebar(); }
  showWelcomeIfFirst();
})();
