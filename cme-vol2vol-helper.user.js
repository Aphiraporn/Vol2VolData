// ==UserScript==
// @name         CME Vol2Vol Copy Helper - Gold Only
// @namespace    https://tampermonkey.net/
// @version      1.2
// @description  Copy CME Vol2Vol Gold Intraday/OI profile data and SD ranges for TradingView
// @author       Oat
// @match        https://www.cmegroup.com/tools-information/quikstrike/vol2vol-expected-range.html*
// @match        https://cmegroup-tools.quikstrike.net/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Aphiraporn/Vol2VolData/main/cme-vol2vol-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Aphiraporn/Vol2VolData/main/cme-vol2vol-helper.user.js
// ==/UserScript==
/* global Highcharts */

(function () {
  "use strict";

  const GOLD_MIN_STRIKE = 2500;
  const GOLD_MAX_STRIKE = 8000;

  const clean = (s) => (s || "").toString().replace(/\u00a0/g, " ").trim();

  function copyToClipboard(text) {
    try {
      GM_setClipboard(text, "text");
      return true;
    } catch (e) {
      try {
        navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.error("Copy failed:", err);
        return false;
      }
    }
  }

  function getXY(s) {
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
      return s.data.map((p) => ({ x: p.x, y: p.y }));
    }

    return [];
  }

  function buildRowsFromChart(c) {
    const findSeries = (keyword) =>
      c.series.find((s) => s.name && s.name.toLowerCase().includes(keyword.toLowerCase()));

    const callS = findSeries("call");
    const putS = findSeries("put");
    const volS = findSeries("vol");

    const callData = getXY(callS);
    const putData = getXY(putS);
    const volData = getXY(volS);

    const allX = new Set();

    [...callData, ...putData, ...volData].forEach((p) => {
      if (p && p.x !== undefined && p.x !== null) {
        allX.add(Number(p.x));
      }
    });

    const xs = Array.from(allX).sort((a, b) => a - b);

    const yAt = (arr, x) => {
      const p = arr.find((p) => Number(p.x) === Number(x));
      return p ? Number(p.y || 0) : 0;
    };

    const categories = c.xAxis && c.xAxis[0] ? c.xAxis[0].categories : null;

    const rows = xs
      .map((x) => {
        const strikeRaw = categories && categories[x] !== undefined ? categories[x] : x;
        const strike = clean(strikeRaw);

const call = yAt(callData, x);
const put = yAt(putData, x);

const volPoint = volData.find((p) => Number(p.x) === Number(x));
let vol = "";

if (volPoint && volPoint.y !== undefined && volPoint.y !== null) {
  let v = Number(volPoint.y);

  if (Number.isFinite(v) && v > 0) {
    if (v > 1) v = v / 100;
    vol = v;
  }
}

return [strike, call, put, vol];
      })
      .filter((r) => !isNaN(Number(r[0])));

    return rows;
  }

  function isGoldRows(rows) {
    if (!rows || rows.length === 0) return false;

    const strikes = rows
      .map((r) => Number(r[0]))
      .filter((n) => Number.isFinite(n));

    if (strikes.length === 0) return false;

    const goldCount = strikes.filter((n) => n >= GOLD_MIN_STRIKE && n <= GOLD_MAX_STRIKE).length;
    const ratio = goldCount / strikes.length;

    return ratio >= 0.7;
  }

  function chooseGoldChart() {
    if (typeof Highcharts === "undefined") {
      throw new Error("Highcharts is not ready. Please wait for the chart to load.");
    }

    const charts = Highcharts.charts.filter(Boolean);

    if (!charts.length) {
      throw new Error("No Highcharts chart found.");
    }

    const candidates = charts
      .map((ch, index) => {
        const title = ch.title && ch.title.textStr ? ch.title.textStr : "";
        const rows = buildRowsFromChart(ch);

        const strikes = rows
          .map((r) => Number(r[0]))
          .filter((n) => Number.isFinite(n));

        const minStrike = strikes.length ? Math.min(...strikes) : null;
        const maxStrike = strikes.length ? Math.max(...strikes) : null;

        const titleScore =
          /Intraday Volume|Open Interest|G5/i.test(title) ? 1 : 0;

        const goldScore = isGoldRows(rows) ? 10 : 0;

        const visibleScore =
          ch.container &&
          ch.container.getBoundingClientRect &&
          ch.container.getBoundingClientRect().width > 0 &&
          ch.container.getBoundingClientRect().height > 0
            ? 2
            : 0;

        const rowScore = rows.length > 10 ? 1 : 0;

        const score = goldScore + visibleScore + titleScore + rowScore;

        return {
          chart: ch,
          index,
          title,
          rows,
          strikes,
          minStrike,
          maxStrike,
          score,
        };
      })
      .filter((x) => x.rows && x.rows.length > 0)
      .sort((a, b) => b.score - a.score);

    console.table(
      candidates.map((x) => ({
        index: x.index,
        title: x.title,
        rows: x.rows.length,
        minStrike: x.minStrike,
        maxStrike: x.maxStrike,
        score: x.score,
      }))
    );

    const best = candidates.find((x) => isGoldRows(x.rows));

    if (!best) {
      throw new Error(
        "Cannot find Gold chart. Detected chart strikes are not in Gold range. Check Console table."
      );
    }

    console.log("Selected Gold chart:", {
      index: best.index,
      title: best.title,
      rows: best.rows.length,
      minStrike: best.minStrike,
      maxStrike: best.maxStrike,
      score: best.score,
    });

    return best;
  }

  function extractProfileData() {
    const pageText = document.body.innerText.replace(/\u00a0/g, " ");

    const titleMatches = pageText.match(
  /Gold\s*\(OG\|GC\)\s+[A-Z0-9]+\s+\([0-9.]+\s+DTE\)\s+vs\s+[+\-0-9.,]+\s+\([+\-0-9.,]+\)\s+-\s+(Intraday Volume|Open Interest)/g
);

    const headerLine = titleMatches ? titleMatches[titleMatches.length - 1] : "";

const headerFutureChgMatch = headerLine.match(
  /\(([+\-]?\d+(?:\.\d+)?)\)\s+-\s+(Intraday Volume|Open Interest)/
);

const headerFutureChg = headerFutureChgMatch ? headerFutureChgMatch[1] : "";

const summaryMatch = pageText.match(
  /Put:\s*([\d,]+)\s+Call:\s*([\d,]+)\s+Vol:\s*([+\-]?\d+(?:\.\d+)?)\s+Vol Chg:\s*([+\-]?\d+(?:\.\d+)?)/
);

const summaryLine = summaryMatch
  ? "Put: " + summaryMatch[1] +
    "  Call: " + summaryMatch[2] +
    "  Vol: " + summaryMatch[3] +
    "  Vol Chg: " + summaryMatch[4] +
    "  Future Chg: " + headerFutureChg
  : "";
    const selected = chooseGoldChart();
    const rows = selected.rows;

    if (!rows.length) {
      throw new Error("No rows extracted from selected Gold chart.");
    }

    if (!isGoldRows(rows)) {
      throw new Error("Selected rows are not Gold strikes. Extraction stopped.");
    }

    const output =
      headerLine +
      "\n" +
      summaryLine +
      "\n" +
      "Strike,Call,Put,Vol Settle\n" +
      rows.map((r) => r.join(",")).join("\n");

    return output.trim();
  }

  function extractSDRanges() {
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
          cy: r.top + r.height / 2,
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
              cy: (top + bottom) / 2,
            };
          }
        }
      } catch (e) {}

      return null;
    };

    const nodes = Array.from(document.querySelectorAll("svg text, svg tspan"))
      .map((el) => {
        const txt = clean(el.textContent);
        const rect = getRect(el);
        const num = toNum(txt);

        return {
          el,
          txt,
          num,
          rect,
          cx: rect ? rect.cx : null,
          cy: rect ? rect.cy : null,
        };
      })
      .filter((o) => o.txt && o.rect);

    const rangeLabels = nodes.filter((o) => /^Ranges:?$/i.test(o.txt));

    if (rangeLabels.length === 0) {
      throw new Error("Cannot find 'Ranges:' label.");
    }

    let best = null;

    for (const label of rangeLabels) {
      const candidates = nodes
        .filter(
          (o) =>
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
        const samePosition = usedPositions.some(
          (p) => Math.abs(p.x - c.cx) <= 2 && Math.abs(p.y - c.cy) <= 2
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

  function makePanel() {
    if (document.getElementById("ogt-v2v-helper")) return;

    const panel = document.createElement("div");
    panel.id = "ogt-v2v-helper";
    panel.style.position = "fixed";
    panel.style.top = "90px";
    panel.style.right = "18px";
    panel.style.zIndex = "999999";
    panel.style.background = "#0f172a";
    panel.style.color = "#e5e7eb";
    panel.style.border = "1px solid #334155";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 10px 25px rgba(0,0,0,0.35)";
    panel.style.fontFamily = "Arial, sans-serif";
    panel.style.fontSize = "13px";
    panel.style.width = "240px";

    panel.innerHTML = `
      <div style="font-weight:bold;color:#facc15;margin-bottom:8px;">Gold Vol2Vol Helper</div>

      <button id="ogt-copy-profile" style="width:100%;margin-bottom:7px;padding:8px;border:0;border-radius:8px;background:#2563eb;color:white;font-weight:bold;cursor:pointer;">
        Copy Current Profile
      </button>

      <button id="ogt-copy-sd" style="width:100%;margin-bottom:7px;padding:8px;border:0;border-radius:8px;background:#7c3aed;color:white;font-weight:bold;cursor:pointer;">
        Copy SD Ranges
      </button>

      <div id="ogt-status" style="margin-top:6px;color:#a7f3d0;font-size:12px;min-height:18px;"></div>

      <div style="margin-top:8px;color:#94a3b8;font-size:11px;line-height:1.35;">
        Profile = Intraday หรือ OI ตามเมนูที่เปิดอยู่<br>
        Gold filter: strike ${GOLD_MIN_STRIKE}-${GOLD_MAX_STRIKE}
      </div>
    `;

    document.body.appendChild(panel);

    const status = document.getElementById("ogt-status");

    document.getElementById("ogt-copy-profile").addEventListener("click", () => {
      try {
        const output = extractProfileData();
        copyToClipboard(output);

        const firstStrike = output.split("\n")[3]?.split(",")[0] || "";
        status.textContent = "Copied Profile. First strike: " + firstStrike;

        console.log(output);
      } catch (err) {
        status.textContent = "Error: " + err.message;
        console.error(err);
      }
    });

    document.getElementById("ogt-copy-sd").addEventListener("click", () => {
      try {
        const output = extractSDRanges();
        copyToClipboard(output);
        status.textContent = "Copied SD: " + output;
        console.log(output);
      } catch (err) {
        status.textContent = "Error: " + err.message;
        console.error(err);
      }
    });
  }

  function waitAndInit() {
    const timer = setInterval(() => {
      if (
        typeof Highcharts !== "undefined" &&
        Highcharts.charts &&
        Highcharts.charts.filter(Boolean).length > 0
      ) {
        clearInterval(timer);
        makePanel();
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(timer);
      if (!document.getElementById("ogt-v2v-helper")) {
        makePanel();
      }
    }, 15000);
  }

  waitAndInit();
})();
