#!/usr/bin/env node

/**
 * XTJ 图片优化 MCP Server (v2 - McpServer API)
 * =============================================
 * 为 XTJ照片墙 提供 AI 驱动的图片优化能力：
 * - 压缩、格式转换、缩放、批量处理、缩略图生成、图片分析
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = process.env.IMAGE_SOURCE_DIR || path.resolve(__dirname, "../../uploads");
// ★ 2026-09-26（审计 P3-25）：默认 SOURCE_DIR 在本仓库里并不存在（项目图片走 Supabase
//   Storage，仓库中无 uploads/ 目录），此前只会在首次调用时以 realpathSync 抛 ENOENT，
//   错误信息不足以定位。这里在启动时显式给出可诊断的提示。
if (!fs.existsSync(SOURCE_DIR)) {
  console.warn('[xtj-image] SOURCE_DIR 不存在: ' + SOURCE_DIR + '（请通过 IMAGE_SOURCE_DIR 指定可访问的图片目录）');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function safeResolve(inputPath, { output = false } = {}) {
  const root = fs.realpathSync(SOURCE_DIR);
  const resolved = path.resolve(inputPath);
  if (!isWithin(root, resolved)) throw new Error("路径越权：不允许访问 " + root + " 之外的目录");

  if (output) {
    const parentReal = fs.realpathSync(path.dirname(resolved));
    if (!isWithin(root, parentReal)) throw new Error("路径越权：输出目录符号链接指向允许目录之外");
    if (fs.existsSync(resolved) && !isWithin(root, fs.realpathSync(resolved))) {
      throw new Error("路径越权：输出符号链接指向允许目录之外");
    }
  } else {
    const real = fs.realpathSync(resolved);
    if (!isWithin(root, real)) throw new Error("路径越权：符号链接指向 " + root + " 之外的目录");
  }
  return resolved;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_BATCH_FILES = 50;
const MAX_BATCH_INPUT_BYTES = 250 * 1024 * 1024;
const MAX_THUMBNAIL_SIZES = 10;
const MAX_IMAGE_DIMENSION = 10000;
const MAX_QUALITY = 100;

function validateQuality(value, fallback) {
  const quality = value ?? fallback;
  if (!Number.isInteger(quality) || quality < 1 || quality > MAX_QUALITY) throw new Error("quality 必须是 1 到 100 的整数");
  return quality;
}

function validateDimension(value, name, optional = false) {
  if (optional && value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_DIMENSION) {
    throw new Error(`${name} 必须是 1 到 ${MAX_IMAGE_DIMENSION} 之间的整数`);
  }
  return value;
}

function validateFile(filePath) {
  // 先做 existsSync 检查再 safeResolve，避免 realpathSync 对不存在文件抛原始 ENOENT
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
  const fp = safeResolve(filePath);
  const valid = [".jpg",".jpeg",".png",".webp",".avif",".tiff",".gif"];
  if (!valid.includes(path.extname(fp).toLowerCase())) throw new Error(`不支持的格式: ${path.extname(fp)}`);
  const stat = fs.statSync(fp);
  if (stat.size > MAX_FILE_SIZE) throw new Error(`文件过大: ${fmtSize(stat.size)}，最大 ${fmtSize(MAX_FILE_SIZE)}`);
  return fp;
}

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}

const server = new McpServer({ name: "xtj-image-mcp", version: "1.0.0" });

server.tool("image_analyze", "分析图片信息（尺寸、格式、文件大小、色彩空间等）", { filepath: z.string() }, async ({ filepath }) => {
  const fp = validateFile(filepath);
  const meta = await sharp(fp).metadata();
  const size = fs.statSync(fp).size;
  const alphaText = meta.hasAlpha ? "是" : "否";
  const text = `📷 图片分析\n━━━━━━━━━━━\n文件: ${path.basename(fp)}\n格式: ${meta.format}\n尺寸: ${meta.width}x${meta.height}\n大小: ${fmtSize(size)}\n色彩空间: ${meta.space||"unknown"}\n通道: ${meta.channels||"unknown"}\nDPI: ${meta.density||"-"}\nAlpha: ${alphaText}`;
  return { content: [{ type: "text", text }] };
});

server.tool("image_compress", "压缩图片文件（单个输入最大 100 MiB；quality 为 1–100）", { filepath: z.string(), quality: z.number().int().min(1).max(MAX_QUALITY).optional(), output_suffix: z.string().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const quality = validateQuality(args.quality, 80);
  const ext = path.extname(fp);
  var suffix = String(args.output_suffix || '_compressed');
  // 防止路径遍历：移除所有路径分隔符和危险字符，仅保留安全字符
  suffix = suffix.replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
  const out = `${fp.slice(0, -ext.length)}${suffix}${ext}`;
  const q = quality;
  const fmt = ext.toLowerCase().replace('.', '');
  let p = sharp(fp);
  if (fmt === 'jpg' || fmt === 'jpeg') p = p.jpeg({quality:q,mozjpeg:true});
  else if (fmt === 'png') p = p.png({compressionLevel:9}); // PNG 为无损格式，sharp 不支持 quality 参数
  else if (fmt === 'webp') p = p.webp({quality:q});
  else p = p.jpeg({quality:q,mozjpeg:true});
  const safeOut = safeResolve(out, { output: true });
  await p.toFile(safeOut);
  const orig = fs.statSync(fp).size;
  const now = fs.statSync(out).size;
  const saved = ((1 - now/orig) * 100).toFixed(1);
  return { content: [{ type: "text", text: `✅ 压缩完成\n  ${path.basename(fp)} → ${path.basename(out)}\n  ${fmtSize(orig)} → ${fmtSize(now)} (-${saved}%)` }] };
});

server.tool("image_convert", "转换图片格式（WebP/AVIF/JPEG/PNG）", { filepath: z.string(), format: z.enum(["jpeg","png","webp","avif","tiff"]), quality: z.number().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  let out = `${fp.slice(0, -path.extname(fp).length)}.${args.format}`;
  // 防覆盖：输入扩展名与目标 format 相同时加 _converted 后缀，避免 toFile 原地覆盖源文件
  if (path.extname(fp).slice(1).toLowerCase() === args.format) {
    out = `${fp.slice(0, -path.extname(fp).length)}_converted.${args.format}`;
  }
  const q = validateQuality(args.quality, 85);
  let p = sharp(fp);
  switch(args.format){ case"jpeg":p=p.jpeg({quality:q,mozjpeg:true});break; case"png":p=p.png({compressionLevel:9});break; // PNG 无损，不支持 quality
  case"webp":p=p.webp({quality:q});break; case"avif":p=p.avif({quality:q});break; case"tiff":p=p.tiff({quality:q});break; }
  const safeOut = safeResolve(out, { output: true });
  const info = await p.toFile(safeOut);
  return { content: [{ type: "text", text: `✅ 转换完成\n  ${path.basename(fp)} → ${path.basename(out)}\n  格式: ${args.format.toUpperCase()}\n  大小: ${fmtSize(fs.statSync(out).size)}\n  尺寸: ${info.width}x${info.height}` }] };
});

server.tool("image_resize", "调整图片尺寸（每边 1–10000 像素）", { filepath: z.string(), width: z.number().int().min(1).max(MAX_IMAGE_DIMENSION), height: z.number().int().min(1).max(MAX_IMAGE_DIMENSION).optional(), fit: z.enum(["cover","contain","fill","inside","outside"]).optional(), output_suffix: z.string().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  validateDimension(args.width, "width");
  validateDimension(args.height, "height", true);
  const ext = path.extname(fp);
  var suffix = String(args.output_suffix || '_resized');
  // 防止路径遍历
  suffix = suffix.replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_');
  const out = `${fp.slice(0,-ext.length)}${suffix}${ext}`;
  const r = { width: Math.min(args.width, MAX_IMAGE_DIMENSION) };
  if (args.height) r.height = Math.min(args.height, MAX_IMAGE_DIMENSION);
  if (args.fit) r.fit = args.fit;
  const safeOut = safeResolve(out, { output: true });
  const info = await sharp(fp).resize(r).toFile(safeOut);
  return { content: [{ type: "text", text: `✅ 尺寸调整完成\n  输出: ${path.basename(out)}\n  新尺寸: ${info.width}x${info.height}\n  大小: ${fmtSize(fs.statSync(out).size)}` }] };
});

server.tool("image_generate_thumbnails", "生成多尺寸响应式缩略图（最多 10 个，宽度 1–10000 像素）", { filepath: z.string(), format: z.enum(["jpeg","webp","avif"]).optional(), quality: z.number().int().min(1).max(MAX_QUALITY).optional(), sizes: z.array(z.object({ width: z.number().int().min(1).max(MAX_IMAGE_DIMENSION), label: z.string().min(1).max(40) })).max(MAX_THUMBNAIL_SIZES).optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const sizes = args.sizes || [{width:200,label:"sm"},{width:400,label:"md"},{width:800,label:"lg"}];
  if (sizes.length > MAX_THUMBNAIL_SIZES) throw new Error(`单次最多生成 ${MAX_THUMBNAIL_SIZES} 张缩略图`);
  for (const size of sizes) validateDimension(size.width, "thumbnail width");
  const q = validateQuality(args.quality, 80);
  const fmt = args.format || "webp";
  const base = fp.slice(0,-path.extname(fp).length);
  const results = [];
  for (const size of sizes) {
    // 防止路径遍历：label 中的特殊字符替换为安全字符
    var safeLabel = String(size.label || '').replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
    const out = `${base}_${safeLabel}.${fmt}`;
    let p = sharp(fp).resize({width:size.width});
    switch(fmt){case"webp":p=p.webp({quality:q});break;case"avif":p=p.avif({quality:q});break;case"jpeg":p=p.jpeg({quality:q});break;}
    const safeOut = safeResolve(out, { output: true });
    await p.toFile(safeOut);
    results.push(`  [${size.label}] ${size.width}px → ${path.basename(out)} (${fmtSize(fs.statSync(out).size)})`);
  }
  return { content: [{ type: "text", text: `✅ 缩略图生成完成 (${sizes.length}个尺寸)\n${results.join("\n")}` }] };
});

server.tool("image_batch_optimize", "批量优化目录图片（最多 50 张、输入总量最多 250 MiB、单张最大 100 MiB）", { directory: z.string(), quality: z.number().int().min(1).max(MAX_QUALITY).optional(), format: z.enum(["webp","avif","jpeg"]).optional(), max_width: z.number().int().min(1).max(MAX_IMAGE_DIMENSION).optional(), glob: z.string().max(100).optional() }, async (args) => {
  const dir = safeResolve(args.directory);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`目录不存在: ${dir}`);
  const g = args.glob||"*.{jpg,jpeg,png,webp}";
  const braceMatch = g.match(/\{([^}]+)\}/);
  const exts = braceMatch ? braceMatch[1].split(",").map(s => "." + s.trim().toLowerCase()) : [path.extname(g).toLowerCase()];
  const files = fs.readdirSync(dir).filter(f => exts.includes(path.extname(f).toLowerCase()) && fs.lstatSync(path.join(dir, f)).isFile());
  if (!files.length) return { content: [{ type: "text", text: `⚠️ 未找到匹配图片 (${g})` }] };
  if (files.length > MAX_BATCH_FILES) throw new Error(`批量匹配 ${files.length} 张，单次上限 ${MAX_BATCH_FILES} 张`);
  let inputBytes = 0;
  for (const file of files) {
    const full = safeResolve(path.join(dir, file));
    const size = fs.statSync(full).size;
    if (size > MAX_FILE_SIZE) throw new Error(`输入文件 ${file} 超过单张 100 MiB 上限`);
    inputBytes += size;
    if (inputBytes > MAX_BATCH_INPUT_BYTES) throw new Error("批量输入总大小超过 250 MiB 上限");
  }
  const fmt = args.format||"webp"; const q = validateQuality(args.quality, 80); const mw = validateDimension(args.max_width ?? 1920, "max_width");
  const results = [];
  for (const file of files) {
    const full = path.join(dir, file);
    // 防覆盖：输入扩展名与目标 fmt 相同时加 _opt 后缀，避免 toFile 原地覆盖源文件
    let outName = `${path.basename(file,path.extname(file))}.${fmt}`;
    if (path.extname(file).slice(1).toLowerCase() === fmt) {
      outName = `${path.basename(file,path.extname(file))}_opt.${fmt}`;
    }
    const out = path.join(dir, outName);
    try {
      // 在 toFile 之前读取源文件大小，避免源文件被覆盖后统计出错
      const s1 = fs.statSync(full).size;
      const meta = await sharp(full).metadata();
      let p = sharp(full); if (meta.width && meta.width > mw) p = p.resize({width:mw});
      switch(fmt){case"webp":p=p.webp({quality:q});break;case"avif":p=p.avif({quality:q});break;case"jpeg":p=p.jpeg({quality:q});break;}
      const safeOut = safeResolve(out, { output: true });
      await p.toFile(safeOut);
      const s2 = fs.statSync(out).size; const sv = ((1-s2/s1)*100).toFixed(1);
      results.push(`  ✅ ${file} → ${outName} (${fmtSize(s1)}→${fmtSize(s2)}, -${sv}%)`);
    } catch(e) { results.push(`  ❌ ${file}: ${e.message}`); }
  }
  return { content: [{ type: "text", text: `✅ 批量优化 (${results.filter(r=>r.includes('✅')).length}/${files.length})\n${results.join("\n")}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[xtj-image-mcp] Server started. Waiting for MCP requests...");
