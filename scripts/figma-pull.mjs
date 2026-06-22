#!/usr/bin/env node
/*
  figma-pull.mjs

  Назначение:
  - выгрузить контрольный пакет из Figma для pixel-perfect вёрстки;
  - сохранить JSON ноды, manifest всех элементов, SVG/PNG ассеты и reference-скриншот фрейма;
  - не генерировать HTML/CSS и не заменять элементы «похожими».

  Требования:
  - Node.js 18+
  - переменные окружения: FIGMA_TOKEN, FILE_KEY, NODE_ID

  Запуск:
  FIGMA_TOKEN="figd_..." FILE_KEY="..." NODE_ID="22:2" node scripts/figma-pull.mjs

  Опционально:
  OUT_DIR="./figma-audit" EXPORT_SCALE="2" node scripts/figma-pull.mjs
*/

import fs from 'node:fs/promises';
import path from 'node:path';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FILE_KEY;
const NODE_ID = normalizeNodeId(process.env.NODE_ID || '');
const OUT_DIR = process.env.OUT_DIR || './figma-audit';
const EXPORT_SCALE = process.env.EXPORT_SCALE || '2';
const API_BASE = 'https://api.figma.com/v1';

if (!FIGMA_TOKEN || !FILE_KEY || !NODE_ID) {
  console.error(`
Не хватает обязательных переменных окружения.

Пример запуска:
FIGMA_TOKEN="figd_..." FILE_KEY="cU6O3Xlsar8HPCleslQ11O" NODE_ID="22:2" node scripts/figma-pull.mjs

NODE_ID можно передавать как "22:2" или как из URL Figma "22-2".
`);
  process.exit(1);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(path.join(OUT_DIR, 'assets'), { recursive: true });
await fs.mkdir(path.join(OUT_DIR, 'reference'), { recursive: true });

const rawNode = await figmaGet(`/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(NODE_ID)}&geometry=paths`);
await writeJson(path.join(OUT_DIR, 'figma_node_raw.json'), rawNode);

const root = rawNode?.nodes?.[NODE_ID]?.document;
if (!root) {
  throw new Error(`Figma node не найден: ${NODE_ID}. Проверь FILE_KEY, NODE_ID и доступ токена.`);
}

const frameBox = root.absoluteBoundingBox || { x: 0, y: 0 };
const allNodes = walk(root);
const manifest = allNodes.map((node) => toManifestEntry(node, frameBox));
await writeJson(path.join(OUT_DIR, 'figma_manifest.json'), manifest);

const exportCandidates = manifest.filter((n) => shouldExportNode(n));
const exportIds = unique(exportCandidates.map((n) => n.id));
const exportReport = {
  source_node_id: NODE_ID,
  generated_at: new Date().toISOString(),
  total_nodes: manifest.length,
  export_candidates: exportIds.length,
  svg_assets: [],
  image_fills: [],
  frame_reference: null,
  errors: [],
};

if (exportIds.length > 0) {
  const batches = chunk(exportIds, 50);
  for (const batch of batches) {
    const result = await getRenderUrls(batch, 'svg', { svg_outline_text: 'true' });
    for (const id of batch) {
      const url = result.images?.[id];
      const safeId = safeName(id);
      if (!url) {
        exportReport.errors.push({ node_id: id, type: 'svg_export_failed', message: 'Figma вернула null для рендера SVG' });
        continue;
      }
      const target = path.join(OUT_DIR, 'assets', `${safeId}.svg`);
      await downloadFile(url, target);
      exportReport.svg_assets.push({ node_id: id, file: `assets/${safeId}.svg` });
    }
  }
}

const framePng = await getRenderUrls([NODE_ID], 'png', { scale: EXPORT_SCALE, use_absolute_bounds: 'true' });
const frameUrl = framePng.images?.[NODE_ID];
if (frameUrl) {
  const file = path.join(OUT_DIR, 'reference', `figma-reference-${safeName(NODE_ID)}.png`);
  await downloadFile(frameUrl, file);
  exportReport.frame_reference = `reference/${path.basename(file)}`;
} else {
  exportReport.errors.push({ node_id: NODE_ID, type: 'frame_reference_failed', message: 'Не удалось экспортировать reference PNG фрейма' });
}

try {
  const imageFills = await figmaGet(`/files/${FILE_KEY}/images`);
  await writeJson(path.join(OUT_DIR, 'figma_image_fills_raw.json'), imageFills);

  for (const [imageRef, url] of Object.entries(imageFills.images || {})) {
    const file = path.join(OUT_DIR, 'assets', `image-fill-${safeName(imageRef)}.png`);
    await downloadFile(url, file);
    exportReport.image_fills.push({ imageRef, file: `assets/${path.basename(file)}` });
  }
} catch (error) {
  exportReport.errors.push({ type: 'image_fills_failed', message: error.message });
}

await writeJson(path.join(OUT_DIR, 'figma_assets_report.json'), exportReport);

const hasCriticalErrors = exportReport.errors.length > 0;
console.log(JSON.stringify({
  ok: !hasCriticalErrors,
  out_dir: OUT_DIR,
  files: [
    'figma_node_raw.json',
    'figma_manifest.json',
    'figma_assets_report.json',
    exportReport.frame_reference,
  ].filter(Boolean),
  svg_assets: exportReport.svg_assets.length,
  image_fills: exportReport.image_fills.length,
  errors: exportReport.errors,
}, null, 2));

if (hasCriticalErrors) {
  process.exitCode = 2;
}

function normalizeNodeId(value) {
  return String(value).trim().replace(/-/g, ':');
}

async function figmaGet(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Figma API error ${response.status}: ${body}`);
  }

  return response.json();
}

async function getRenderUrls(ids, format, params = {}) {
  const query = new URLSearchParams({
    ids: ids.join(','),
    format,
    ...params,
  });
  return figmaGet(`/images/${FILE_KEY}?${query.toString()}`);
}

async function downloadFile(url, target) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download error ${response.status}: ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(target, Buffer.from(arrayBuffer));
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function walk(node, result = []) {
  result.push(node);
  for (const child of node.children || []) {
    walk(child, result);
  }
  return result;
}

function toManifestEntry(node, frameBox) {
  const b = node.absoluteBoundingBox || {};
  const rb = node.absoluteRenderBounds || {};
  const s = node.style || {};

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    characters: node.characters ?? null,
    relative: {
      x: round((b.x ?? 0) - (frameBox.x ?? 0)),
      y: round((b.y ?? 0) - (frameBox.y ?? 0)),
      width: round(b.width ?? 0),
      height: round(b.height ?? 0),
    },
    absoluteBoundingBox: pickBox(b),
    absoluteRenderBounds: pickBox(rb),
    fills: node.fills ?? [],
    strokes: node.strokes ?? [],
    strokeWeight: node.strokeWeight ?? null,
    strokeAlign: node.strokeAlign ?? null,
    cornerRadius: node.cornerRadius ?? null,
    rectangleCornerRadii: node.rectangleCornerRadii ?? null,
    opacity: node.opacity ?? 1,
    effects: node.effects ?? [],
    constraints: node.constraints ?? null,
    layoutMode: node.layoutMode ?? null,
    itemSpacing: node.itemSpacing ?? null,
    paddingLeft: node.paddingLeft ?? null,
    paddingRight: node.paddingRight ?? null,
    paddingTop: node.paddingTop ?? null,
    paddingBottom: node.paddingBottom ?? null,
    style: Object.keys(s).length ? {
      fontFamily: s.fontFamily ?? null,
      fontPostScriptName: s.fontPostScriptName ?? null,
      fontWeight: s.fontWeight ?? null,
      fontSize: s.fontSize ?? null,
      lineHeightPx: s.lineHeightPx ?? null,
      letterSpacing: s.letterSpacing ?? null,
      textAlignHorizontal: s.textAlignHorizontal ?? null,
      textAlignVertical: s.textAlignVertical ?? null,
    } : null,
    componentId: node.componentId ?? null,
    children_count: Array.isArray(node.children) ? node.children.length : 0,
    children_ids: (node.children || []).map((child) => child.id),
    exportable: shouldExportType(node.type),
  };
}

function pickBox(box) {
  return {
    x: round(box.x ?? 0),
    y: round(box.y ?? 0),
    width: round(box.width ?? 0),
    height: round(box.height ?? 0),
  };
}

function shouldExportType(type) {
  return ['VECTOR', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'].includes(type);
}

function shouldExportNode(node) {
  if (!node.visible) return false;
  if (node.type === 'TEXT') return false;
  if (!shouldExportType(node.type)) return false;

  const w = node.relative?.width || 0;
  const h = node.relative?.height || 0;
  if (w <= 0 || h <= 0) return false;

  return true;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function unique(array) {
  return [...new Set(array)];
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
