(function () {
  "use strict";
  var state = null,
    seq = 0,
    busy = false,
    applying = false;
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
    var i = identity();
    return state === s && s.owner === i.owner && s.epoch === i.epoch;
  }
  function safeUrl(value) {
    try {
      var u = new URL(value, location.href);
      return /^https?:$/.test(u.protocol) && value ? u.href : "";
    } catch (_) {
      return "";
    }
  }
  function note(text) {
    var n = byId("profileSettingsStatus");
    if (n) n.textContent = text;
  }
  function lock(value) {
    busy = value;
    byId("profilePreferences")
      .querySelectorAll("input,select,textarea,button")
      .forEach(function (n) {
        n.disabled = value || !state;
      });
  }
  function apply(settings) {
    applying = true;
    var root = document.documentElement,
      colors = {
        mint: "#299b79",
        blue: "#387bc5",
        rose: "#bd547c",
        violet: "#8664c4",
      };
    root.style.setProperty(
      "--profile-accent",
      colors[settings.accent] || colors.mint,
    );
    root.dataset.profileAccent = settings.accent || "mint";
    root.dataset.profileFont = settings.font_size || "normal";
    root.dataset.profileDensity = settings.density || "comfortable";
    root.setAttribute(
      "data-xtj-motion",
      settings.motion === "off" ? "off" : "system",
    );
    var bg = safeUrl(settings.background_url);
    root.classList.toggle("profile-custom-background", !!bg);
    root.style.setProperty(
      "--profile-background",
      bg ? "url(" + JSON.stringify(bg) + ")" : "none",
    );
    if (window.XTJThemeController && settings.theme)
      window.XTJThemeController.setMode(settings.theme);
    var cover = byId("profileOwnCover");
    cover.replaceChildren();
    var url = safeUrl(settings.cover_url);
    if (url) {
      var img = document.createElement("img");
      img.src = url;
      img.alt = "我的朋友圈封面";
      img.addEventListener("error", function () {
        img.remove();
      });
      cover.appendChild(img);
    }
    byId("profileOwnSignature").textContent = settings.signature || "";
    window.__xtjDefaultPostVisibility = settings.default_visibility || "public";
    var visibility = byId("postVisibility");
    if (visibility && !byId("postInp")?.value)
      visibility.value = window.__xtjDefaultPostVisibility;
    applying = false;
  }
  function fill(settings) {
    byId("profilePreferences")
      .querySelectorAll("[name]")
      .forEach(function (input) {
        if (input.type === "checkbox") input.checked = !!settings[input.name];
        else input.value = settings[input.name] || "";
      });
  }
  function changed() {
    var patch = {};
    if (!state) return patch;
    byId("profilePreferences")
      .querySelectorAll("[name]")
      .forEach(function (n) {
        var value = n.type === "checkbox" ? n.checked : n.value;
        if (value !== state.settings[n.name]) patch[n.name] = value;
      });
    return patch;
  }
  async function load() {
    var id = identity(),
      number = ++seq;
    if (!id.owner) {
      state = null;
      lock(true);
      apply({});
      fill({});
      note("登录后可同步个人设置");
      return;
    }
    // Immediately discard the previous account's public/private preferences.
    if (!state || state.owner !== id.owner || state.epoch !== id.epoch) {
      state = null;
      apply({});
      fill({});
    }
    var s = {
      owner: id.owner,
      epoch: id.epoch,
      settings: (state && state.settings) || {},
    };
    state = s;
    lock(true);
    note("正在读取账号设置…");
    try {
      var r = await window.xtjProtectedFetch("/api/profile/settings", {
        authOwner: s.owner,
        authEpoch: s.epoch,
        timeoutMs: 12000,
      });
      var data = await r.json();
      if (!current(s) || number !== seq) return;
      if (!r.ok || !data.ok || !data.settings)
        throw Error(data.error || "设置暂时无法读取");
      s.settings = data.settings;
      apply(s.settings);
      fill(s.settings);
      lock(false);
      note("设置已同步到账号");
    } catch (error) {
      if (!current(s) || number !== seq) return;
      state = null;
      busy = false;
      byId("profileSettingsReload").disabled = false;
      note(error.message || "读取失败，请重试");
    }
  }
  async function save(patch, body, path) {
    var s = state;
    if (!s || busy || !current(s)) return;
    var drafts = changed();
    lock(true);
    note("正在保存…");
    try {
      var r = await window.xtjProtectedFetch(path || "/api/profile/settings", {
        method: body ? "POST" : "PATCH",
        authOwner: s.owner,
        authEpoch: s.epoch,
        timeoutMs: 45000,
        headers: {
          "Content-Type": body
            ? "application/octet-stream"
            : "application/json",
        },
        body: body || JSON.stringify(patch),
      });
      var data = await r.json();
      if (!current(s)) return;
      if (!r.ok || !data.ok || !data.settings)
        throw Error(data.error || "保存失败，请重试");
      s.settings = data.settings;
      apply(s.settings);
      fill(s.settings);
      byId("profilePreferences")
        .querySelectorAll("[name]")
        .forEach(function (n) {
          if (
            Object.prototype.hasOwnProperty.call(drafts, n.name) &&
            !Object.prototype.hasOwnProperty.call(patch || {}, n.name)
          ) {
            if (n.type === "checkbox") n.checked = drafts[n.name];
            else n.value = drafts[n.name];
          }
        });
      note("已保存，其他设备登录后同步");
      window.dispatchEvent(
        new CustomEvent("xtj:profile-settings-saved", {
          detail: { owner: s.owner, settings: s.settings },
        }),
      );
      return true;
    } catch (error) {
      if (current(s)) note(error.message || "未确认保存，请重新读取后重试");
    } finally {
      if (current(s)) lock(false);
    }
  }
  function init() {
    var form = byId("profilePreferences");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var patch = changed();
      if (Object.keys(patch).length) save(patch);
      else note("设置未变化");
    });
    byId("profileSettingsReload").addEventListener("click", load);
    form.querySelectorAll("[data-image-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (!state || busy) return;
        var kind = button.dataset.imageKind;
        var input = byId("profileImageUpload");
        input.dataset.kind = kind;
        input.value = "";
        input.click();
      });
    });
    byId("profileImageUpload").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        note("图片不能超过 12MB");
        return;
      }
      if (!/^(image\/(jpeg|png|webp|gif|avif))$/.test(file.type)) {
        note("请选择 JPG、PNG、WebP、GIF 或 AVIF 图片");
        return;
      }
      var path = "/api/profile/settings/image?kind=" + this.dataset.kind,
        patch = changed();
      if (Object.keys(patch).length)
        save(patch).then(function (ok) {
          if (ok) save(null, file, path);
        });
      else save(null, file, path);
    });
    form.querySelectorAll("[data-image-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        save({ [button.dataset.imageClear + "_url"]: "" });
      });
    });
    window.addEventListener("auth-ready", load);
    window.addEventListener("focus", function () {
      if (
        !busy &&
        state &&
        current(state) &&
        !Object.keys(changed()).length &&
        byId("panelProfile").classList.contains("active")
      )
        load();
    });
    // Existing theme controls retain their gestures and now save the final mode.
    var themeTimer;
    new MutationObserver(function () {
      if (applying || !state || !current(state)) return;
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () {
        if (!state || busy || !current(state)) return;
        var mode = document.documentElement.getAttribute("data-theme-mode");
        if (mode && mode !== state.settings.theme) save({ theme: mode });
      }, 350);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode"],
    });
    var wasActive = byId("panelProfile").classList.contains("active");
    new MutationObserver(function () {
      var active = byId("panelProfile").classList.contains("active");
      if (
        active &&
        !wasActive &&
        !busy &&
        (!state || !Object.keys(changed()).length)
      )
        load();
      wasActive = active;
    }).observe(byId("panelProfile"), {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.__xtjReloadProfileSettings = load;
    load();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
