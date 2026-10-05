"use strict";
const crypto = require("node:crypto");
const { readAuthRecord } = require("./auth-record");
const DEFAULTS = Object.freeze({
  signature: "",
  cover_url: "",
  background_url: "",
  accent: "mint",
  font_size: "normal",
  density: "comfortable",
  motion: "system",
  theme: "system",
  timeline_visible: true,
  guests_allowed: true,
  timeline_range: "all",
  default_visibility: "public",
  message_notifications: true,
  notification_preview: true,
});
async function readProfileSettings(supabase, actor) {
  const auth = await readAuthRecord(supabase, actor, "__auth__", "id");
  if (!auth) return { ...DEFAULTS };
  const r = await supabase
    .from("account_profile_settings")
    .select("settings")
    .eq("user_name", actor)
    .eq("account_id", auth.id)
    .maybeSingle();
  if (!r || r.error) throw Error("profile_settings_unavailable");
  return { ...DEFAULTS, ...((r.data && r.data.settings) || {}) };
}
function publicProfile(settings) {
  return {
    cover_url: settings.cover_url,
    signature: settings.signature,
    timeline_visible: settings.timeline_visible,
  };
}
function validatePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Error("invalid_settings");
  const patch = {},
    enums = {
      accent: ["mint", "blue", "rose", "violet"],
      font_size: ["normal", "large"],
      density: ["comfortable", "compact"],
      motion: ["system", "off"],
      theme: ["system", "light", "dark"],
      timeline_range: ["all", "3d", "1m", "6m"],
      default_visibility: ["public", "private"],
    };
  for (const [key, value] of Object.entries(body)) {
    if (key === "signature") {
      if (
        typeof value !== "string" ||
        value.length > 120 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
      )
        throw Error("invalid_signature");
      patch[key] = value.trim();
    } else if (
      [
        "timeline_visible",
        "guests_allowed",
        "message_notifications",
        "notification_preview",
      ].includes(key)
    ) {
      if (typeof value !== "boolean") throw Error("invalid_privacy");
      patch[key] = value;
    } else if (enums[key]) {
      if (!enums[key].includes(value)) throw Error("invalid_option");
      patch[key] = value;
    } else if (
      (key === "cover_url" || key === "background_url") &&
      value === ""
    )
      patch[key] = "";
    else throw Error("invalid_setting");
  }
  if (!Object.keys(patch).length) throw Error("empty_settings");
  return patch;
}
function createProfileSettings({
  express,
  supabase,
  authenticateUser,
  rateLimit,
  sharp,
}) {
  const router = express.Router();
  router.use(authenticateUser);
  if (rateLimit) router.use(rateLimit(60000, 120));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  async function save(actor, patch) {
    const auth = await readAuthRecord(supabase, actor, "__auth__", "id");
    if (!auth) throw Error("account_unavailable");
    const r = await supabase.rpc("save_account_profile_settings", {
      p_user_name: actor,
      p_account_id: auth.id,
      p_patch: patch,
    });
    if (!r || r.error || !r.data) throw Error("profile_save_failed");
    return { ...DEFAULTS, ...r.data };
  }
  router.get("/", async (req, res) => {
    try {
      res.json({
        ok: true,
        settings: await readProfileSettings(supabase, req.userName),
      });
    } catch (_) {
      res.status(503).json({ ok: false, error: "设置暂时无法读取，请重试" });
    }
  });
  router.patch("/", async (req, res) => {
    let patch;
    try {
      patch = validatePatch(req.body);
    } catch (_) {
      return res.status(400).json({ ok: false, error: "设置内容无效" });
    }
    try {
      res.json({ ok: true, settings: await save(req.userName, patch) });
    } catch (_) {
      res.status(503).json({ ok: false, error: "设置未保存，请重试" });
    }
  });
  router.post(
    "/image",
    ...(rateLimit ? [rateLimit(3600000, 8)] : []),
    express.raw({ type: "application/octet-stream", limit: "12mb" }),
    async (req, res) => {
      const kind = req.query.kind;
      if (
        !["cover", "background"].includes(kind) ||
        !Buffer.isBuffer(req.body) ||
        !req.body.length
      )
        return res.status(400).json({ ok: false, error: "请选择图片" });
      let meta;
      try {
        meta = await sharp(req.body, {
          animated: false,
          limitInputPixels: 100000000,
        }).metadata();
      } catch (_) {
        return res.status(400).json({ ok: false, error: "无法识别图片" });
      }
      const formats = {
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        avif: "image/avif",
      };
      if (!meta || !formats[meta.format])
        return res.status(400).json({
          ok: false,
          error: "请选择 JPG、PNG、WebP、GIF 或 AVIF 图片",
        });
      const path =
        "profile-images/" +
        crypto
          .createHash("sha256")
          .update(req.userName)
          .digest("hex")
          .slice(0, 20) +
        "/" +
        crypto.randomUUID() +
        "." +
        meta.format;
      try {
        const bucket = supabase.storage.from("uploads");
        const upload = await bucket.upload(path, req.body, {
          contentType: formats[meta.format],
          upsert: false,
          cacheControl: "31536000",
        });
        if (upload.error) throw Error("upload_failed");
        const url = bucket.getPublicUrl(path).data.publicUrl;
        // Never delete on an ambiguous commit: a lost RPC response can already have
        // published the new cover. Originals are stored without re-encoding.
        res.json({
          ok: true,
          settings: await save(req.userName, { [kind + "_url"]: url }),
        });
      } catch (_) {
        res
          .status(503)
          .json({ ok: false, error: "图片未确认保存，请重新读取设置后重试" });
      }
    },
  );
  return router;
}
module.exports = {
  DEFAULTS,
  readProfileSettings,
  publicProfile,
  validatePatch,
  createProfileSettings,
};
