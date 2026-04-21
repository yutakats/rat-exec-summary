// ==UserScript==
// @name         Enterprise Manager Replay Executive Summary
// @namespace    oracle.internal.em
// @version      1.0.0
// @description  Generate an executive replay summary from Oracle Enterprise Manager DB Replay reports.
// @match        *://*/em/console/database/workload/report*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (!/DB Replay Report/i.test(document.title) && !/replay_report_html/i.test(location.href)) {
    return;
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html || "", "text/html");
  }

  function textContent(node) {
    return (node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function toNumber(value) {
    const cleaned = String(value || "")
      .replace(/,/g, "")
      .replace(/%/g, "")
      .replace(/[^\d.+-]/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function extractTableRows(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => textContent(cell))
    );
  }

  function findTableBySummary(doc, summaryFragment) {
    return Array.from(doc.querySelectorAll("table")).find((table) =>
      (table.getAttribute("summary") || "").toLowerCase().includes(summaryFragment.toLowerCase())
    );
  }

  function findSectionHeading(doc, label) {
    return Array.from(doc.querySelectorAll("div, h2, h3, p")).find(
      (node) => textContent(node).toLowerCase() === label.toLowerCase()
    );
  }

  function tableAfterLabel(doc, label) {
    const heading = findSectionHeading(doc, label);
    let current = heading?.nextElementSibling || null;
    while (current) {
      if (current.tagName === "TABLE") {
        return current;
      }
      const nested = current.querySelector?.("table");
      if (nested) {
        return nested;
      }
      current = current.nextElementSibling;
    }
    return null;
  }

  function rowsToMap(rows) {
    const result = {};
    rows.slice(1).forEach((cells) => {
      if (cells.length >= 2) {
        result[cells[0]] = cells[1];
      }
    });
    return result;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseDbReplayReport(html) {
    const doc = parseHtml(html);
    const dbHeader = extractTableRows(findTableBySummary(doc, "database header"));
    const replayInfo = extractTableRows(findTableBySummary(doc, "capture/replay header"));
    const replayStats = extractTableRows(findTableBySummary(doc, "capture/replay statistics"));
    const divergence = extractTableRows(findTableBySummary(doc, "replay divergence summary"));

    const dbHeaderMap = {};
    if (dbHeader[0] && dbHeader[1]) {
      dbHeader[0].forEach((header, index) => {
        dbHeaderMap[header] = dbHeader[1][index] || "";
      });
    }

    const replayInfoMap = {};
    replayInfo.slice(1).forEach((cells) => {
      replayInfoMap[cells[0]] = { replay: cells[1] || "", capture: cells[2] || "" };
    });

    const replayStatsMap = {};
    replayStats.slice(1).forEach((cells) => {
      replayStatsMap[cells[0]] = { replay: cells[1] || "", capture: cells[2] || "" };
    });

    const divergenceMap = {};
    divergence.slice(1).forEach((cells) => {
      divergenceMap[cells[0]] = {
        count: toNumber(cells[1]),
        percent: toNumber(cells[2]),
      };
    });

    return { dbHeader: dbHeaderMap, replayInfo: replayInfoMap, replayStats: replayStatsMap, divergence: divergenceMap };
  }

  function parseCompareReport(html) {
    const doc = parseHtml(html);
    const divergenceRows = extractTableRows(tableAfterLabel(doc, "Replay Divergence"));
    const mainPerfRows = extractTableRows(tableAfterLabel(doc, "Main Performance Statistics"));

    const divergence = divergenceRows[1]
      ? { level: divergenceRows[1][1], percent: toNumber(divergenceRows[1][2]) }
      : {};

    const mainPerformance = {};
    mainPerfRows.slice(1).forEach((cells) => {
      mainPerformance[cells[0]] = {
        changePct: toNumber(cells[1]),
        captureTotal: cells[2] || "",
        replayTotal: cells[3] || "",
        captureDbPct: toNumber(cells[4]),
        replayDbPct: toNumber(cells[5]),
      };
    });

    return { divergence, mainPerformance };
  }

  function parseAwrReport(html) {
    const doc = parseHtml(html);
    const topEventsRows = extractTableRows(
      Array.from(doc.querySelectorAll("table")).find((table) =>
        (table.getAttribute("summary") || "").includes("top timed events")
      )
    );
    const loadProfileRows = extractTableRows(
      Array.from(doc.querySelectorAll("table")).find((table) => {
        const nearbyText = [
          textContent(table.previousElementSibling),
          textContent(table.parentElement?.previousElementSibling),
          textContent(table.parentElement),
        ].join(" ");
        return nearbyText.toLowerCase().includes("load profile");
      })
    );

    const topEvents = [];
    topEventsRows.slice(1).forEach((cells) => {
      if (cells.length >= 12) {
        topEvents.push({
          secondEvent: cells[6],
          secondWaitClass: cells[7],
          secondWaits: toNumber(cells[8]),
          secondTimeSeconds: toNumber(cells[9]),
          secondDbTimePct: toNumber(cells[11]),
        });
      }
    });

    const loadProfile = {};
    loadProfileRows.slice(1).forEach((cells) => {
      loadProfile[cells[0]] = {
        perSecDiffPct: toNumber(cells[3]),
      };
    });

    return { topEvents, loadProfile };
  }

  function buildReplaySummary({ replayId, dbReplayHtml, compareHtml, awrHtml }) {
    const dbReplay = parseDbReplayReport(dbReplayHtml);
    const compare = parseCompareReport(compareHtml);
    const awr = parseAwrReport(awrHtml);
    const findings = [];

    const divergencePct =
      compare.divergence.percent ??
      dbReplay.divergence["SELECTs with Different Number of Rows Fetched"]?.percent;

    if ((compare.mainPerformance["Database Time"]?.changePct ?? 0) <= 0) {
      findings.push("Replay DB time improved compared with capture.");
    } else {
      findings.push("Replay DB time regressed compared with capture.");
    }

    if ((divergencePct ?? 0) > 0) {
      findings.push(
        `Replay divergence is ${compare.divergence.level || "UNKNOWN"} at ${divergencePct.toFixed(2)}% of calls, driven primarily by SELECT row-count differences.`
      );
    }

    const topConcurrency = awr.topEvents.find((event) => /concurrency/i.test(event.secondWaitClass || ""));
    if (topConcurrency) {
      findings.push(
        `${topConcurrency.secondEvent} is a visible replay wait, which suggests parse, shared pool, or metadata contention.`
      );
    }

    if ((awr.loadProfile["Hard parses (SQL):"]?.perSecDiffPct || 0) > 20) {
      findings.push("Hard parse volume is elevated in replay, which can feed library cache mutex pressure.");
    }

    return {
      replayId,
      replayName: dbReplay.dbHeader["Replay Name"] || `Replay ${replayId}`,
      status: dbReplay.dbHeader["Replay Status"] || "UNKNOWN",
      divergence: compare.divergence,
      dbTimeChange: compare.mainPerformance["Database Time"]?.changePct,
      cpuTimeChange: compare.mainPerformance["CPU Time"]?.changePct,
      topWait: topConcurrency?.secondEvent || awr.topEvents[0]?.secondEvent || "-",
      findings,
    };
  }

  function renderSummary(summary) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${summary.replayName} Executive Summary</title>
  <style>
    body { margin: 0; padding: 28px; font: 16px/1.5 "Segoe UI", sans-serif; color: #1f2937; background: #fffdf8; }
    h1 { margin: 0 0 8px; font-size: 2rem; }
    .sub { color: #5b6472; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: white; border: 1px solid rgba(31,41,55,0.12); border-radius: 16px; padding: 14px; }
    .label { text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.12em; color: #6b7280; }
    .value { margin-top: 6px; font-size: 1.2rem; font-weight: 700; }
    .finding { background: white; border: 1px solid rgba(31,41,55,0.12); border-radius: 16px; padding: 14px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>${summary.replayName}</h1>
  <div class="sub">Executive replay summary for Replay ID ${summary.replayId}</div>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${summary.status}</div></div>
    <div class="card"><div class="label">DB Time Change</div><div class="value">${summary.dbTimeChange ?? "-"}%</div></div>
    <div class="card"><div class="label">CPU Time Change</div><div class="value">${summary.cpuTimeChange ?? "-"}%</div></div>
    <div class="card"><div class="label">Top Replay Wait</div><div class="value">${summary.topWait}</div></div>
  </div>
  ${summary.findings.map((finding) => `<div class="finding">${finding}</div>`).join("")}
</body>
</html>`;
  }

  function renderError(error) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Replay Summary Error</title>
  <style>
    body { margin: 0; padding: 28px; font: 16px/1.5 "Segoe UI", sans-serif; color: #1f2937; background: #fffdf8; }
    .panel { background: white; border: 1px solid rgba(31,41,55,0.12); border-radius: 16px; padding: 18px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border-radius: 12px; padding: 14px; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>Unable to build the executive summary</h1>
    <p>The report popup opened, but the summary generation failed.</p>
    <pre>${escapeHtml(error?.stack || error?.message || String(error))}</pre>
  </div>
</body>
</html>`;
  }

  function getReplayId() {
    return new URLSearchParams(location.search).get("reportEntityId") || "unknown";
  }

  async function fetchReport(name, replayId) {
    const url = new URL(location.href);
    url.searchParams.set("_em.noNav", "true");
    url.searchParams.set("reportEntityId", replayId);
    url.searchParams.set("reportDataType", "2");
    url.searchParams.set("reportDataName", name);
    const response = await fetch(url.toString(), { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${name}: ${response.status}`);
    }
    return response.text();
  }

  async function fetchFirstAvailableReport(names, replayId) {
    let lastError = null;
    for (const name of names) {
      try {
        return await fetchReport(name, replayId);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`No matching report name worked for replay ${replayId}.`);
  }

  async function runSummary() {
    const replayId = getReplayId();
    const popup = window.open("", `replay-summary-${replayId}`, "width=1200,height=900");
    if (!popup) {
      alert("Popup blocked. Allow popups for the Enterprise Manager site.");
      return;
    }
    popup.document.open();
    popup.document.write("<p style='font:16px sans-serif;padding:24px'>Building executive replay summary...</p>");
    popup.document.close();

    try {
      const currentHtml = document.documentElement.outerHTML;
      const [compareHtml, awrHtml] = await Promise.all([
        fetchFirstAvailableReport(
          [
            `replay_compare_report8_${replayId}`,
            `replay_compare_report_${replayId}`,
            `replay_compare_report8`,
          ],
          replayId
        ),
        fetchFirstAvailableReport(
          [
            `awr_compare_report8_${replayId}`,
            `awr_compare_report_${replayId}`,
            `awr_compare_report8`,
          ],
          replayId
        ),
      ]);
      const summary = buildReplaySummary({
        replayId,
        dbReplayHtml: currentHtml,
        compareHtml,
        awrHtml,
      });
      popup.document.open();
      popup.document.write(renderSummary(summary));
      popup.document.close();
    } catch (error) {
      popup.document.open();
      popup.document.write(renderError(error));
      popup.document.close();
      console.error(error);
    }
  }

  const button = document.createElement("button");
  button.textContent = "Open Executive Summary";
  button.type = "button";
  button.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:99999",
    "padding:12px 16px",
    "border:none",
    "border-radius:999px",
    "background:#9a3412",
    "color:white",
    "font:700 13px/1 sans-serif",
    "box-shadow:0 12px 24px rgba(0,0,0,0.18)",
    "cursor:pointer",
  ].join(";");
  button.addEventListener("click", runSummary);
  document.body.appendChild(button);
})();
