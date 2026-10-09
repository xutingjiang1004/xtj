(function () {
  "use strict";
  var state = null,
    sequence = 0,
    applying = false,
    signatureTimer,
    menuKind = "";
  var byId = function (id) {
    return document.getElementById(id);
  };
  function identity() {
    return {
      owner: window.currentUser || "",
      epoch:
        typeof window.__xtjGetAuthEpoch === "function"
          ? window.__xtjGetAuthEpoch()
          : window._authStateEpoch || 0,
    };
  }
  function current(s) {
    var id = identity();
    return !!s && state === s && id.owner === s.owner && id.epoch === s.epoch;
  }
  function safeUrl(value) {
    try {
      var url = new URL(window.xtjUploadDisplayUrl ? window.xtjUploadDisplayUrl(value) : value, location.href);
      return value && /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }
  function view(s) {
    return Object.assign({}, s.settings, s.inflight || {}, s.pending);
  }
  function note(status, message) {
    byId("profilePreferences").dataset.syncState = status;
    byId("profileSettingsStatus").textContent = message || "";
    byId("profileSettingsRetry").hidden = status !== "error";
  }
  function available(value) {
    byId("profilePreferences")
      .querySelectorAll("input,select,button")
      .forEach(function (control) {
        // Clearing this browser's cache does not depend on server settings.
        if (control.id === "xtjClearCacheBtn") return;
        control.disabled = !value;
      });
    byId("profileSettingsRetry").disabled = false;
  }
  function image(kind, value) {
    var button = byId(
      kind === "cover" ? "profileOwnCover" : "profileOwnBackground",
    );
    var img = button.querySelector("img"),
      url = safeUrl(value);
    if (url && img.getAttribute("src") !== url) img.src = url;
    if (!url) img.removeAttribute("src");
    img.hidden = !url;
    button.querySelector("[data-image-label]").textContent = url
      ? "更换"
      : "设置";
  }
  function apply(settings) {
    applying = true;
    var root = document.documentElement,
      url = safeUrl(settings.background_url);
    root.classList.toggle("profile-custom-background", !!url);
    root.style.setProperty(
      "--profile-background",
      url ? "url(" + JSON.stringify(url) + ")" : "none",
    );
    image("cover", settings.cover_url);
    image("background", settings.background_url);
    byId("profileOwnSignature").textContent = settings.signature || "";
    byId("profileOwnSignature").hidden = !settings.signature;
    if (window.XTJThemeController && settings.theme)
      window.XTJThemeController.setMode(settings.theme);
    var id = identity();
    window.__xtjProfileMessagePreferences =
      id.owner && typeof settings.message_notifications === "boolean"
        ? {
            owner: id.owner,
            epoch: id.epoch,
            enabled: settings.message_notifications !== false,
            preview: settings.notification_preview !== false,
          }
        : null;
    document
      .querySelectorAll("#notificationContainer .notification-bubble")
      .forEach(function (bubble) {
        if (settings.message_notifications === false) bubble.remove();
        else if (settings.notification_preview === false) {
          var text = bubble.querySelector(".notification-text");
          if (text) text.textContent = "收到一条新消息";
        }
      });
    window.__xtjDefaultPostVisibility = settings.default_visibility || "public";
    var visibility = byId("postVisibility");
    if (visibility && !byId("postInp")?.value)
      visibility.value = window.__xtjDefaultPostVisibility;
    applying = false;
  }
  function render(s, preserveInput) {
    var settings = view(s);
    apply(settings);
    byId("profilePreferences")
      .querySelectorAll("[name]")
      .forEach(function (input) {
        if (
          preserveInput &&
          input === document.activeElement &&
          input.name === "signature"
        )
          return;
        if (input.type === "checkbox")
          input.checked = settings[input.name] !== false;
        else input.value = settings[input.name] || "";
      });
  }
  async function load() {
    if (current(state) && state.ready) saveSignature();
    var id = identity(),
      number = ++sequence;
    if (
      current(state) &&
      (state.sending ||
        Object.keys(state.pending).length ||
        state.images.length)
    )
      return;
    clearTimeout(signatureTimer);
    byId("profileImageMenu").close();
    if (!id.owner) {
      state = null;
      apply({});
      available(false);
      note("signed-out", "登录后可同步个人设置");
      return;
    }
    var old = current(state) ? state.settings : {};
    var s = {
      owner: id.owner,
      epoch: id.epoch,
      settings: old,
      pending: {},
      images: [],
      inflight: null,
      sending: false,
      ready: false,
    };
    state = s;
    render(s);
    available(false);
    note("loading", "正在读取账号设置…");
    try {
      var response = await window.xtjProtectedFetch("/api/profile/settings", {
        authOwner: s.owner,
        authEpoch: s.epoch,
        timeoutMs: 12000,
      });
      var data = await response.json();
      if (!current(s) || number !== sequence) return;
      if (!response.ok || !data.ok || !data.settings)
        throw Error(data.error || "设置暂时无法读取");
      s.settings = data.settings;
      s.ready = true;
      render(s);
      available(true);
      note("synced");
    } catch (error) {
      if (current(s) && number === sequence)
        note("error", error.message || "读取失败，请重试");
    }
  }
  function queue(patch) {
    var s = state;
    if (!current(s) || !s.ready) return;
    ["cover", "background"].forEach(function (kind) {
      if (!Object.prototype.hasOwnProperty.call(patch, kind + "_url")) return;
      s.images = s.images.filter(function (upload) { return upload.kind !== kind; });
      if (s.activeUpload && s.activeUpload.kind === kind) s.activeUpload.superseded = true;
    });
    Object.assign(s.pending, patch);
    render(s, true);
    void drain(s);
  }
  async function drain(s) {
    if (!current(s) || !s.ready || s.sending) return;
    s.sending = true;
    try {
      while (current(s) && (Object.keys(s.pending).length || s.images.length)) {
        var patch = s.pending,
          upload = null;
        s.pending = {};
        if (!Object.keys(patch).length) upload = s.images.shift();
        s.activeUpload = upload;
        s.inflight = patch;
        note("saving", upload ? "正在上传图片…" : "正在同步…");
        try {
          var response = await window.xtjProtectedFetch(
            upload
              ? "/api/profile/settings/image?kind=" + upload.kind
              : "/api/profile/settings",
            {
              method: upload ? "POST" : "PATCH",
              authOwner: s.owner,
              authEpoch: s.epoch,
              timeoutMs: 45000,
              headers: {
                "Content-Type": upload
                  ? "application/octet-stream"
                  : "application/json",
              },
              body: upload ? upload.file : JSON.stringify(patch),
            },
          );
          var data = await response.json();
          if (!current(s)) return;
          if (!response.ok || !data.ok || !data.settings)
            throw Error(data.error || "设置暂未同步，请重试");
          s.settings = data.settings;
          s.activeUpload = null;
          s.inflight = null;
          render(s, true);
          window.dispatchEvent(
            new CustomEvent("xtj:profile-settings-saved", {
              detail: { owner: s.owner, settings: s.settings },
            }),
          );
        } catch (error) {
          if (!current(s)) return;
          // New choices win over the request that failed. Never drop a pending
          // selection, reuse it on another account, or report a failed write as saved.
          s.pending = Object.assign({}, patch, s.pending);
          s.inflight = null;
          s.activeUpload = null;
          if (upload && upload.superseded) continue;
          if (upload) s.images.unshift(upload);
          note("error", error.message || "设置暂未同步，请重试");
          return;
        }
      }
      if (current(s)) note("synced");
    } finally {
      if (current(s)) s.sending = false;
    }
  }
  function saveSignature() {
    clearTimeout(signatureTimer);
    var s = state,
      input = byId("profilePreferences").querySelector("[name=signature]");
    if (
      current(s) &&
      s.ready &&
      input.value.trim() !== (view(s).signature || "")
    )
      queue({ signature: input.value.trim() });
  }
  function openImageMenu(kind) {
    if (!current(state) || !state.ready) return;
    menuKind = kind;
    var url = safeUrl(view(state)[kind + "_url"]),
      preview = byId("profileImageMenuPreview");
    byId("profileImageMenuTitle").textContent =
      kind === "cover" ? "朋友圈封面" : "界面背景";
    preview.hidden = !url;
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    byId("profileImageMenu").querySelector(
      "[data-profile-image-action=clear]",
    ).hidden = !url;
    byId("profileImageMenu").showModal();
  }
  function init() {
    var form = byId("profilePreferences");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      saveSignature();
    });
    form.addEventListener("change", function (event) {
      var input = event.target;
      if (!input.name) return;
      if (input.name === "signature") saveSignature();
      else
        queue({
          [input.name]: input.type === "checkbox" ? input.checked : input.value,
        });
    });
    form
      .querySelector("[name=signature]")
      .addEventListener("input", function () {
        clearTimeout(signatureTimer);
        signatureTimer = setTimeout(saveSignature, 600);
      });
    form
      .querySelector("[name=signature]")
      .addEventListener("blur", saveSignature);
    form.querySelectorAll("[data-image-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        openImageMenu(button.dataset.imageKind);
      });
    });
    var menu = byId("profileImageMenu");
    menu.addEventListener("click", function (event) {
      var button = event.target.closest("[data-profile-image-action]");
      if (!button) {
        if (event.target === menu) {
          var box = menu.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            menu.close();
        }
        return;
      }
      menu.close();
      if (!current(state) || !state.ready) return;
      if (button.dataset.profileImageAction === "clear")
        queue({ [menuKind + "_url"]: "" });
      if (button.dataset.profileImageAction === "choose") {
        var input = byId("profileImageUpload");
        input.dataset.kind = menuKind;
        input.dataset.owner = state.owner;
        input.dataset.epoch = String(state.epoch);
        input.value = "";
        input.click();
      }
    });
    byId("profileImageUpload").addEventListener("change", function () {
      var file = this.files && this.files[0],
        s = state;
      if (
        !file ||
        !current(s) ||
        this.dataset.owner !== s.owner ||
        this.dataset.epoch !== String(s.epoch)
      )
        return;
      if (
        file.size > 12 * 1024 * 1024 ||
        !/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)
      ) {
        note("error", "请选择不超过 12MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片");
        return;
      }
      if (s.images.length >= 2) {
        note("error", "图片正在上传，请稍后再选");
        return;
      }
      var kind = this.dataset.kind;
      delete s.pending[kind + "_url"];
      s.images = s.images.filter(function (upload) { return upload.kind !== kind; });
      if (s.activeUpload && s.activeUpload.kind === kind) s.activeUpload.superseded = true;
      s.images.push({ kind: kind, file: file });
      void drain(s);
    });
    byId("profileSettingsRetry").addEventListener("click", function () {
      if (current(state) && state.ready) void drain(state);
      else void load();
    });
    byId("profileBlocksButton").addEventListener("click", function () {
      saveSignature();
      if (window.openProfileBlocks) window.openProfileBlocks();
    });
    window.addEventListener("auth-ready", load);
    window.addEventListener("online", function () {
      if (current(state) && state.ready) void drain(state);
    });
    window.addEventListener("focus", function () {
      if (byId("panelProfile").classList.contains("active")) void load();
    });
    new MutationObserver(function () {
      if (applying || !current(state) || !state.ready) return;
      var mode = document.documentElement.getAttribute("data-theme-mode");
      if (mode && mode !== view(state).theme) queue({ theme: mode });
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode"],
    });
    var wasActive = byId("panelProfile").classList.contains("active");
    new MutationObserver(function () {
      var active = byId("panelProfile").classList.contains("active");
      if (active && !wasActive) void load();
      if (!active && wasActive) saveSignature();
      wasActive = active;
    }).observe(byId("panelProfile"), {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.__xtjReloadProfileSettings = load;
    void load();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
