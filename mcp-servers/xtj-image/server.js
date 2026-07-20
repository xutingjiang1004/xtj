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

function safeResolve(inputPath) {
  const resolved = path.resolve(inputPath);
  const relative = path.relative(SOURCE_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径越权：不允许访问 ' + SOURCE_DIR + ' 之外的目录');
  }
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(SOURCE_DIR, real);
  if (realRelative.startsWith('..')) {
    throw new Error('路径越权：符号链接指向 ' + SOURCE_DIR + ' 之外的目录');
  }
  return resolved;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 10000;

function validateFile(filePath) {
  const fp = safeResolve(filePath);
  if (!fs.existsSync(fp)) throw new Error(`文件不存在: ${fp}`);
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

server.tool("image_compress", "压缩图片文件", { filepath: z.string(), quality: z.number().optional(), output_suffix: z.string().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const ext = path.extname(fp);
  var suffix = String(args.output_suffix || '_compressed');
  // 防止路径遍历：移除 ../ 和 ..\
  suffix = suffix.replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_');
  const out = `${fp.slice(0, -ext.length)}${suffix}${ext}`;
  const q = args.quality ?? 80;
  const fmt = ext.toLowerCase().replace('.', '');
  let p = sharp(fp);
  if (fmt === 'jpg' || fmt === 'jpeg') p = p.jpeg({quality:q,mozjpeg:true});
  else if (fmt === 'png') p = p.png({quality:q,compressionLevel:9});
  else if (fmt === 'webp') p = p.webp({quality:q});
  else p = p.jpeg({quality:q,mozjpeg:true});
  await p.toFile(out);
  const orig = fs.statSync(fp).size;
  const now = fs.statSync(out).size;
  const saved = ((1 - now/orig) * 100).toFixed(1);
  return { content: [{ type: "text", text: `✅ 压缩完成\n  ${path.basename(fp)} → ${path.basename(out)}\n  ${fmtSize(orig)} → ${fmtSize(now)} (-${saved}%)` }] };
});

server.tool("image_convert", "转换图片格式（WebP/AVIF/JPEG/PNG）", { filepath: z.string(), format: z.enum(["jpeg","png","webp","avif","tiff"]), quality: z.number().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const out = `${fp.slice(0, -path.extname(fp).length)}.${args.format}`;
  const q = args.quality ?? 85;
  let p = sharp(fp);
  switch(args.format){ case"jpeg":p=p.jpeg({quality:q,mozjpeg:true});break; case"png":p=p.png({quality:q});break; case"webp":p=p.webp({quality:q});break; case"avif":p=p.avif({quality:q});break; case"tiff":p=p.tiff({quality:q});break; }
  const info = await p.toFile(out);
  return { content: [{ type: "text", text: `✅ 转换完成\n  ${path.basename(fp)} → ${path.basename(out)}\n  格式: ${args.format.toUpperCase()}\n  大小: ${fmtSize(fs.statSync(out).size)}\n  尺寸: ${info.width}x${info.height}` }] };
});

server.tool("image_resize", "调整图片尺寸", { filepath: z.string(), width: z.number().max(MAX_IMAGE_DIMENSION), height: z.number().max(MAX_IMAGE_DIMENSION).optional(), fit: z.enum(["cover","contain","fill","inside","outside"]).optional(), output_suffix: z.string().optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const ext = path.extname(fp);
  var suffix = String(args.output_suffix || '_resized');
  // 防止路径遍历
  suffix = suffix.replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_');
  const out = `${fp.slice(0,-ext.length)}${suffix}${ext}`;
  const r = { width: Math.min(args.width, MAX_IMAGE_DIMENSION) };
  if (args.height) r.height = Math.min(args.height, MAX_IMAGE_DIMENSION);
  if (args.fit) r.fit = args.fit;
  const info = await sharp(fp).resize(r).toFile(out);
  return { content: [{ type: "text", text: `✅ 尺寸调整完成\n  输出: ${path.basename(out)}\n  新尺寸: ${info.width}x${info.height}\n  大小: ${fmtSize(fs.statSync(out).size)}` }] };
});

server.tool("image_generate_thumbnails", "生成多尺寸响应式缩略图", { filepath: z.string(), format: z.enum(["jpeg","webp","avif"]).optional(), quality: z.number().optional(), sizes: z.array(z.object({ width: z.number(), label: z.string() })).optional() }, async (args) => {
  const fp = validateFile(args.filepath);
  const sizes = args.sizes || [{width:200,label:"sm"},{width:400,label:"md"},{width:800,label:"lg"}];
  const fmt = args.format || "webp";
  const q = args.quality ?? 80;
  const base = fp.slice(0,-path.extname(fp).length);
  const results = [];
  for (const size of sizes) {
    // 防止路径遍历：label 中的特殊字符替换为安全字符
    var safeLabel = String(size.label || '').replace(/\.\.(\/|\\)/g, '_').replace(/[\/\\]/g, '_');
    const out = `${base}_${safeLabel}.${fmt}`;
    let p = sharp(fp).resize({width:size.width});
    switch(fmt){case"webp":p=p.webp({quality:q});break;case"avif":p=p.avif({quality:q});break;case"jpeg":p=p.jpeg({quality:q});break;}
    await p.toFile(out);
    results.push(`  [${size.label}] ${size.width}px → ${path.basename(out)} (${fmtSize(fs.statSync(out).size)})`);
  }
  return { content: [{ type: "text", text: `✅ 缩略图生成完成 (${sizes.length}个尺寸)\n${results.join("\n")}` }] };
});

server.tool("image_batch_optimize", "批量优化目录下所有图片", { directory: z.string(), quality: z.number().optional(), format: z.enum(["webp","avif","jpeg"]).optional(), max_width: z.number().optional(), glob: z.string().optional() }, async (args) => {
  const dir = safeResolve(args.directory);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`目录不存在: ${dir}`);
  const g = args.glob||"*.{jpg,jpeg,png,webp}";
  const braceMatch = g.match(/\{([^}]+)\}/);
  const exts = braceMatch ? braceMatch[1].split(",").map(s => "." + s.trim().toLowerCase()) : [path.extname(g).toLowerCase()];
  const files = fs.readdirSync(dir).filter(f => exts.includes(path.extname(f).toLowerCase()));
  if (!files.length) return { content: [{ type: "text", text: `⚠️ 未找到匹配图片 (${g})` }] };
  const fmt = args.format||"webp"; const q = args.quality??80; const mw = args.max_width||1920;
  const results = [];
  for (const file of files) {
    const full = path.join(dir, file); const outName = `${path.basename(file,path.extname(file))}.${fmt}`; const out = path.join(dir, outName);
    try {
      const meta = await sharp(full).metadata();
      let p = sharp(full); if (meta.width && meta.width > mw) p = p.resize({width:mw});
      switch(fmt){case"webp":p=p.webp({quality:q});break;case"avif":p=p.avif({quality:q});break;case"jpeg":p=p.jpeg({quality:q});break;}
      await p.toFile(out);
      const s1 = fs.statSync(full).size; const s2 = fs.statSync(out).size; const sv = ((1-s2/s1)*100).toFixed(1);
      results.push(`  ✅ ${file} → ${outName} (${fmtSize(s1)}→${fmtSize(s2)}, -${sv}%)`);
    } catch(e) { results.push(`  ❌ ${file}: ${e.message}`); }
  }
  return { content: [{ type: "text", text: `✅ 批量优化 (${results.filter(r=>r.includes('✅')).length}/${files.length})\n${results.join("\n")}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[xtj-image-mcp] Server started. Waiting for MCP requests...");
