import { chromium } from "playwright";
import fs from "node:fs/promises";

const CME_URL = "https://www.cmegroup.com/tools-information/quikstrike/vol2vol-expected-range.html";

const OUTPUT_INTRADAY = "IntradayData.txt";
const OUTPUT_OI = "OIData.txt";
const OUTPUT_SD = "SDRangesData.txt";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acceptCookiesIfAny(page) {
  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("I Accept")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler'
  ];

  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.count()) {
        await btn.click({ timeout: 3000 });
        await sleep(1000);
        return;
      }
    } catch (e) {}
  }
}

async function findQuikStrikeFrame(page) {
  for (let i = 0; i < 120; i++) {
    const frames = page.frames();

    const frame = frames.find(f => {
      const url = f.url();
      return (
        url.includes("cmegroup-tools.quikstrike.net") ||
        url.includes("QuikStrikeView.aspx")
      );
    });

    if (frame) return frame;

    await sleep(1000);
  }

  throw new Error("Cannot find QuikStrike iframe.");
}

async function waitForHighcharts(frame) {
  await frame.waitForFunction(() => {
    return (
      typeof window.Highcharts !== "undefined" &&
      window.Highcharts.charts &&
      window.Highcharts.charts.filter(Boolean).length > 0
    );
  }, null, { timeout: 120000 });
}

async function waitForChartTitle(frame, titleText) {
  await frame.waitForFunction((titleText) => {
    if (typeof window.Highcharts === "undefined") return false;

    const charts = window.Highcharts.charts.filter(Boolean);

    return charts.some(ch => {
      const title = ch.title && ch.title.textStr ? ch.title.textStr : "";
      return title.toLowerCase().includes(titleText.toLowerCase());
    });
  }, titleText, { timeout: 60000 });
}

async function clickMenu(frame, text) {
  const loc = frame.getByText(text, { exact: true }).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 30000 });
  await sleep(2500);
}

function extractProfileDataInPage() {
  const clean = (s) => (s || "").toString().replace(/\u00a0/g, " ").trim();

  if (typeof Highcharts === "undefined") {
    throw new Error("Highcharts is not defined.");
  }

  const pageText = document.body.innerText.replace(/\u00a0/g, " ");

  const titleMatches = pageText.match(
    /Gold\s*\(OG\|GC\)\s+[A-Z0-9]+\s+\([0-9.]+\s+DTE\)\s+vs\s+[-0-9.,]+\s+\([-0-9.,]+\)\s+-\s+(Intraday Volume|Open Interest)/g
  );

  const summaryMatches = pageText.match(
    /Put:\s*[\d,]+\s+Call:\s*[\d,]+\s+Vol:\s*[-\d.]+\s+Vol Chg:\s*[-\d.]+\s+Future Chg:\s*[-\d.]+/g
  );

  const headerLine = titleMatches ? titleMatches[titleMatches.length - 1] : "";
  const summaryLine = summaryMatches ? summaryMatches[summaryMatches.length - 1] : "";

  const charts = Highcharts.charts.filter(Boolean);

  const c =
    charts.find(ch => {
      const t = ch.title && ch.title.textStr ? ch.title.textStr : "";
      return t.includes("Intraday") || t.includes("Open Interest") || t.includes("G5");
    }) || charts[charts.length - 1];

  if (!c) {
    throw new Error("No Highcharts chart found.");
  }

  const findSeries = (keyword) =>
    c.series.find(s => s.name && s.name.toLowerCase().includes(keyword.toLowerCase()));

  const callS = findSeries("call");
  const putS = findSeries("put");
  const volS = findSeries("vol");

  const getXY = (s) => {
    if (!s) return [];

    let xs = [];
    let ys = [];

    try {
      if (s.getColumn) {
        xs = s.getColumn("x");
        ys = s.getColumn("y");
      }
    } catch (e) {}

    if ((!xs || xs.length === 0) && s.xData) xs = s.xData;
    if ((!ys || ys.length === 0) && s.yData) ys = s.yData;

    if (xs && ys && xs.length && ys.length) {
      return xs.map((x, i) => ({ x, y: ys[i] }));
    }

    if (Array.isArray(s.options && s.options.data)) {
      return s.options.data.map((d, i) => {
        if (Array.isArray(d)) return { x: d[0], y: d[1] };
        if (typeof d === "object") return { x: d.x ?? i, y: d.y };
        return { x: i, y: d };
      });
    }

    if (Array.isArray(s.data)) {
      return s.data.map(p => ({ x: p.x, y: p.y }));
    }

    return [];
  };

  const callData = getXY(callS);
  const putData = getXY(putS);
  const volData = getXY(volS);

  const allX = new Set();

  [...callData, ...putData, ...volData].forEach(p => {
    if (p && p.x !== undefined && p.x !== null) {
      allX.add(Number(p.x));
    }
  });

  const xs = Array.from(allX).sort((a, b) => a - b);

  const yAt = (arr, x) => {
    const p = arr.find(p => Number(p.x) === Number(x));
    return p ? Number(p.y || 0) : 0;
  };

  const categories = c.xAxis && c.xAxis[0] ? c.xAxis[0].categories : null;

  const rows = xs.map(x => {
    const strikeRaw = categories && categories[x] !== undefined ? categories[x] : x;
    const strike = clean(strikeRaw);

    const call = yAt(callData, x);
    const put = yAt(putData, x);
    let vol = yAt(volData, x);

    if (vol > 1) vol = vol / 100;

    return [strike, call, put, vol];
  }).filter(r => !isNaN(Number(r[0])));

  if (!rows.length) {
    throw new Error("No rows extracted from chart.");
  }

  const output =
    headerLine + "\n" +
    summaryLine + "\n" +
    "Strike,Call,Put,Vol Settle\n" +
    rows.map(r => r.join(",")).join("\n");

  return output.trim();
}

function extractSDRangesInPage() {
  const clean = (s) => (s || "").toString().replace(/\u00a0/g, " ").trim();

  const toNum = (s) => {
    const t = clean(s);
    if (!/^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(t)) return null;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const fmt = (n) => {
    if (!Number.isFinite(n)) return "";
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  };

  const getRect = (el) => {
    let r = el.getBoundingClientRect();

    if (r && r.width > 0 && r.height > 0) {
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2
      };
    }

    try {
      if (el.getBBox && el.getScreenCTM) {
        const bb = el.getBBox();
        const m = el.getScreenCTM();

        if (bb && m) {
          const x1 = m.a * bb.x + m.c * bb.y + m.e;
          const y1 = m.b * bb.x + m.d * bb.y + m.f;
          const x2 = m.a * (bb.x + bb.width) + m.c * (bb.y + bb.height) + m.e;
          const y2 = m.b * (bb.x + bb.width) + m.d * (bb.y + bb.height) + m.f;

          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const top = Math.min(y1, y2);
          const bottom = Math.max(y1, y2);

          return {
            left,
            right,
            top,
            bottom,
            width: right - left,
            height: bottom - top,
            cx: (left + right) / 2,
            cy: (top + bottom) / 2
          };
        }
      }
    } catch (e) {}

    return null;
  };

  const nodes = Array.from(document.querySelectorAll("svg text, svg tspan"))
    .map(el => {
      const txt = clean(el.textContent);
      const rect = getRect(el);
      const num = toNum(txt);

      return {
        el,
        txt,
        num,
        rect,
        cx: rect ? rect.cx : null,
        cy: rect ? rect.cy : null
      };
    })
    .filter(o => o.txt && o.rect);

  const rangeLabels = nodes.filter(o => /^Ranges:?$/i.test(o.txt));

  if (rangeLabels.length === 0) {
    throw new Error("Cannot find Ranges label.");
  }

  let best = null;

  for (const label of rangeLabels) {
    const candidates = nodes
      .filter(o =>
        o.num !== null &&
        o.num > 0 &&
        o.num < 1000 &&
        o.cx > label.cx + 15 &&
        Math.abs(o.cy - label.cy) <= 10
      )
      .sort((a, b) => a.cx - b.cx);

    const values = [];
    const usedPositions = [];

    for (const c of candidates) {
      const samePosition = usedPositions.some(p =>
        Math.abs(p.x - c.cx) <= 2 &&
        Math.abs(p.y - c.cy) <= 2
      );

      if (!samePosition) {
        values.push(c.num);
        usedPositions.push({ x: c.cx, y: c.cy });
      }

      if (values.length >= 6) break;
    }

    if (!best || values.length > best.values.length) {
      best = { label, candidates, values };
    }

    if (values.length >= 6) break;
  }

  if (!best || best.values.length < 6) {
    throw new Error("Could not extract 6 SD range values.");
  }

  const ranges = best.values.slice(0, 6);
  return ranges.map(fmt).join(",");
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 }
    });

    page.setDefaultTimeout(120000);

    console.log("Opening CME page...");
    await page.goto(CME_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

    await acceptCookiesIfAny(page);

    const frame = await findQuikStrikeFrame(page);

    console.log("Waiting for Highcharts...");
    await waitForHighcharts(frame);

    console.log("Extracting Intraday data...");
    await clickMenu(frame, "Intraday");
    await waitForChartTitle(frame, "Intraday Volume");
    const intradayData = await frame.evaluate(extractProfileDataInPage);
    const sdRangesData = await frame.evaluate(extractSDRangesInPage);

    console.log("Extracting OI data...");
    await clickMenu(frame, "OI");
    await waitForChartTitle(frame, "Open Interest");
    const oiData = await frame.evaluate(extractProfileDataInPage);

    await fs.writeFile(OUTPUT_INTRADAY, intradayData + "\n", "utf8");
    await fs.writeFile(OUTPUT_OI, oiData + "\n", "utf8");
    await fs.writeFile(OUTPUT_SD, sdRangesData + "\n", "utf8");

    console.log("Updated files:");
    console.log("- " + OUTPUT_INTRADAY);
    console.log("- " + OUTPUT_OI);
    console.log("- " + OUTPUT_SD);
    console.log("SD Ranges:", sdRangesData);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
