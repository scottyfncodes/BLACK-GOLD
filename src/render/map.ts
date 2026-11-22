import { projectKm, regionSizeKm, type LatLon, type RegionGeography } from "../content/geography/jefferson1890";

/**
 * Draws the region's surface geography. Functional, not final art: the Era I visual
 * direction is chosen at the interface milestone. Only real geography is drawn here;
 * nothing about the subsurface is known yet, so nothing about it is shown.
 */

const INK = "#2b241c";
const PAPER = "#efe6d2";
const PRAIRIE = "#e6dcc3";
const MARSH = "#d3d7bf";
const MARSH_MARK = "#8d987a";
const WATER = "#5f7f91";
const ROAD = "#9a7b55";
const GRID = "rgba(43, 36, 28, 0.09)";

const KM_PER_MILE = 1.609344;

export function drawMap(ctx: CanvasRenderingContext2D, cssSize: number, dpr: number, region: RegionGeography): void {
  const { width: wKm, height: hKm } = regionSizeKm(region);
  const scale = cssSize / Math.max(wKm, hKm); // css px per km
  const pt = (p: LatLon): [number, number] => {
    const { x, y } = projectKm(region, p);
    return [x * scale, y * scale];
  };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.fillStyle = PRAIRIE;
  ctx.fillRect(0, 0, cssSize, cssSize);

  // 5 km grid.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let km = 5; km < Math.max(wKm, hKm); km += 5) {
    const p = Math.round(km * scale) + 0.5;
    line(ctx, [[p, 0], [p, cssSize]]);
    line(ctx, [[0, p], [cssSize, p]]);
  }

  for (const area of region.areas) {
    const pts = area.points.map(pt);
    ctx.fillStyle = MARSH;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
    // Marsh tufts on a fixed lattice, clipped to the area: same marks on every frame.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = MARSH_MARK;
    ctx.lineWidth = 1;
    const step = 14;
    for (let y = 4; y < cssSize; y += step) {
      for (let x = (y / step) % 2 ? 4 : 11; x < cssSize; x += step) {
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1.5, y - 3);
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1.5, y - 3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const f of region.lines) {
    const pts = f.points.map(pt);
    switch (f.kind) {
      case "road":
        ctx.strokeStyle = ROAD;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        line(ctx, pts);
        ctx.setLineDash([]);
        break;
      case "bayou":
        ctx.strokeStyle = WATER;
        ctx.lineWidth = 1.5;
        line(ctx, pts);
        break;
      case "river":
        ctx.strokeStyle = WATER;
        ctx.lineWidth = Math.max(3, scale * 0.25);
        line(ctx, pts);
        break;
      case "railroad":
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        line(ctx, pts);
        ties(ctx, pts, 7, 3);
        break;
    }
  }

  const fontSize = cssSize < 420 ? 11 : 13;
  for (const f of region.lines) {
    if (f.labelAt === undefined) continue;
    const pts = f.points.map(pt);
    const at = alongLine(pts, f.labelAt);
    const italic = f.kind === "river" || f.kind === "bayou";
    labelAlong(ctx, f.name, at, `${italic ? "italic " : ""}${fontSize}px Georgia, "Times New Roman", serif`, f.kind === "railroad" ? INK : WATER, f.kind === "railroad" ? -9 : -7);
  }

  for (const place of region.places) {
    const [x, y] = pt(place.at);
    const r = place.kind === "town" ? 4 : 3;
    ctx.fillStyle = INK;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.font = `${place.kind === "town" ? "600 " : ""}${place.kind === "town" ? fontSize + 2 : fontSize}px Georgia, "Times New Roman", serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = place.labelSide === "left" ? "right" : "left";
    halo(ctx, place.name, place.labelSide === "left" ? x - r - 5 : x + r + 5, y, INK);
  }

  drawScaleBar(ctx, scale, cssSize, fontSize);
  drawNorthArrow(ctx, cssSize, fontSize);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, cssSize - 2, cssSize - 2);
}

function line(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

function ties(ctx: CanvasRenderingContext2D, pts: readonly [number, number][], spacing: number, half: number): void {
  let carry = 0;
  ctx.lineWidth = 1.25;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let d = spacing - carry; d < len; d += spacing) {
      const x = x0 + ((x1 - x0) * d) / len;
      const y = y0 + ((y1 - y0) * d) / len;
      ctx.beginPath();
      ctx.moveTo(x - nx * half, y - ny * half);
      ctx.lineTo(x + nx * half, y + ny * half);
      ctx.stroke();
    }
    carry = (carry + len) % spacing;
  }
}

function alongLine(pts: [number, number][], t: number): { x: number; y: number; angle: number } {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  let target = lens.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i]!;
    if (target <= len || i === lens.length - 1) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const k = len === 0 ? 0 : target / len;
      let angle = Math.atan2(y1 - y0, x1 - x0);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, angle };
    }
    target -= len;
  }
  return { x: 0, y: 0, angle: 0 };
}

function labelAlong(ctx: CanvasRenderingContext2D, text: string, at: { x: number; y: number; angle: number }, font: string, color: string, offset: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(at.angle);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  halo(ctx, text, 0, offset, color);
  ctx.restore();
}

function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAPER;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawScaleBar(ctx: CanvasRenderingContext2D, scale: number, size: number, fontSize: number): void {
  const miles = 3;
  const len = miles * KM_PER_MILE * scale;
  const x = 14;
  const y = size - 18;
  ctx.fillStyle = PAPER;
  ctx.fillRect(x - 6, y - fontSize - 10, len + 12, fontSize + 20);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, len, 5);
  ctx.fillRect(x, y, len / 3, 5);
  ctx.fillRect(x + (2 * len) / 3, y, len / 3, 5);
  ctx.font = `${fontSize - 1}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${miles} miles`, x, y - 3);
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, size: number, fontSize: number): void {
  const x = size - 22;
  const y = 32;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x + 6, y + 12);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 6, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${fontSize}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", x, y - 8);
}
