// ==UserScript==
// @name         CME Vol2Vol Copy Helper - Gold Only
// @namespace    https://tampermonkey.net/
// @version      2.1
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

  // ======================================================
  // CME Vol2Vol Copy Helper - Gold Only
  // Version: 2.1
  //
  // Purpose:
  //   Add copy buttons on CME QuikStrike Vol2Vol page.
  //   Used to copy Gold Intraday / OI profile data and SD ranges
  //   for TradingView Pine indicators.
  //
  // Main Features:
  //   1. Copy Current Profile
  //      - Works with Intraday Volume
  //      - Works with Open Interest / OI
  //      - Output format:
  //        Header
  //        Summary
  //        Strike,Call,Put,Vol Settle
  //
  //   2. Copy SD Ranges
  //      - Output order:
  //        3SD Put, 2SD Put, 1SD Put, 1SD Call, 2SD Call, 3SD Call
  //
  // Important Notes:
  //   - This script is for Gold only.
  //   - Gold strike filter: 2500-8000.
  //   - Empty Vol Settle must stay blank, not 0.
  //   - Future Chg is extracted from the header line.
  //   - Helper panel is shown only inside QuikStrike iframe.
  //   - Helper panel can be dragged and its position is saved.
  //
  // Version History:
  //   1.1 - Initial helper
  //   1.2 - Fixed Future Chg and blank Vol Settle
  //   1.3 - Moved helper panel below chart
  //   1.4 - Added draggable panel, saved position, reset position
  //   1.5 - Updated SD extraction for CME plotBands
  //   1.6 - Restored Intraday profile via ChartTip backend; OI/SD unchanged
  //   1.7 - Removed sequential sid assumption; discover each strike's ChartTip URL directly
  //   1.8 - Restore old summary-line format for both OI and reconstructed Intraday
  //   1.9 - Separate Copy Intraday / Copy OI buttons; restore verified Vol and Vol Chg formulas
  //   2.0 - Fix missing Vol summary helper functions in v1.9
  //   2.1 - Fast Intraday: read per-strike StrikeId from Highcharts point Tag and fetch ChartTip directly; no chart clicking/flicker
  // ======================================================

  // Run only inside QuikStrike iframe.
  // This prevents duplicate helper panels on the parent CME page.
  if (window.location.hostname !== "cmegroup-tools.quikstrike.net") {
    return;
  }

  //==============================
  // CONFIG
  //==============================
  const GOLD_MIN_STRIKE = 2500;
  const GOLD_MAX_STRIKE = 8000;
  const PANEL_POS_KEY = "ogt-v2v-helper-position-v1";

  //==============================
  // BASIC HELPERS
  //==============================
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

  function clampNumber(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(value, maxValue));
  }

  //==============================
  // HIGHCHARTS DATA EXTRACTION
  //==============================
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

        // Important:
        // Do not fallback Vol Settle to 0.
        // Empty Vol Settle should stay blank.
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

  //==============================
  // INTRADAY TOOLTIP EXTRACTION
  // CME removed the Intraday chart tab, but the backend still
  // exposes per-strike Intraday Volume via ChartTip.aspx.
  // We discover the current session IDs automatically from
  // two programmatic chart-point clicks, infer the sequential
  // sid mapping, then fetch all strike tooltips.
  //==============================
  function getStrikeFromPoint(chart, point) {
    if (!chart || !point) return null;

    const categories = chart.xAxis && chart.xAxis[0] ? chart.xAxis[0].categories : null;

    if (categories && categories[point.x] !== undefined) {
      const n = Number(clean(categories[point.x]));
      return Number.isFinite(n) ? n : null;
    }

    const n = Number(point.x);
    return Number.isFinite(n) ? n : null;
  }

  function findClickablePointForStrike(chart, strike) {
    if (!chart) return null;

    for (const series of chart.series || []) {
      if (!series || !Array.isArray(series.data)) continue;

      for (const point of series.data) {
        const pointStrike = getStrikeFromPoint(chart, point);

        if (
          Number(pointStrike) === Number(strike) &&
          point.graphic &&
          point.graphic.element
        ) {
          return point;
        }
      }
    }

    return null;
  }

  function dispatchPointClick(point) {
    if (!point) return false;

    try {
      if (typeof point.firePointEvent === "function") {
        point.firePointEvent("click");
      }
    } catch (e) {}

    try {
      if (point.graphic && point.graphic.element) {
        point.graphic.element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
        return true;
      }
    } catch (e) {}

    return false;
  }

  function getChartTipResourceUrls() {
    return performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((url) => /\/User\/ChartTip\.aspx\?/i.test(url));
  }

  async function waitForNewChartTipUrl(beforeUrls, timeoutMs = 2500) {
    const before = new Set(beforeUrls);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const urls = getChartTipResourceUrls();
      const fresh = urls.find((url) => !before.has(url));

      if (fresh) return fresh;

      await new Promise((r) => setTimeout(r, 80));
    }

    return null;
  }

  async function captureChartTipUrlForStrike(chart, strike) {
    const point = findClickablePointForStrike(chart, strike);

    if (!point) {
      throw new Error(`Cannot find clickable chart point for strike ${strike}.`);
    }

    const before = getChartTipResourceUrls();
    dispatchPointClick(point);

    const url = await waitForNewChartTipUrl(before);

    if (!url) {
      throw new Error(
        `No ChartTip request detected for strike ${strike}. Try clicking the chart once manually, then retry.`
      );
    }

    return url;
  }

  function parseSid(url) {
    try {
      const u = new URL(url, window.location.href);
      const sid = Number(u.searchParams.get("sid"));
      return Number.isFinite(sid) ? sid : null;
    } catch (e) {
      return null;
    }
  }

  function withSid(url, sid) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("sid", String(sid));
    return u.toString();
  }

  function parseIntradayTooltip(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bodyText = clean(doc.body ? doc.body.innerText : "");

    const titleMatch = bodyText.match(/([A-Z0-9]+)\s+([\d,.]+)\s+Strike/i);

    if (!titleMatch) return null;

    const strike = Number(titleMatch[2].replace(/,/g, ""));
    if (!Number.isFinite(strike)) return null;

    const rows = [...doc.querySelectorAll("tr")];

    const intradayRow = rows.find((tr) =>
      clean(tr.innerText).toLowerCase().includes("intraday volume")
    );

    if (!intradayRow) return null;

    const cells = [...intradayRow.querySelectorAll("th,td")]
      .map((td) => clean(td.innerText))
      .filter((x) => x !== "");

    // Expected row: Intraday Volume | Call | Put | Total
    const values = cells
      .slice(1)
      .map((s) => {
        const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
        return m ? Number(m[0]) : null;
      });

    return {
      strike,
      call: Number.isFinite(values[0]) ? values[0] : 0,
      put: Number.isFinite(values[1]) ? values[1] : 0,
    };
  }


  function getPointStrikeId(point) {
    if (!point) return null;

    const candidates = [
      point.options?.Tag?.StrikeId,
      point.options?.tag?.StrikeId,
      point.options?.Tag?.strikeId,
      point.options?.tag?.strikeId,
      point.userOptions?.Tag?.StrikeId,
      point.userOptions?.tag?.StrikeId,
      point.Tag?.StrikeId,
      point.tag?.StrikeId,
    ];

    for (const v of candidates) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }

    return null;
  }

  function buildStrikeIdMap(chart) {
    const map = new Map();

    for (const series of chart?.series || []) {
      if (!series || !Array.isArray(series.data)) continue;

      for (const point of series.data) {
        const strike = getStrikeFromPoint(chart, point);
        const strikeId = getPointStrikeId(point);

        if (
          Number.isFinite(Number(strike)) &&
          Number.isFinite(Number(strikeId))
        ) {
          map.set(Number(strike), Number(strikeId));
        }
      }
    }

    return map;
  }

  function getCurrentChartTipBaseUrl(chart) {
    const settings =
      chart?.renderTo?.control?.Settings ||
      chart?.options?.custom?.Settings ||
      null;

    if (!settings) return null;

    const instanceParm = String(settings.InstanceParm || "");
    const expirationId = Number(settings.ExpirationId);
    const productId = Number(settings.Product?.Id);

    const insidMatch = instanceParm.match(/[?&]insid=(\d+)/i);
    const qsidMatch = instanceParm.match(/[?&]qsid=([^&]+)/i);

    const insid = insidMatch ? insidMatch[1] : "";
    const qsid = qsidMatch ? decodeURIComponent(qsidMatch[1]) : "";

    if (
      !insid ||
      !qsid ||
      !Number.isFinite(expirationId) ||
      !Number.isFinite(productId)
    ) {
      return null;
    }

    const u = new URL(
      "https://cmegroup-tools.quikstrike.net/User/ChartTip.aspx"
    );

    u.searchParams.set(
      "ControlPath",
      "~/UserControlsV2/QuikOptionsV2V/DetailTip.ascx"
    );
    u.searchParams.set("insid", insid);
    u.searchParams.set("qsid", qsid);
    u.searchParams.set("pid", String(productId));
    u.searchParams.set("xid", String(expirationId));

    return u;
  }

  async function fetchIntradayRowsFromChart(chart, baseRows, statusCallback) {
    const rows = baseRows
      .map((r) => ({
        strike: Number(r[0]),
        vol: r[3],
      }))
      .filter((r) => Number.isFinite(r.strike))
      .sort((a, b) => a.strike - b.strike);

    if (!rows.length) {
      throw new Error("No Gold strikes available for Intraday extraction.");
    }

    const strikeIdMap = buildStrikeIdMap(chart);
    const baseUrl = getCurrentChartTipBaseUrl(chart);

    if (!baseUrl) {
      throw new Error("Cannot build current QuikStrike ChartTip URL.");
    }

    if (!strikeIdMap.size) {
      throw new Error("Cannot find per-strike StrikeId in Highcharts data.");
    }

    const missing = rows
      .filter((r) => !strikeIdMap.has(r.strike))
      .map((r) => r.strike);

    if (missing.length) {
      console.warn("Missing StrikeId for strikes:", missing);
    }

    const output = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const strikeId = strikeIdMap.get(row.strike);

      if (!Number.isFinite(strikeId)) continue;

      if (statusCallback) {
        statusCallback(`Intraday ${i + 1}/${rows.length}: ${row.strike}`);
      }

      const u = new URL(baseUrl.toString());
      u.searchParams.set("sid", String(strikeId));

      try {
        const res = await fetch(u.toString(), {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) {
          console.warn(`ChartTip ${row.strike}: HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();
        const parsed = parseIntradayTooltip(html);

        if (!parsed || Number(parsed.strike) !== Number(row.strike)) {
          console.warn("ChartTip strike mismatch:", {
            expected: row.strike,
            parsed,
            strikeId,
          });
          continue;
        }

        output.push([
          String(row.strike),
          parsed.call,
          parsed.put,
          row.vol,
        ]);
      } catch (e) {
        console.warn(`ChartTip failed for strike ${row.strike}:`, e);
      }

      // Small pause only to avoid hammering the endpoint.
      await new Promise((r) => setTimeout(r, 30));
    }

    if (!output.length) {
      throw new Error("No Intraday rows extracted from ChartTip.");
    }

    if (output.length < Math.max(3, Math.floor(rows.length * 0.8))) {
      throw new Error(
        `Intraday extraction incomplete: ${output.length}/${rows.length} strikes.`
      );
    }

    return output;
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
          /Intraday Volume|Open Interest|G5|G1/i.test(title) ? 1 : 0;

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


  //==============================
  // VERIFIED SUMMARY HELPERS
  //==============================
  function format2(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x.toFixed(2) : "";
  }

  function getVerifiedVolSummary(chart) {
    const settings =
      chart?.renderTo?.control?.Settings ||
      chart?.options?.custom?.Settings ||
      null;

    if (!settings) {
      throw new Error("Cannot find QuikStrike chart Settings.");
    }

    const atmVol = Number(settings.ATMVol);
    const future = Number(settings.FuturePrice);
    const volSettleData = settings.VolSettle?.data || [];

    if (!Number.isFinite(atmVol)) {
      throw new Error("Cannot find ATMVol.");
    }

    const points = volSettleData
      .map((p) => ({
        x: Number(p?.x ?? p?.X),
        y: Number(p?.y ?? p?.Y),
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (!points.length || !Number.isFinite(future)) {
      throw new Error("Cannot find ATM Vol Settle.");
    }

    const nearest = [...points].sort(
      (a, b) => Math.abs(a.x - future) - Math.abs(b.x - future)
    )[0];

    const vol = atmVol * 100;
    const volChg = (atmVol - nearest.y) * 100;

    return {
      vol: format2(vol),
      volChg: format2(volChg),
      atmStrike: nearest.x,
      settleATMVol: nearest.y * 100,
    };
  }

  function buildOldSummaryLine({
    putTotal,
    callTotal,
    vol,
    volChg,
    futureChg,
  }) {
    return (
      "Put: " + Number(putTotal || 0).toLocaleString("en-US") +
      "  Call: " + Number(callTotal || 0).toLocaleString("en-US") +
      "  Vol: " + (vol ?? "") +
      "  Vol Chg: " + (volChg ?? "") +
      "  Future Chg: " + (futureChg ?? "")
    );
  }

  //==============================
  // PROFILE EXTRACTION
  //==============================
  function getCurrentHeaderInfo(pageText) {
    const matches = pageText.match(
      /Gold\s*\(OG\|GC\)\s+[A-Z0-9]+\s+\([0-9.]+\s+DTE\)\s+vs\s+[+\-0-9.,]+\s+\([+\-0-9.,]+\)\s+-\s+(Intraday Volume|EOD Volume|Open Interest)/g
    );

    const rawHeader = matches ? matches[matches.length - 1] : "";

    const futureChgMatch = rawHeader.match(
      /\(([+\-]?\d+(?:\.\d+)?)\)\s+-\s+(Intraday Volume|EOD Volume|Open Interest)/
    );

    return {
      rawHeader,
      futureChg: futureChgMatch ? futureChgMatch[1] : "",
    };
  }

  function makeHeaderForMode(rawHeader, modeLabel) {
    if (!rawHeader) {
      throw new Error("Cannot find Gold profile header.");
    }

    return rawHeader.replace(
      /\s+-\s+(Intraday Volume|EOD Volume|Open Interest)\s*$/,
      " - " + modeLabel
    );
  }

  function formatInt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  async function extractIntradayData(statusCallback) {
    const pageText = document.body.innerText.replace(/\u00a0/g, " ");
    const headerInfo = getCurrentHeaderInfo(pageText);

    const selected = chooseGoldChart();
    const baseRows = selected.rows;

    if (!baseRows.length || !isGoldRows(baseRows)) {
      throw new Error("Cannot find valid Gold rows.");
    }

    const volSummary = getVerifiedVolSummary(selected.chart);

    if (statusCallback) {
      statusCallback("Reading Intraday Volume from QuikStrike...");
    }

    const intradayRows = await fetchIntradayRowsFromChart(
      selected.chart,
      baseRows,
      statusCallback
    );

    const callTotal = intradayRows.reduce(
      (sum, r) => sum + Number(r[1] || 0),
      0
    );
    const putTotal = intradayRows.reduce(
      (sum, r) => sum + Number(r[2] || 0),
      0
    );

    const headerLine = makeHeaderForMode(
      headerInfo.rawHeader,
      "Intraday Volume"
    );

    const summaryLine = buildOldSummaryLine({
      putTotal,
      callTotal,
      vol: volSummary.vol,
      volChg: volSummary.volChg,
      futureChg: headerInfo.futureChg,
    });

    return (
      headerLine +
      "\n" +
      summaryLine +
      "\n" +
      "Strike,Call,Put,Vol Settle\n" +
      intradayRows.map((r) => r.join(",")).join("\n")
    ).trim();
  }

  function extractOIData() {
    const pageText = document.body.innerText.replace(/\u00a0/g, " ");
    const headerInfo = getCurrentHeaderInfo(pageText);

    const selected = chooseGoldChart();
    const chartTitle = clean(selected.title);
    const rows = selected.rows;

    if (!rows.length || !isGoldRows(rows)) {
      throw new Error("Cannot find valid Gold rows.");
    }

    if (!/Open Interest/i.test(chartTitle)) {
      throw new Error("Please select OI on the CME page first.");
    }

    const volSummary = getVerifiedVolSummary(selected.chart);

    const callTotal = rows.reduce(
      (sum, r) => sum + Number(r[1] || 0),
      0
    );
    const putTotal = rows.reduce(
      (sum, r) => sum + Number(r[2] || 0),
      0
    );

    const headerLine = makeHeaderForMode(
      headerInfo.rawHeader,
      "Open Interest"
    );

    const summaryLine = buildOldSummaryLine({
      putTotal,
      callTotal,
      vol: volSummary.vol,
      volChg: volSummary.volChg,
      futureChg: headerInfo.futureChg,
    });

    return (
      headerLine +
      "\n" +
      summaryLine +
      "\n" +
      "Strike,Call,Put,Vol Settle\n" +
      rows.map((r) => r.join(",")).join("\n")
    ).trim();
  }

  //==============================
  // SD RANGES EXTRACTION
  // CME New Highcharts plotBands method
  //==============================
  function extractSDRanges() {

    if (typeof Highcharts === "undefined") {
      throw new Error("Highcharts not ready.");
    }


    const charts = Highcharts.charts.filter(Boolean);

    if (!charts.length) {
      throw new Error("No Highcharts chart found.");
    }


    // Find CME chart containing SD zones
    const chart = charts.find((ch) =>
      ch.xAxis &&
      ch.xAxis[0] &&
      ch.xAxis[0].options.plotBands &&
      ch.xAxis[0].options.plotBands.length >= 3
    );


    if (!chart) {
      throw new Error("Cannot find SD plotBands.");
    }


    const axis = chart.xAxis[0];


    // Future price
    // CME currently stores Future as last plotLine
    const lines = axis.options.plotLines || [];

    const future = Number(
      lines[lines.length - 1]?.value
    );


    if (!Number.isFinite(future)) {
      throw new Error("Cannot find Future price.");
    }


    // Sort SD bands:
    // nearest SD first
    const bands = [...axis.options.plotBands]
      .sort(
        (a, b) =>
          (a.to - a.from) -
          (b.to - b.from)
      );


    if (bands.length < 3) {
      throw new Error("SD bands incomplete.");
    }


    // 1 SD
    const sd1Put =
      future - bands[0].from;

    const sd1Call =
      bands[0].to - future;


    // 2 SD
    const sd2Put =
      future - bands[1].from;

    const sd2Call =
      bands[1].to - future;


    // 3 SD
    const sd3Put =
      future - bands[2].from;

    const sd3Call =
      bands[2].to - future;



    const fmt = (n) =>
      Number(n.toFixed(2));


    // KEEP OLD FORMAT FOR TRADINGVIEW
    // 3SD Put,2SD Put,1SD Put,1SD Call,2SD Call,3SD Call

    return [
      fmt(sd3Put),
      fmt(sd2Put),
      fmt(sd1Put),
      fmt(sd1Call),
      fmt(sd2Call),
      fmt(sd3Call)
    ].join(",");
  }

  //==============================
  // PANEL POSITION
  //==============================
  function getVisibleChartElementForPosition() {
    try {
      if (typeof Highcharts === "undefined" || !Highcharts.charts) {
        return null;
      }

      const charts = Highcharts.charts.filter(Boolean);

      const candidates = charts
        .map((ch) => {
          const el = ch.container;
          const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;

          return {
            el,
            rect,
            area: rect ? rect.width * rect.height : 0,
          };
        })
        .filter((x) =>
          x.el &&
          x.rect &&
          x.rect.width > 100 &&
          x.rect.height > 100
        )
        .sort((a, b) => b.area - a.area);

      return candidates.length ? candidates[0].el : null;
    } catch (e) {
      console.warn("Cannot find visible chart for panel position:", e);
      return null;
    }
  }

  function getPanelBounds(panel) {
    const minLeft = window.scrollX + 8;
    const minTop = window.scrollY + 8;

    const maxLeft = Math.max(
      minLeft,
      window.scrollX + document.documentElement.clientWidth - panel.offsetWidth - 8
    );

    return { minLeft, minTop, maxLeft };
  }

  function savePanelPosition(panel) {
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);

    if (Number.isFinite(left) && Number.isFinite(top)) {
      localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left, top }));
    }
  }

  function positionPanel(panel, forceDefault = false) {
    panel.style.position = "absolute";
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    if (!forceDefault) {
      const saved = localStorage.getItem(PANEL_POS_KEY);

      if (saved) {
        try {
          const pos = JSON.parse(saved);

          if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            const bounds = getPanelBounds(panel);

            const left = clampNumber(pos.left, bounds.minLeft, bounds.maxLeft);
            const top = Math.max(bounds.minTop, pos.top);

            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            return;
          }
        } catch (e) {}
      }
    }

    let top = window.scrollY + 140;
    let left = window.scrollX + 20;

    const chartEl = getVisibleChartElementForPosition();

    if (chartEl) {
      const rect = chartEl.getBoundingClientRect();

      // Place helper below chart.
      top = window.scrollY + rect.bottom + 18;

      // Align to left side of chart.
      left = window.scrollX + rect.left;
    }

    const bounds = getPanelBounds(panel);

    left = clampNumber(left, bounds.minLeft, bounds.maxLeft);
    top = Math.max(bounds.minTop, top);

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;

    if (forceDefault) {
      savePanelPosition(panel);
    }
  }

  function resetPanelPosition(panel) {
    localStorage.removeItem(PANEL_POS_KEY);
    positionPanel(panel, true);
  }

  function enablePanelDrag(panel) {
    const header = document.getElementById("ogt-helper-header");

    if (!header) return;

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.style.cursor = "move";
    header.style.userSelect = "none";
    header.style.touchAction = "none";

    header.addEventListener("pointerdown", (e) => {
      dragging = true;

      const rect = panel.getBoundingClientRect();

      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      try {
        header.setPointerCapture(e.pointerId);
      } catch (err) {}

      e.preventDefault();
    });

    header.addEventListener("pointermove", (e) => {
      if (!dragging) return;

      let left = window.scrollX + e.clientX - offsetX;
      let top = window.scrollY + e.clientY - offsetY;

      const bounds = getPanelBounds(panel);

      left = clampNumber(left, bounds.minLeft, bounds.maxLeft);
      top = Math.max(bounds.minTop, top);

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    header.addEventListener("pointerup", () => {
      if (!dragging) return;

      dragging = false;
      savePanelPosition(panel);
    });

    header.addEventListener("pointercancel", () => {
      dragging = false;
    });
  }

  //==============================
  // UI PANEL
  //==============================
  function makePanel() {
    if (document.getElementById("ogt-v2v-helper")) return;

    const panel = document.createElement("div");
    panel.id = "ogt-v2v-helper";

    panel.style.position = "absolute";
    panel.style.zIndex = "999999";
    panel.style.background = "#0f172a";
    panel.style.color = "#e5e7eb";
    panel.style.border = "1px solid #334155";
    panel.style.borderRadius = "12px";
    panel.style.padding = "10px";
    panel.style.boxShadow = "0 10px 25px rgba(0,0,0,0.35)";
    panel.style.fontFamily = "Arial, sans-serif";
    panel.style.fontSize = "12px";
    panel.style.width = "220px";
    panel.style.maxWidth = "calc(100vw - 24px)";
    panel.style.opacity = "0.96";

    panel.innerHTML = `
      <div id="ogt-helper-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:bold;color:#facc15;margin-bottom:8px;font-size:12px;">
        <span>Gold Vol2Vol Helper</span>
        <button id="ogt-reset-pos" title="Reset position" style="border:0;border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:10px;padding:4px 6px;cursor:pointer;">
          Reset Pos
        </button>
      </div>

      <button id="ogt-copy-intraday" style="width:100%;margin-bottom:7px;padding:8px;border:0;border-radius:8px;background:#2563eb;color:white;font-weight:bold;cursor:pointer;font-size:12px;">
        Copy Intraday
      </button>

      <button id="ogt-copy-oi" style="width:100%;margin-bottom:7px;padding:8px;border:0;border-radius:8px;background:#0f766e;color:white;font-weight:bold;cursor:pointer;font-size:12px;">
        Copy OI
      </button>

      <button id="ogt-copy-sd" style="width:100%;margin-bottom:7px;padding:8px;border:0;border-radius:8px;background:#7c3aed;color:white;font-weight:bold;cursor:pointer;font-size:12px;">
        Copy SD Ranges
      </button>

      <div id="ogt-status" style="margin-top:6px;color:#a7f3d0;font-size:11px;min-height:18px;line-height:1.35;"></div>

      <div style="margin-top:6px;color:#94a3b8;font-size:10px;line-height:1.3;">
        Intraday = ดึงจาก ChartTip ราย Strike<br>OI = เลือกเมนู OI ก่อนกด Copy OI<br>
        Gold filter: strike ${GOLD_MIN_STRIKE}-${GOLD_MAX_STRIKE}
      </div>
    `;

    document.body.appendChild(panel);

    enablePanelDrag(panel);
    positionPanel(panel);

    // Reposition after CME chart finishes late layout adjustments.
    // Saved manual position is respected unless user clicks Reset Pos.
    setTimeout(() => positionPanel(panel), 500);
    setTimeout(() => positionPanel(panel), 1500);
    setTimeout(() => positionPanel(panel), 3000);

    window.addEventListener("resize", () => positionPanel(panel));

    const status = document.getElementById("ogt-status");

    document.getElementById("ogt-reset-pos").addEventListener("click", (e) => {
      e.stopPropagation();
      resetPanelPosition(panel);
      status.textContent = "Panel position reset.";
    });

    document.getElementById("ogt-copy-intraday").addEventListener("click", async () => {
      const button = document.getElementById("ogt-copy-intraday");

      try {
        button.disabled = true;
        button.style.opacity = "0.65";
        button.textContent = "Reading...";

        const output = await extractIntradayData((msg) => {
          status.textContent = msg;
        });

        copyToClipboard(output);

        const firstStrike = output.split("\n")[3]?.split(",")[0] || "";
        status.textContent = "Copied Intraday. First strike: " + firstStrike;

        console.log(output);
      } catch (err) {
        status.textContent = "Error: " + err.message;
        console.error(err);
      } finally {
        button.disabled = false;
        button.style.opacity = "1";
        button.textContent = "Copy Intraday";
      }
    });

    document.getElementById("ogt-copy-oi").addEventListener("click", () => {
      try {
        const output = extractOIData();
        copyToClipboard(output);

        const firstStrike = output.split("\n")[3]?.split(",")[0] || "";
        status.textContent = "Copied OI. First strike: " + firstStrike;

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

  //==============================
  // INIT
  //==============================
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
