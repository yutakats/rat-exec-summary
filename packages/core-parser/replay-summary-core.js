(function () {
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

  function normalizeSqlId(value) {
    const text = String(value || "").toLowerCase();
    const match = text.match(/\b[0-9a-v]{13}\b/);
    return match ? match[0] : "";
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
    const normalizedNeedle = String(summaryFragment || "")
      .toLowerCase()
      .replace(/\s+/g, "");
    return Array.from(doc.querySelectorAll("table")).find((table) =>
      String(table.getAttribute("summary") || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .includes(normalizedNeedle)
    );
  }

  function findSectionHeading(doc, label) {
    const wanted = label.toLowerCase();
    const prioritySelectors = [
      ".section_title",
      ".subsection_title",
      "h2.awr",
      "h3.awr",
      "h2",
      "h3",
      "div",
      "p",
    ];

    for (const selector of prioritySelectors) {
      const match = Array.from(doc.querySelectorAll(selector)).find((node) => {
        const text = textContent(node).toLowerCase();
        return text === wanted || text.endsWith(wanted);
      });
      if (match) {
        return match;
      }
    }

    return Array.from(doc.querySelectorAll("div, h2, h3, p")).find((node) => {
      const text = textContent(node).toLowerCase();
      return text.includes(wanted);
    });
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

  function cellByHeaders(row, requiredParts) {
    const cells = Array.from(row?.querySelectorAll("td, th") || []);
    const parts = (requiredParts || []).map((part) => String(part || "").toLowerCase());
    const match = cells.find((cell) => {
      const headers = String(cell.getAttribute("headers") || "").toLowerCase();
      return parts.every((part) => headers.includes(part));
    });
    return match || null;
  }

  function isMarkerToken(value) {
    const normalized = String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^[-:]+|[-:]+$/g, "");
    return (
      normalized === "" ||
      normalized === "-" ||
      normalized === "1" ||
      normalized === "2" ||
      normalized === "1st" ||
      normalized === "2nd" ||
      normalized === "*1st" ||
      normalized === "*2nd" ||
      normalized === "first" ||
      normalized === "second"
    );
  }

  function parseWaitLabels(row) {
    const cells = Array.from(row?.querySelectorAll("td") || []);
    const labels = cells
      .map((cell) => textContent(cell))
      .filter((value) => /[A-Za-z]/.test(value) && !isMarkerToken(value));
    return {
      event: labels[0] || "",
      waitClass: labels[1] || "",
    };
  }

  function parseAwrWaitClassRows(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr"))
      .slice(2)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const labels = parseWaitLabels(row);
        const waitClass = labels.event;
        if (!waitClass) {
          return null;
        }
        return {
          waitClass,
          firstPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "1st"]) || cells[1])),
          secondPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "2nd"]) || cells[2])),
          diffPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "diff"]) || cells[3])),
          firstWaitsPerSec: toNumber(textContent(cellByHeaders(row, ["#waits/sec", "1st"]) || cells[4])),
          secondWaitsPerSec: toNumber(textContent(cellByHeaders(row, ["#waits/sec", "2nd"]) || cells[5])),
          waitsPerSecPctDiff: toNumber(textContent(cellByHeaders(row, ["#waits/sec", "%diff"]) || cells[6])),
          firstTotalWaitSec: toNumber(textContent(cellByHeaders(row, ["totalwaittime", "1st"]) || cells[7])),
          secondTotalWaitSec: toNumber(textContent(cellByHeaders(row, ["totalwaittime", "2nd"]) || cells[8])),
          totalWaitSecPctDiff: toNumber(textContent(cellByHeaders(row, ["totalwaittime", "%diff"]) || cells[9])),
          firstAvgWait: textContent(cellByHeaders(row, ["avgwaittime", "1st"]) || cells[10]),
          secondAvgWait: textContent(cellByHeaders(row, ["avgwaittime", "2nd"]) || cells[11]),
          avgWaitPctDiff: toNumber(textContent(cellByHeaders(row, ["avgwaittime", "%diff"]) || cells[12])),
        };
      })
      .filter(Boolean);
  }

  function parseAwrWaitEventRows(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr"))
      .slice(2)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const labels = parseWaitLabels(row);
        const event = labels.event;
        if (!event) {
          return null;
        }
        return {
          event,
          waitClass: labels.waitClass,
          firstPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "1st"]) || cells[2])),
          secondPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "2nd"]) || cells[3])),
          diffPctDbTime: toNumber(textContent(cellByHeaders(row, ["%ofdbtime", "diff"]) || cells[4])),
          firstWaitsPerSec: toNumber(textContent(cellByHeaders(row, ["#waits/sec", "1st"]) || cells[5])),
          secondWaitsPerSec: toNumber(textContent(cellByHeaders(row, ["#waits/sec", "2nd"]) || cells[6])),
          firstTotalWaitSec: toNumber(textContent(cellByHeaders(row, ["totalwaittime", "1st"]) || cells[8])),
          secondTotalWaitSec: toNumber(textContent(cellByHeaders(row, ["totalwaittime", "2nd"]) || cells[9])),
          firstAvgWait: textContent(cellByHeaders(row, ["avgwaittime", "1st"]) || cells[11]),
          secondAvgWait: textContent(cellByHeaders(row, ["avgwaittime", "2nd"]) || cells[12]),
          avgWaitPctDiff: toNumber(textContent(cellByHeaders(row, ["avgwaittime", "%diff"]) || cells[13])),
        };
      })
      .filter(Boolean);
  }

  function parseAwrSnapshots(table) {
    if (!table) {
      return {};
    }

    const rows = Array.from(table.querySelectorAll("tr"));
    if (!rows.length) {
      return {};
    }

    const headers = Array.from(rows[0].querySelectorAll("th")).map((th) =>
      textContent(th).toLowerCase().replace(/[^a-z0-9]+/g, "")
    );
    const indexOf = (needle) => headers.findIndex((value) => value.includes(needle));
    const firstIndexOf = (...needles) => {
      for (const needle of needles) {
        const idx = indexOf(needle);
        if (idx >= 0) {
          return idx;
        }
      }
      return -1;
    };

    const setIndex = indexOf("set");
    const elapsedIndex = indexOf("elapsedtimemin");
    const dbTimeIndex = indexOf("dbtimemin");
    const aasIndex = firstIndexOf("avgactivesessions", "avgactiveusers");
    const beginTimeIndex = indexOf("beginsnaptime");
    const endTimeIndex = indexOf("endsnaptime");

    const snapshots = {};
    rows.slice(1).forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.length) {
        return;
      }
      const setLabel = textContent(cells[Math.max(setIndex, 0)]);
      const setKey = /^1st$/i.test(setLabel) ? "1st" : /^2nd$/i.test(setLabel) ? "2nd" : null;
      if (!setKey) {
        return;
      }

      const existing = snapshots[setKey] || {
        beginTime: null,
        endTime: null,
        elapsedMinutes: null,
        dbTimeMinutes: null,
        avgActiveUsers: null,
      };

      const elapsed = toNumber(textContent(cells[elapsedIndex]));
      const dbTime = toNumber(textContent(cells[dbTimeIndex]));
      const aas = toNumber(textContent(cells[aasIndex]));
      if (existing.beginTime == null && beginTimeIndex >= 0) {
        existing.beginTime = textContent(cells[beginTimeIndex]) || null;
      }
      if (existing.endTime == null && endTimeIndex >= 0) {
        existing.endTime = textContent(cells[endTimeIndex]) || null;
      }
      if (existing.elapsedMinutes == null && Number.isFinite(elapsed)) {
        existing.elapsedMinutes = elapsed;
      }
      if (Number.isFinite(dbTime)) {
        existing.dbTimeMinutes = (existing.dbTimeMinutes ?? 0) + dbTime;
      }
      if (Number.isFinite(aas)) {
        existing.avgActiveUsers = (existing.avgActiveUsers ?? 0) + aas;
      }

      snapshots[setKey] = existing;
    });

    return snapshots;
  }

  function parseAwrTimeModelRows(table) {
    if (!table) {
      return {};
    }

    const result = {};
    Array.from(table.querySelectorAll("tr"))
      .slice(2)
      .forEach((row) => {
        const labels = parseWaitLabels(row);
        const statisticName = labels.event;
        if (!statisticName) {
          return;
        }

        const firstPctDbTime = toNumber(
          textContent(
            cellByHeaders(row, ["%ofdbtime", "1st"]) || cellByHeaders(row, ["%ofglobaldbtime", "1st"])
          )
        );
        const secondPctDbTime = toNumber(
          textContent(
            cellByHeaders(row, ["%ofdbtime", "2nd"]) || cellByHeaders(row, ["%ofglobaldbtime", "2nd"])
          )
        );
        const diffPctDbTime = toNumber(
          textContent(
            cellByHeaders(row, ["%ofdbtime", "diff"]) || cellByHeaders(row, ["%ofglobaldbtime", "diff"])
          )
        );

        result[statisticName] = {
          firstPctDbTime,
          secondPctDbTime,
          diffPctDbTime,
          firstTimeSeconds: toNumber(textContent(cellByHeaders(row, ["time(seconds)", "1st"]))),
          secondTimeSeconds: toNumber(textContent(cellByHeaders(row, ["time(seconds)", "2nd"]))),
          timePctDiff: toNumber(textContent(cellByHeaders(row, ["time(seconds)", "%diff"]))),
          firstPerTxn: toNumber(textContent(cellByHeaders(row, ["timepertrans(seconds)", "1st"]))),
          secondPerTxn: toNumber(textContent(cellByHeaders(row, ["timepertrans(seconds)", "2nd"]))),
          perTxnPctDiff: toNumber(textContent(cellByHeaders(row, ["timepertrans(seconds)", "%diff"]))),
        };
      });

    return result;
  }

  function parseTopSqlComparisonTable(table, sectionName) {
    if (!table) {
      return [];
    }

    const headerRows = Array.from(table.querySelectorAll("tr"));
    const primaryHeaderId = Array.from(headerRows[0]?.querySelectorAll("th") || [])
      .map((th) => th.getAttribute("id"))
      .find((id) => id && !id.includes("ContainerDBId") && !id.includes("#Plans"));

    return headerRows
      .slice(2)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const sqlId = normalizeSqlId(textContent(cells[0]));
        if (!sqlId) {
          return null;
        }

        const firstMetric = toNumber(
          textContent(cellByHeaders(row, [primaryHeaderId, "1st"]) || cells[1])
        );
        const secondMetric = toNumber(
          textContent(cellByHeaders(row, [primaryHeaderId, "2nd"]) || cells[3])
        );
        const diffMetric = toNumber(
          textContent(cellByHeaders(row, [primaryHeaderId, "diff"]) || cells[5])
        );
        const executionsFirst = toNumber(textContent(cellByHeaders(row, ["#executions", "1st"])));
        const executionsSecond = toNumber(textContent(cellByHeaders(row, ["#executions", "2nd"])));
        const perExecFirst = toNumber(
          textContent(cellByHeaders(row, ["elapsedtime(ms)perexec", "1st"]) || cellByHeaders(row, ["exectime(ms)perexec", "1st"]))
        );
        const perExecSecond = toNumber(
          textContent(cellByHeaders(row, ["elapsedtime(ms)perexec", "2nd"]) || cellByHeaders(row, ["exectime(ms)perexec", "2nd"]))
        );
        const sqlText = textContent(cells[cells.length - 1] || "");

        return {
          section: sectionName,
          sqlId,
          firstMetricPct: firstMetric,
          secondMetricPct: secondMetric,
          diffMetricPct: diffMetric,
          executionsFirst,
          executionsSecond,
          perExecMsFirst: perExecFirst,
          perExecMsSecond: perExecSecond,
          sqlText,
        };
      })
      .filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function highlightInline(text) {
    return escapeHtml(text)
      .replace(/(DB Time [+-]?\d+(?:\.\d+)?%)/g, "<strong>$1</strong>")
      .replace(/(\d[\d,]*\.?\d*s -> \d[\d,]*\.?\d*s)/g, "<strong>$1</strong>")
      .replace(/(CPU cores decreased from \d+ to \d+)/gi, "<strong>$1</strong>")
      .replace(/(CPU cores increased from \d+ to \d+)/gi, "<strong>$1</strong>")
      .replace(/(physical memory (?:decreased|increased) from [^.,;]+ to [^.,;]+)/gi, "<strong>$1</strong>")
      .replace(/(\d+(?:\.\d+)?%)/g, "<strong>$1</strong>")
      .replace(/\b(LOW|MEDIUM|HIGH|good|bad|mixed)\b/g, "<strong>$1</strong>")
      .replace(/(resmgr:cpu quantum)/g, '<code class="inline-hot">$1</code>')
      .replace(/(19\.3\.0\.0\.0|23\.26\.1\.0\.0)/g, "<strong>$1</strong>");
  }

  function highlightVerdictText(text) {
    return highlightInline(text)
      .replace(/\b(Improved|Good|Successful)\b/g, '<strong style="color:#166534;">$1</strong>')
      .replace(/\b(Degraded|Poor|Failed|Aborted|Unsuccessful|Bad|High)\b/g, '<strong style="color:#b91c1c;">$1</strong>');
  }

  function parseDbReplayReport(html) {
    const doc = parseHtml(html);
    const title = textContent(doc.querySelector(".report_title")) || "DB Replay Report";
    const dbHeader = extractTableRows(findTableBySummary(doc, "database header"));
    const replayInfo = extractTableRows(findTableBySummary(doc, "capture/replay header"));
    const replayOptions = extractTableRows(findTableBySummary(doc, "replay options"));
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

    return {
      title,
      dbHeader: dbHeaderMap,
      replayInfo: replayInfoMap,
      replayOptions: rowsToMap(replayOptions),
      replayStats: replayStatsMap,
      divergence: divergenceMap,
    };
  }

  function parseCompareReport(html) {
    const doc = parseHtml(html);
    const title = textContent(doc.querySelector(".report_title")) || "Compare Period Report";
    const dataSourceRows = extractTableRows(tableAfterLabel(doc, "Data Sources"));
    const databaseInfoRows = extractTableRows(tableAfterLabel(doc, "Information About Databases"));
    const divergenceRows = extractTableRows(tableAfterLabel(doc, "Replay Divergence"));
    const mainPerfRows = extractTableRows(tableAfterLabel(doc, "Main Performance Statistics"));
    const cpuRows = extractTableRows(tableAfterLabel(doc, "CPU Usage"));
    const ioRows = extractTableRows(tableAfterLabel(doc, "I/O to Data and Temp Files"));
    const importantParamRows = extractTableRows(tableAfterLabel(doc, "Changes to Important Parameters"));
    const optimizerParamRows = extractTableRows(tableAfterLabel(doc, "Changes to Optimizer-Relevant Parameters"));
    const memoryParamRows = extractTableRows(tableAfterLabel(doc, "Changes to Memory Configuration Parameters"));
    const underscoreParamRows = extractTableRows(tableAfterLabel(doc, "Changes to Underscore Parameters"));
    const captureInstanceRows = extractTableRows(tableAfterLabel(doc, "Instances of the Capture Database"));
    const replayInstanceRows = extractTableRows(tableAfterLabel(doc, "Instances of the Replay Database"));
    const addmTable = findTableBySummary(doc, "top statistics");

    const divergenceRow = divergenceRows.find((cells) => cells[0] === "Replay Divergence (compared to Capture)");
    const divergence = divergenceRow
      ? {
          level: divergenceRow[1],
          percent: toNumber(divergenceRow[2]),
        }
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

    const cpuUsage = {};
    cpuRows.slice(1).forEach((cells) => {
      cpuUsage[cells[0]] = {
        topology: cells[1] || "",
        hostUsage: cells[2] || "",
        sessionsOnCpu: cells[3] || "",
        runQueue: cells[4] || "",
      };
    });

    const ioStats = {};
    ioRows.slice(1).forEach((cells) => {
      ioStats[cells[0]] = {
        capture: cells[1] || "",
        replay: cells[2] || "",
      };
    });

    const addm = {};
    if (addmTable) {
      Array.from(addmTable.querySelectorAll("tr")).slice(1).forEach((row) => {
        const cells = Array.from(row.children);
        const label = textContent(cells[0]);
        if (!label) {
          return;
        }
        const parseCellPair = (cell) =>
          Array.from(cell?.querySelectorAll("p") || [])
            .map((node) => textContent(node))
            .filter(Boolean);
        const impact = parseCellPair(cells[2]);
        const aas = parseCellPair(cells[3]);
        const pct = parseCellPair(cells[4]);
        addm[label] = {
          captureImpactSec: toNumber(impact[0]),
          replayImpactSec: toNumber(impact[1]),
          captureAas: toNumber(aas[0]),
          replayAas: toNumber(aas[1]),
          capturePct: toNumber(pct[0]),
          replayPct: toNumber(pct[1]),
        };
      });
    }

    const parseCompareTopSqlTable = (table) => {
      if (!table) {
        return [];
      }
      return Array.from(table.querySelectorAll("tr"))
        .slice(1)
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length < 3) {
            return null;
          }
          return {
            sqlId: normalizeSqlId(textContent(cells[0])),
            sqlText: textContent(cells[1]),
            dbTime: toNumber(textContent(cells[2])),
          };
        })
        .filter((row) => row && row.sqlId);
    };

    const topSqlByDbTime = {
      capture: parseCompareTopSqlTable(
        findTableBySummary(doc, "Top SQL by DB Time for Time Period(1)")
      ),
      replay: parseCompareTopSqlTable(
        findTableBySummary(doc, "Top SQL by DB Time for Time Period(2)")
      ),
    };

    const rowsToCompareMap = (rows) => {
      const result = {};
      rows.slice(1).forEach((cells) => {
        result[cells[0]] = {
          capture: cells[1] || "",
          replay: cells[2] || "",
        };
      });
      return result;
    };

    const rowToObject = (rows) => {
      const headers = rows[0] || [];
      const values = rows[1] || [];
      const result = {};
      headers.forEach((header, index) => {
        result[header] = values[index] || "";
      });
      return result;
    };

    return {
      title,
      dataSources: rowsToCompareMap(dataSourceRows),
      databaseInfo: rowsToCompareMap(databaseInfoRows),
      divergence,
      mainPerformance,
      cpuUsage,
      ioStats,
      importantParams: rowsToCompareMap(importantParamRows),
      optimizerParams: rowsToCompareMap(optimizerParamRows),
      memoryParams: rowsToCompareMap(memoryParamRows),
      underscoreParams: rowsToCompareMap(underscoreParamRows),
      captureInstance: rowToObject(captureInstanceRows),
      replayInstance: rowToObject(replayInstanceRows),
      addm,
      topSqlByDbTime,
    };
  }

  function parseAwrReport(html) {
    const doc = parseHtml(html);
    const title = textContent(doc.querySelector("title")) || "AWR Compare Period Report";
    const tables = Array.from(doc.querySelectorAll("table"));
    const snapshotTable =
      findTableBySummary(doc, "information about database instances included in this report") ||
      tables.find((table) =>
        (table.getAttribute("summary") || "").includes("snapshot information")
      );
    const loadProfileRows = extractTableRows(
      tableAfterLabel(doc, "Load Profile") ||
        tables.find((table) => {
          const nearbyText = [
            textContent(table.previousElementSibling),
            textContent(table.parentElement?.previousElementSibling),
            textContent(table.parentElement),
          ].join(" ");
          return nearbyText.toLowerCase().includes("load profile");
        })
    );
    const topEventsRows = extractTableRows(
      tables.find((table) =>
        (table.getAttribute("summary") || "").includes("top timed events")
      )
    );
    const timeModelTable = tables.find((table) =>
      (table.getAttribute("summary") || "").includes("time model statistics")
    );
    const waitClassTable =
      findTableBySummary(doc, "comparisons of wait class statistics") ||
      tableAfterLabel(doc, "Wait Classes");
    const waitEventsTable =
      findTableBySummary(doc, "comparisons of wait events statistics") ||
      tableAfterLabel(doc, "Wait Events");
    const topSqlElapsedTable = tableAfterLabel(doc, "Top SQL Comparison by Elapsed Time");
    const topSqlCpuTable = tableAfterLabel(doc, "Top SQL Comparison by CPU Time");
    const topSqlIoTable = tableAfterLabel(doc, "Top SQL Comparison by I/O Time");
    const topSqlExecTable = tableAfterLabel(doc, "Top SQL Comparison by Executions");

    const snapshots = parseAwrSnapshots(snapshotTable);

    const loadProfile = {};
    loadProfileRows.slice(1).forEach((cells) => {
      loadProfile[cells[0]] = {
        firstPerSec: toNumber(cells[1]),
        secondPerSec: toNumber(cells[2]),
        perSecDiffPct: toNumber(cells[3]),
        firstPerTxn: toNumber(cells[4]),
        secondPerTxn: toNumber(cells[5]),
        perTxnDiffPct: toNumber(cells[6]),
      };
    });

    const topEvents = [];
    topEventsRows.slice(2).forEach((cells) => {
      if (cells.length >= 12) {
        topEvents.push({
          firstEvent: cells[0],
          firstWaitClass: cells[1],
          firstWaits: toNumber(cells[2]),
          firstTimeSeconds: toNumber(cells[3]),
          firstDbTimePct: toNumber(cells[5]),
          secondEvent: cells[6],
          secondWaitClass: cells[7],
          secondWaits: toNumber(cells[8]),
          secondTimeSeconds: toNumber(cells[9]),
          secondDbTimePct: toNumber(cells[11]),
        });
      }
    });

    const timeModel = parseAwrTimeModelRows(timeModelTable);

    const totals = {};
    Array.from(doc.querySelectorAll("li.awr")).forEach((item) => {
      const text = textContent(item);
      const totalParsesMatch = text.match(/Total Parses\s+First:\s*([\d,]+),\s*Second:\s*([\d,]+)/i);
      if (totalParsesMatch) {
        totals.totalParsesFirst = toNumber(totalParsesMatch[1]);
        totals.totalParsesSecond = toNumber(totalParsesMatch[2]);
      }
    });

    const waitClasses = parseAwrWaitClassRows(waitClassTable);
    const waitEvents = parseAwrWaitEventRows(waitEventsTable);
    const topSqlComparisons = {
      elapsedTime: parseTopSqlComparisonTable(topSqlElapsedTable, "Elapsed Time"),
      cpuTime: parseTopSqlComparisonTable(topSqlCpuTable, "CPU Time"),
      ioTime: parseTopSqlComparisonTable(topSqlIoTable, "I/O Time"),
      executions: parseTopSqlComparisonTable(topSqlExecTable, "Executions"),
    };

    return {
      title,
      snapshots,
      loadProfile,
      topEvents,
      timeModel,
      totals,
      waitClasses,
      waitEvents,
      topSqlComparisons,
    };
  }

  function parseCaptureSessionsTable(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr"))
      .slice(1)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 6) {
          return null;
        }
        return {
          session: textContent(cells[0]),
          activityPct: toNumber(textContent(cells[1])),
          event: textContent(cells[2]),
          eventPct: toNumber(textContent(cells[3])),
          user: textContent(cells[4]),
          program: textContent(cells[5]),
          samplesActive: textContent(cells[6] || ""),
        };
      })
      .filter((row) => row && row.session);
  }

  function parseCaptureServiceModuleTable(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr"))
      .slice(1)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 2) {
          return null;
        }
        return {
          service: textContent(cells[0]),
          module: textContent(cells[1]),
          activityPct: toNumber(textContent(cells[2] || "")),
          action: textContent(cells[3] || ""),
        };
      })
      .filter((row) => row && (row.service || row.module));
  }

  function parseCaptureSqlTable(table) {
    if (!table) {
      return [];
    }
    return Array.from(table.querySelectorAll("tr"))
      .slice(1)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 5) {
          return null;
        }
        return {
          sqlId: normalizeSqlId(textContent(cells[0])),
          activityPct: toNumber(textContent(cells[1])),
          event: textContent(cells[2]),
          eventPct: toNumber(textContent(cells[3])),
          sqlText: textContent(cells[4]),
        };
      })
      .filter((row) => row && row.sqlId);
  }

  function parseCaptureReport(html) {
    if (!html || !String(html).trim()) {
      return {
        available: false,
        missingReason: "Database Capture Report was not provided.",
      };
    }

    const doc = parseHtml(html);
    const title = textContent(doc.querySelector("title")) || "Database Capture Report";
    const captureDbRows = extractTableRows(findTableBySummary(doc, "capture database"));
    const captureSummaryRows = extractTableRows(findTableBySummary(doc, "capture summary"));
    const capturedStatsRows = extractTableRows(findTableBySummary(doc, "captured workload statistics"));
    const filterRows = extractTableRows(findTableBySummary(doc, "workload capture filters"));

    const topSqlCaptured = parseCaptureSqlTable(findTableBySummary(doc, "Top SQL Captured"));
    const topSessionsCaptured = parseCaptureSessionsTable(findTableBySummary(doc, "Top Sessions Captured"));
    const unreplayableServiceModule = parseCaptureServiceModuleTable(
      findTableBySummary(doc, "Top Service/Module containing Unreplayable Calls")
    );
    const unreplayableSessions = parseCaptureSessionsTable(
      findTableBySummary(doc, "Top Sessions containing Unreplayable Calls")
    );
    const backgroundServiceModule = parseCaptureServiceModuleTable(
      findTableBySummary(doc, "Top Service/Module (Jobs and Background Activity)")
    );
    const backgroundSessions = parseCaptureSessionsTable(
      findTableBySummary(doc, "Top Sessions (Jobs and Background Activity)")
    );

    const captureDatabase = {};
    if (captureDbRows[0] && captureDbRows[1]) {
      captureDbRows[0].forEach((header, index) => {
        captureDatabase[header] = captureDbRows[1][index] || "";
      });
    }

    const captureSummary = {};
    captureSummaryRows.slice(1).forEach((cells) => {
      if (cells[0]) {
        captureSummary[cells[0]] = cells[1] || "";
      }
    });

    const workloadStats = {};
    capturedStatsRows.slice(1).forEach((cells) => {
      if (cells[0]) {
        workloadStats[cells[0]] = {
          value: toNumber(cells[1]),
          valueText: cells[1] || "",
          totalPct: toNumber(cells[2]),
        };
      }
    });

    const workloadFilters = filterRows.slice(1).map((cells) => ({
      name: cells[1] || "",
      type: cells[2] || "",
      attribute: cells[3] || "",
      value: cells[4] || "",
    }));

    return {
      available: true,
      title,
      captureDatabase,
      captureSummary,
      workloadStats,
      workloadFilters,
      topSqlCaptured,
      topSessionsCaptured,
      unreplayable: {
        topSessions: unreplayableSessions,
        topServiceModule: unreplayableServiceModule,
      },
      background: {
        topSessions: backgroundSessions,
        topServiceModule: backgroundServiceModule,
      },
    };
  }

  function classifySeverity(score) {
    if (score >= 85) {
      return "High";
    }
    if (score >= 60) {
      return "Moderate";
    }
    return "Low";
  }

  function addFinding(findings, finding) {
    if (finding && finding.title) {
      findings.push(finding);
    }
  }

  function buildFindings(parsed) {
    const findings = [];
    const replayStatus = parsed.dbReplay.dbHeader["Replay Status"] || parsed.dbReplay.replayInfo.Status?.replay;
    const dbTimeChange = parsed.compare.mainPerformance["Database Time"]?.changePct;
    const cpuChange = parsed.compare.mainPerformance["CPU Time"]?.changePct;
    const divergencePct =
      parsed.compare.divergence.percent ??
      parsed.dbReplay.divergence["SELECTs with Different Number of Rows Fetched"]?.percent;
    const divergenceLevel = parsed.compare.divergence.level || "UNKNOWN";
    const hardParses = parsed.awr.loadProfile["Hard parses (SQL):"];
    const redoSize = parsed.awr.loadProfile["Redo size (bytes):"];
    const blockChanges = parsed.awr.loadProfile["Block changes:"];
    const topConcurrency = parsed.awr.topEvents
      .map((event) => ({
        event: event.secondEvent,
        waitClass: event.secondWaitClass,
        timeSeconds: event.secondTimeSeconds,
        dbTimePct: event.secondDbTimePct,
        waits: event.secondWaits,
      }))
      .filter((event) => /concurrency/i.test(event.waitClass || ""))
      .sort((a, b) => (b.timeSeconds || 0) - (a.timeSeconds || 0));

    if (replayStatus && replayStatus !== "COMPLETED") {
      addFinding(findings, {
        severity: "High",
        title: "Replay did not complete cleanly",
        issue: `Replay status is ${replayStatus}.`,
        cause: "The replay run likely terminated early or encountered runtime failures.",
        recommendation: "Review WRC client alerts, replay logs, and any execution errors before trusting the comparison.",
      });
    }

    if (typeof divergencePct === "number" && divergencePct > 0) {
      addFinding(findings, {
        severity: divergencePct >= 5 || divergenceLevel === "HIGH" ? "High" : "Moderate",
        title: "Replay divergence is present",
        issue: `${divergenceLevel} divergence with ${divergencePct.toFixed(2)}% of calls diverging.`,
        cause:
          parsed.dbReplay.divergence["SELECTs with Different Number of Rows Fetched"]?.count > 0
            ? "The main divergence signal comes from SELECT row-count differences, which often indicates data drift, optimizer plan changes, or environmental differences between capture and replay."
            : "The replay does not fully match the original capture behavior.",
        recommendation:
          "Validate schema statistics, application data parity, initialization parameters, and replay setup before drawing strong performance conclusions.",
      });
    }

    if (typeof dbTimeChange === "number") {
      const dbTimeSeverity =
        dbTimeChange > 10 ? "High" : dbTimeChange > 5 ? "Moderate" : "Low";
      const dbTimeTitle =
        dbTimeChange > 10
          ? "Replay performance regressed"
          : dbTimeChange > 5
            ? "Replay shows slight DB Time increase"
            : dbTimeChange > 0
              ? "Replay shows minor DB Time increase"
            : dbTimeChange < 0
              ? "Replay completed faster overall"
              : "Replay DB Time is unchanged";
      const dbTimeIssue =
        dbTimeChange > 10
          ? `Database Time increased by ${dbTimeChange.toFixed(2)}% in replay.`
          : dbTimeChange > 5
            ? `Database Time increased by ${dbTimeChange.toFixed(2)}% in replay.`
            : dbTimeChange > 0
              ? `Database Time increased slightly by ${dbTimeChange.toFixed(2)}% in replay.`
            : dbTimeChange < 0
              ? `Database Time decreased by ${Math.abs(dbTimeChange).toFixed(2)}% in replay.`
              : "Database Time is unchanged between capture and replay.";
      const dbTimeCause =
        dbTimeChange > 10
          ? "Replay spent more total DB time than capture, indicating reduced throughput or higher contention."
          : dbTimeChange > 5
            ? "Replay spent slightly more DB time than capture, which may indicate minor overhead or normal variance."
            : dbTimeChange > 0
              ? "Replay DB Time is only marginally higher than capture and may be within expected variance."
            : dbTimeChange < 0
              ? "The replay workload consumed less total DB time than capture, suggesting faster completion or lower effective concurrency."
              : "Replay and capture consumed the same total DB time.";
      const dbTimeRecommendation =
        dbTimeChange > 10
          ? "Investigate the replay's top waits, SQL regressions, and hardware saturation before promoting the tested change."
          : dbTimeChange > 5
            ? "Validate whether the moderate DB Time increase is expected variance or linked to specific waits/SQL changes."
            : dbTimeChange > 0
              ? "Track this as a minor variance and correlate with divergence/workload fidelity before escalation."
            : dbTimeChange < 0
              ? "Treat this as a positive signal, but confirm the lower DB time is not being masked by divergence or reduced workload fidelity."
              : "Use other comparability signals (divergence, workload fidelity, waits) to finalize the conclusion.";
      addFinding(findings, {
        severity: dbTimeSeverity,
        title: dbTimeTitle,
        issue: dbTimeIssue,
        cause: dbTimeCause,
        recommendation: dbTimeRecommendation,
      });
    }

    if (typeof cpuChange === "number" && cpuChange > 0) {
      addFinding(findings, {
        severity: cpuChange >= 15 ? "Moderate" : "Low",
        title: "Replay shifted toward CPU-heavy execution",
        issue: `CPU time increased by ${cpuChange.toFixed(1)}% and now represents ${parsed.compare.mainPerformance["CPU Time"]?.replayDbPct ?? "more"}% of replay DB time.`,
        cause: "The target system is spending a larger share of time on CPU, which can happen after I/O bottlenecks are reduced, when SQL plans change, or when parsing and metadata work increase.",
        recommendation: "Review top SQL, execution plans, and CPU headroom to ensure the improvement does not create a new CPU ceiling.",
      });
    }

    if (topConcurrency.length > 0) {
      const top = topConcurrency[0];
      addFinding(findings, {
        severity: top.dbTimePct >= 1 ? "Moderate" : "Low",
        title: "Concurrency waits remain visible in replay",
        issue: `${top.event} accounts for ${top.dbTimePct ?? 0}% of replay DB time with ${top.waits ?? 0} waits.`,
        cause: "Library cache and row cache contention usually point to parse pressure, shared pool churn, metadata contention, or repeated object invalidation.",
        recommendation: "Reduce hard parsing, check shared pool sizing, stabilize SQL reuse, and review dictionary-heavy operations during replay.",
      });
    }

    if (hardParses?.perSecDiffPct && hardParses.perSecDiffPct > 20) {
      addFinding(findings, {
        severity: "Moderate",
        title: "Hard parse rate increased materially",
        issue: `Hard parses per second increased by ${hardParses.perSecDiffPct.toFixed(1)}%.`,
        cause: "Higher hard parsing often increases library cache mutex and metadata contention.",
        recommendation: "Promote bind reuse, reduce SQL text churn, and inspect cursor sharing and invalidation behavior.",
      });
    }

    if ((redoSize?.perSecDiffPct || 0) > 100 || (blockChanges?.perSecDiffPct || 0) > 100) {
      addFinding(findings, {
        severity: "Moderate",
        title: "Replay generated a much heavier write profile",
        issue: `Redo size per second changed by ${redoSize?.perSecDiffPct?.toFixed(1) || "n/a"}% and block changes by ${blockChanges?.perSecDiffPct?.toFixed(1) || "n/a"}%.`,
        cause: "The replay appears to be driving more write activity than capture, which may come from version differences, background tasks, or changed execution plans.",
        recommendation: "Check whether database version changes, maintenance activity, or replay setup introduced additional DML or logging overhead.",
      });
    }

    return findings;
  }

  function buildHeadline(parsed, verdict) {
    const replayName =
      parsed.dbReplay.dbHeader["Replay Name"] ||
      parsed.dbReplay.replayInfo.Name?.replay ||
      `Replay ${parsed.replayId}`;
    const dbTimeChange = parsed.compare.mainPerformance["Database Time"]?.changePct;
    const divergenceLevel = parsed.compare.divergence.level || "UNKNOWN";
    const divergencePct = parsed.compare.divergence.percent;
    const status = parsed.dbReplay.dbHeader["Replay Status"] || "UNKNOWN";

    let summary = `${replayName} finished with status ${status}. `;
    if (typeof dbTimeChange === "number") {
      summary +=
        dbTimeChange <= 0
          ? `Replay DB time improved by ${Math.abs(dbTimeChange).toFixed(1)}% versus capture. `
          : `Replay DB time regressed by ${dbTimeChange.toFixed(1)}% versus capture. `;
    }
    if (typeof divergencePct === "number") {
      if (divergenceLevel !== "UNKNOWN") {
        summary += `Divergence is ${divergencePct.toFixed(2)}% of calls (Oracle label: ${divergenceLevel}).`;
      } else {
        summary += `Divergence is ${divergencePct.toFixed(2)}% of calls.`;
      }
    } else if (divergenceLevel !== "UNKNOWN") {
      summary += `Divergence label is ${divergenceLevel}.`;
    }
    if (verdict?.label) {
      summary += ` Overall verdict: ${verdict.label}.`;
    }
    return summary.trim();
  }

  function parseCoreCount(topology) {
    const match = String(topology || "").match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
    return match ? { sockets: Number(match[1]), cores: Number(match[2]), threads: Number(match[3]) } : null;
  }

  function formatSignedPct(value, digits = 2) {
    if (typeof value !== "number") {
      return "n/a";
    }
    return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
  }

  function formatMetricChange(label, fromValue, toValue, pct) {
    const left = fromValue ?? "n/a";
    const right = toValue ?? "n/a";
    const suffix = typeof pct === "number" ? ` (${formatSignedPct(pct)})` : "";
    return `${label}: ${left} -> ${right}${suffix}`;
  }

  function compareMagnitudePct(left, right) {
    const leftNum = toNumber(left);
    const rightNum = toNumber(right);
    if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum) || leftNum === 0) {
      return null;
    }
    return ((rightNum - leftNum) / leftNum) * 100;
  }

  function parseMemoryInGb(value) {
    const text = String(value || "").trim();
    const number = toNumber(text);
    if (!Number.isFinite(number)) {
      return null;
    }
    if (/\bTB\b/i.test(text)) {
      return number * 1024;
    }
    if (/\bGB\b/i.test(text) || /\bG\b/i.test(text)) {
      return number;
    }
    if (/\bMB\b/i.test(text) || /\bM\b/i.test(text)) {
      return number / 1024;
    }
    if (/\bKB\b/i.test(text) || /\bK\b/i.test(text)) {
      return number / (1024 * 1024);
    }
    if (number > 1024 * 1024 * 32) {
      return number / (1024 * 1024 * 1024);
    }
    if (number > 1024 * 32) {
      return number / (1024 * 1024);
    }
    return number;
  }

  function normalizeStatus(status) {
    const value = String(status || "").trim().toUpperCase();
    if (!value) {
      return "UNKNOWN";
    }
    if (value.includes("ABORT")) {
      return "ABORTED";
    }
    if (value.includes("FAIL")) {
      return "FAILED";
    }
    if (value.includes("COMPLETE")) {
      return "COMPLETED";
    }
    return value;
  }

  function findFieldValue(obj, patterns) {
    const entries = Object.entries(obj || {});
    const match = entries.find(([key]) =>
      patterns.every((pattern) => key.toLowerCase().includes(pattern.toLowerCase()))
    );
    return match ? match[1] : "";
  }

  function findMetricEntry(obj, patterns) {
    const entries = Object.entries(obj || {});
    const match = entries.find(([key]) =>
      patterns.every((pattern) => key.toLowerCase().includes(pattern.toLowerCase()))
    );
    return match ? match[1] : null;
  }

  function buildMeaningfulParamChanges(parsed) {
    const sections = [
      { label: "Important parameter", values: parsed.compare.importantParams },
      { label: "Optimizer parameter", values: parsed.compare.optimizerParams },
      { label: "Memory parameter", values: parsed.compare.memoryParams },
      { label: "Underscore parameter", values: parsed.compare.underscoreParams },
    ];

    const changes = [];
    sections.forEach((section) => {
      Object.entries(section.values || {}).forEach(([name, pair]) => {
        const capture = String(pair.capture || "").trim();
        const replay = String(pair.replay || "").trim();
        if (!capture && !replay) {
          return;
        }
        if (capture === replay) {
          return;
        }
        if (/^(no rows selected|none)$/i.test(`${capture} ${replay}`.trim())) {
          return;
        }
        changes.push({
          section: section.label,
          name,
          capture,
          replay,
          summary: `${section.label} ${name} changed from ${capture || "blank"} to ${replay || "blank"}.`,
        });
      });
    });

    return changes.slice(0, 8);
  }

  const NON_CORE_USER_PATTERNS = [
    /^SYS$/i,
    /^SYSTEM$/i,
    /^SYSMAN$/i,
    /^DBSNMP$/i,
    /^SYS\$/i,
  ];
  const NON_CORE_PROGRAM_PATTERNS = [
    /oracle@.*\((?:DBW|LGWR|RVWR|SMON|PMON|MMON|MMNL|LREG|RECO|ARC\d*|CJQ0|J\d{3}|VKTM|DIAG|DBRM|GEN0|LMS\d*|LMD\d*)\)/i,
    /emagent|dbsnmp|rman|dataguard|dgmgrl/i,
  ];
  const NON_CORE_SERVICE_PATTERNS = [/SYS\$BACKGROUND/i, /^SYS\$USERS$/i];
  const NON_CORE_MODULE_PATTERNS = [/DBMS_SCHEDULER/i, /\bOEM\b/i, /\bEM\b/i, /MONITOR/i];

  function matchesAnyPattern(value, patterns) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(text));
  }

  function isNonCoreWorkloadIdentity({ user, program, service, module }) {
    return (
      matchesAnyPattern(user, NON_CORE_USER_PATTERNS) ||
      matchesAnyPattern(program, NON_CORE_PROGRAM_PATTERNS) ||
      matchesAnyPattern(service, NON_CORE_SERVICE_PATTERNS) ||
      matchesAnyPattern(module, NON_CORE_MODULE_PATTERNS)
    );
  }

  function getCaptureStatValue(capture, metricName) {
    const entry = Object.entries(capture?.workloadStats || {}).find(([name]) =>
      name.toLowerCase().includes(metricName.toLowerCase())
    );
    return entry ? entry[1] : null;
  }

  function classifyDivergence(dPct) {
    if (typeof dPct !== "number") {
      return "Insufficient data";
    }
    if (dPct > 20) {
      return "High";
    }
    if (dPct >= 5) {
      return "Moderate";
    }
    return "Good";
  }

  function summarizeCaptureValidity(capture) {
    if (!capture?.available) {
      return {
        status: "Unavailable",
        representative: "Unknown",
        reason: "Database Capture Report is missing.",
        evidence: [],
      };
    }

    const captureStatus = String(capture.captureDatabase?.Status || "").toUpperCase();
    const capturedCalls = getCaptureStatValue(capture, "User calls captured")?.value;
    const capturedErrors = getCaptureStatValue(capture, "User calls captured with Errors")?.value;
    const capturedSessions = (capture.topSessionsCaptured || []).slice(0, 12);
    const coreSessions = capturedSessions.filter(
      (row) => !isNonCoreWorkloadIdentity({ user: row.user, program: row.program })
    );
    const representative =
      captureStatus === "COMPLETED" &&
      (capturedCalls || 0) > 0 &&
      coreSessions.length > 0;

    const evidence = [];
    if (captureStatus) {
      evidence.push(`Capture status: ${captureStatus}.`);
    }
    if (typeof capturedCalls === "number") {
      evidence.push(`User calls captured: ${capturedCalls.toLocaleString()}.`);
    }
    if (typeof capturedErrors === "number") {
      evidence.push(`Captured calls with errors: ${capturedErrors.toLocaleString()}.`);
    }
    if ((capture.workloadFilters || []).length) {
      const filters = capture.workloadFilters
        .slice(0, 3)
        .map((f) => `${f.type || "?"} ${f.attribute || "?"}=${f.value || "?"}`)
        .join("; ");
      evidence.push(`Capture filters: ${filters}.`);
    }

    return {
      status: captureStatus || "UNKNOWN",
      representative: representative ? "Likely representative" : "Potentially unrepresentative",
      reason: representative
        ? "Capture includes meaningful application sessions and completed cleanly."
        : "Capture appears limited, background-heavy, or did not complete cleanly.",
      evidence,
    };
  }

  function buildFunctionalAssessmentSection(parsed) {
    const capture = parsed.capture || {};
    const divergencePct =
      parsed.compare.divergence.percent ??
      parsed.dbReplay.divergence["SELECTs with Different Number of Rows Fetched"]?.percent;
    const divergenceLabel = classifyDivergence(divergencePct);
    const captureValidity = summarizeCaptureValidity(capture);
    const replayStatus = normalizeStatus(
      parsed.dbReplay.dbHeader["Replay Status"] || parsed.dbReplay.replayInfo.Status?.replay
    );

    const unreplayableSessions = (capture.unreplayable?.topSessions || []).slice(0, 20);
    const unreplayableServiceModule = (capture.unreplayable?.topServiceModule || []).slice(0, 20);
    const backgroundSessions = (capture.background?.topSessions || []).slice(0, 20);

    const nonCoreUnreplayableCount =
      unreplayableSessions.filter((row) =>
        isNonCoreWorkloadIdentity({ user: row.user, program: row.program })
      ).length +
      unreplayableServiceModule.filter((row) =>
        isNonCoreWorkloadIdentity({ service: row.service, module: row.module })
      ).length;
    const totalUnreplayableCount = unreplayableSessions.length + unreplayableServiceModule.length;
    const unreplayableMostlyNonCore =
      totalUnreplayableCount > 0 && nonCoreUnreplayableCount / totalUnreplayableCount >= 0.6;
    const errorSourceSummary =
      totalUnreplayableCount === 0
        ? "No material unreplayable-call sources detected in capture report."
        : unreplayableMostlyNonCore
          ? "Unreplayable-call sources are mostly background/non-core workloads."
          : "Unreplayable-call sources include potentially core workload identities.";

    const localizedDivergence =
      divergenceLabel === "Good" ||
      (divergenceLabel === "Moderate" && (unreplayableMostlyNonCore || totalUnreplayableCount <= 2));

    const status =
      replayStatus !== "COMPLETED" || divergenceLabel === "High"
        ? "Invalid"
        : divergenceLabel === "Moderate" && !localizedDivergence
          ? "Degraded"
          : "Usable";

    const highlights = [];
    if (!capture?.available) {
      highlights.push("Capture report is not available, so workload representativeness cannot be verified.");
    } else {
      highlights.push(`Capture validity: ${captureValidity.representative}.`);
      if (unreplayableMostlyNonCore) {
        highlights.push("Unreplayable activity appears concentrated in background or non-core workloads.");
      } else if (totalUnreplayableCount > 0) {
        highlights.push("Unreplayable activity includes potentially core workloads and needs review.");
      }
      if (backgroundSessions.length) {
        const topBackground = backgroundSessions[0];
        highlights.push(
          `Background activity is visible (${topBackground.user || "unknown user"} / ${topBackground.program || "unknown program"}).`
        );
      }
    }
    if (typeof divergencePct === "number") {
      highlights.push(`Replay divergence is ${divergencePct.toFixed(2)}% (${divergenceLabel}).`);
    }
    highlights.push(errorSourceSummary);

    const actions = [];
    if (status === "Invalid") {
      actions.push("Treat this replay as invalid and rerun after fixing capture/replay comparability issues.");
    } else if (status === "Degraded") {
      actions.push("Replay is usable with caveats; isolate failing schemas/users/jobs before final sign-off.");
    } else {
      actions.push("Functional fidelity is acceptable for decision-making, with noted caveats if any.");
    }
    if (!capture?.available) {
      actions.push("Include Database Capture Report in future runs to validate captured workload quality.");
    }

    return {
      status,
      divergenceLabel,
      divergencePct,
      localizedDivergence: localizedDivergence ? "Yes" : "No",
      errorSourceSummary,
      captureValidity,
      highlights,
      actions,
    };
  }

  function buildPerformanceAssessmentSection(parsed, functionalAssessment) {
    const compare = parsed.compare || {};
    const dbTime = compare.mainPerformance?.["Database Time"];
    const cpuTime = compare.mainPerformance?.["CPU Time"];
    const userIoTime = compare.mainPerformance?.["User I/O Wait Time"];
    const topAddm = Object.entries(compare.addm || {})
      .map(([name, value]) => ({
        name,
        replayPct: value.replayPct,
        captureImpactSec: value.captureImpactSec,
        replayImpactSec: value.replayImpactSec,
      }))
      .filter((row) => typeof row.replayPct === "number")
      .sort((a, b) => (b.replayPct || 0) - (a.replayPct || 0))
      .slice(0, 5);

    const topSqlCapture = (compare.topSqlByDbTime?.capture || []).slice(0, 3);
    const topSqlReplay = (compare.topSqlByDbTime?.replay || []).slice(0, 3);

    let workloadClass = "Mixed";
    const replayCpuPct = cpuTime?.replayDbPct;
    const dominantAddm = topAddm[0];
    const dominantAddmName = String(dominantAddm?.name || "");
    if (typeof replayCpuPct === "number") {
      workloadClass = replayCpuPct >= 70 ? "CPU-bound" : replayCpuPct <= 30 ? "Wait/I/O-bound" : "Mixed";
    }
    if (/user i\/o|system i\/o/i.test(dominantAddmName)) {
      workloadClass = "I/O-bound";
    } else if (/commit|log file sync|rollback/i.test(dominantAddmName)) {
      workloadClass = "Commit/Wait-bound";
    }

    const dbTimeVerdict =
      typeof dbTime?.changePct !== "number"
        ? "Insufficient data"
        : dbTime.changePct <= -10
          ? "Improved"
          : dbTime.changePct >= 10
            ? "Regressed"
            : "Similar";
    const status =
      functionalAssessment.status === "Invalid"
        ? "Not reliable"
        : dbTimeVerdict === "Regressed"
          ? "Degraded"
          : dbTimeVerdict === "Improved"
            ? "Good"
            : "Mixed";

    const bottlenecks = [];
    topAddm.slice(0, 3).forEach((row) => {
      bottlenecks.push(`${row.name} (${formatPercentValue(row.replayPct)}% replay impact share)`);
    });

    const highlights = [
      formatMetricChange("DB Time", dbTime?.captureTotal, dbTime?.replayTotal, dbTime?.changePct),
      formatMetricChange("CPU Time", cpuTime?.captureTotal, cpuTime?.replayTotal, cpuTime?.changePct),
    ];
    if (/i\/o-bound|wait\/i\/o-bound/i.test(workloadClass) && userIoTime) {
      highlights.push(
        formatMetricChange(
          "User I/O Wait Time",
          userIoTime.captureTotal,
          userIoTime.replayTotal,
          userIoTime.changePct
        )
      );
    } else if (/commit\/wait-bound/i.test(workloadClass) && dominantAddmName) {
      highlights.push(
        `ADDM dominant finding (${dominantAddmName}) impact: ${formatNumberValue(
          dominantAddm?.captureImpactSec
        )} sec -> ${formatNumberValue(dominantAddm?.replayImpactSec)} sec.`
      );
    }
    highlights.push(`Dominant execution mode: ${workloadClass}.`);

    const actions = [
      "Prioritize DB Time drivers first; do not use elapsed wall-clock time alone.",
      topAddm.length
        ? "Use Compare Period ADDM deltas to target highest-impact waits before broad tuning."
        : "ADDM comparison data is limited; validate with additional diagnostics.",
      topSqlReplay.length
        ? `Review top replay SQL by DB Time (${topSqlReplay.map((row) => row.sqlId).filter(Boolean).join(", ") || "n/a"}).`
        : "Top SQL by DB Time is unavailable in Compare Period report.",
    ];

    return {
      status,
      dbTimeVerdict,
      workloadClass,
      highlights,
      bottlenecks,
      topSql: {
        capture: topSqlCapture,
        replay: topSqlReplay,
      },
      dominantAddmName,
      dominantAddmCaptureImpactSec: dominantAddm?.captureImpactSec ?? null,
      dominantAddmReplayImpactSec: dominantAddm?.replayImpactSec ?? null,
      actions,
    };
  }

  function verdictLabelText(text) {
    if (/Unsuccessful/i.test(text)) {
      return "bad";
    }
    if (/Successful/i.test(text)) {
      return "good";
    }
    return "mixed";
  }

  function buildVerdict(parsed, projectSections) {
    if (projectSections?.bottomLineIntro) {
      const reasons = [];
      if (projectSections.testOutcome?.reason) {
        reasons.push(projectSections.testOutcome.reason);
      }
      if (projectSections.testObjective?.reason && projectSections.testObjective.type !== "Unknown") {
        reasons.push(projectSections.testObjective.reason);
      }
      if (projectSections.performanceAssessment?.dbTime) {
        reasons.push(`Performance assessment for DB Time: ${projectSections.performanceAssessment.dbTime}.`);
      }
      if (projectSections.performanceAssessment?.divergence) {
        reasons.push(`Divergence assessment: ${projectSections.performanceAssessment.divergence}.`);
      }

      if (projectSections.bottomLineIntro === "PASS") {
        return { label: "good", tone: "positive", icon: "PASS", reasons };
      }
      if (projectSections.bottomLineIntro === "FAIL") {
        return { label: "bad", tone: "negative", icon: "FAIL", reasons };
      }
      return { label: "mixed", tone: "caution", icon: "WARN", reasons };
    }

    const dbTimeChange = parsed.compare.mainPerformance["Database Time"]?.changePct;
    const divergencePct = parsed.compare.divergence.percent ?? 0;
    const divergenceLevel = String(parsed.compare.divergence.level || "").toUpperCase();
    const throttling = parsed.compare.addm["Resource Manager CPU Throttling"]?.replayPct ?? 0;
    const replayCoreCount = parseCoreCount(parsed.compare.cpuUsage.Replay?.topology)?.cores;
    const captureCoreCount = parseCoreCount(parsed.compare.cpuUsage.Capture?.topology)?.cores;
    const cpuMismatch = replayCoreCount && captureCoreCount && replayCoreCount < captureCoreCount;
    const reasons = [];

    const divergenceHigh = divergenceLevel === "HIGH" || divergencePct >= 10;
    const comparabilityWeak =
      divergenceHigh || divergencePct >= 3 || throttling >= 10 || cpuMismatch;

    if (
      typeof dbTimeChange === "number" &&
      dbTimeChange <= -10 &&
      throttling < 10 &&
      divergencePct < 3 &&
      divergenceLevel !== "HIGH" &&
      !cpuMismatch
    ) {
      reasons.push("Database Time improved materially.");
      reasons.push("No major CPU throttling signal was detected.");
      reasons.push("Divergence remained low.");
      if (divergenceLevel && divergenceLevel !== "UNKNOWN") {
        reasons.push(`Oracle divergence label is ${divergenceLevel}.`);
      }
      reasons.push("Replay CPU capacity was not below capture.");
      return { label: "good", tone: "positive", icon: "PASS", reasons };
    }
    if (
      (typeof dbTimeChange === "number" && dbTimeChange >= 20) ||
      ((typeof dbTimeChange === "number" && dbTimeChange >= 10) && comparabilityWeak) ||
      divergenceHigh
    ) {
      reasons.push("Database Time regressed materially in replay.");
      if (cpuMismatch) {
        reasons.push("Replay environment has fewer CPU cores than capture.");
      }
      if (throttling >= 10) {
        reasons.push("Resource Manager CPU throttling is significant.");
      }
      if (divergencePct >= 3) {
        reasons.push("Replay divergence reduces comparability.");
      }
      if (divergenceLevel === "HIGH") {
        reasons.push("Oracle divergence level is HIGH.");
      }
      return { label: "bad", tone: "negative", icon: "FAIL", reasons };
    }
    if (typeof dbTimeChange === "number") {
      reasons.push(
        dbTimeChange < 0
          ? "Database Time improved, but not enough to clear all review concerns."
          : "Database Time did not improve enough to qualify as a clean success."
      );
    }
    if (cpuMismatch) {
      reasons.push("Replay environment has fewer CPU cores than capture.");
    }
    if (throttling >= 10) {
      reasons.push("Resource Manager CPU throttling is present.");
    }
    if (divergencePct > 0) {
      reasons.push("Replay divergence is present.");
    }
    if (divergenceLevel && divergenceLevel !== "UNKNOWN") {
      reasons.push(`Oracle divergence level is ${divergenceLevel}.`);
    }
    return { label: "mixed", tone: "caution", icon: "WARN", reasons };
  }

  function buildProjectStyleSections(parsed, options = {}) {
    const findings = [];
    const causes = [];
    const actions = [];
    const includeAwrDeepDive = Boolean(options.includeAwrDeepDive);

    const status = normalizeStatus(
      parsed.dbReplay.dbHeader["Replay Status"] || parsed.dbReplay.replayInfo.Status?.replay
    );
    const dbTime = parsed.compare.mainPerformance["Database Time"];
    const userCalls =
      parsed.compare.mainPerformance["User Calls"] ||
      findMetricEntry(parsed.dbReplay.replayStats, ["user", "calls"]);
    const finishedSessions =
      parsed.dbReplay.replayStats["Finished Replay Sessions"] ||
      findMetricEntry(parsed.dbReplay.replayStats, ["finished", "sessions"]);
    const divergenceLevel = parsed.compare.divergence.level || "UNKNOWN";
    const divergencePct = parsed.compare.divergence.percent;
    const selectRowFetchDiff = parsed.dbReplay.divergence["SELECTs with Different Number of Rows Fetched"];
    const replayVersion =
      parsed.dbReplay.replayInfo["Database Version"]?.replay ||
      parsed.compare.databaseInfo?.Version?.replay ||
      parsed.dbReplay.dbHeader["Release"];
    const captureVersion =
      parsed.dbReplay.replayInfo["Database Version"]?.capture ||
      parsed.compare.databaseInfo?.Version?.capture;
    const replayPlatform = parsed.compare.databaseInfo?.Platform?.replay || "";
    const capturePlatform = parsed.compare.databaseInfo?.Platform?.capture || "";
    const captureReport = parsed.capture || { available: false };
    const isUpgradeTest =
      Boolean(replayVersion && captureVersion) && replayVersion !== captureVersion;
    const captureCpu = parsed.compare.cpuUsage.Capture || {};
    const replayCpu = parsed.compare.cpuUsage.Replay || {};
    const captureCores = parseCoreCount(captureCpu.topology)?.cores;
    const replayCores = parseCoreCount(replayCpu.topology)?.cores;
    const topReplayWait = parsed.awr.topEvents.find((event) => event.secondEvent && event.secondEvent !== "-");
    const cpuThrottling = parsed.compare.addm["Resource Manager CPU Throttling"];
    const hardParseLiteral = parsed.compare.addm["Hard Parse Due to Literal Usage"];
    const parseTime = parsed.awr.timeModel["parse time elapsed"];
    const totalParses = parsed.awr.totals;
    const meaningfulParamChanges = buildMeaningfulParamChanges(parsed);

    const captureInstance = parsed.compare.captureInstance || {};
    const replayInstance = parsed.compare.replayInstance || {};
    const captureMemoryText = findFieldValue(captureInstance, ["physical", "memory"]);
    const replayMemoryText = findFieldValue(replayInstance, ["physical", "memory"]);
    const captureMemoryGb = parseMemoryInGb(captureMemoryText);
    const replayMemoryGb = parseMemoryInGb(replayMemoryText);
    const memoryReduced =
      Number.isFinite(captureMemoryGb) &&
      Number.isFinite(replayMemoryGb) &&
      replayMemoryGb < captureMemoryGb;

    const userCallsCapture = userCalls?.captureTotal ?? userCalls?.capture;
    const userCallsReplay = userCalls?.replayTotal ?? userCalls?.replay;
    const userCallsDiffPct = compareMagnitudePct(userCallsCapture, userCallsReplay);
    const userCallsSimilar = typeof userCallsDiffPct === "number" ? Math.abs(userCallsDiffPct) <= 10 : null;
    const finishedSessionsDiffPct = compareMagnitudePct(finishedSessions?.capture, finishedSessions?.replay);
    const sessionsStable =
      typeof finishedSessionsDiffPct === "number" ? finishedSessionsDiffPct >= -5 : null;

    let divergenceAssessment = classifyDivergence(divergencePct);

    let dbTimeAssessment = "Insufficient data";
    if (typeof dbTime?.changePct === "number") {
      if (dbTime.changePct <= -5) {
        dbTimeAssessment = "Improved";
      } else if (dbTime.changePct >= 5) {
        dbTimeAssessment = "Degraded";
      } else {
        dbTimeAssessment = "Similar";
      }
    }

    let overallPerformance = "Neutral";
    if (status !== "COMPLETED") {
      overallPerformance = "Poor";
    } else if (
      typeof dbTime?.changePct === "number" &&
      dbTime.changePct <= -10 &&
      divergenceAssessment === "Good" &&
      userCallsSimilar !== false &&
      sessionsStable !== false
    ) {
      overallPerformance = "Good";
    } else if (
      (typeof dbTime?.changePct === "number" && dbTime.changePct >= 15) ||
      divergenceAssessment === "High" ||
      sessionsStable === false
    ) {
      overallPerformance = "Poor";
    }

    const objectiveReasons = [];
    let objective = "Unknown";
    if (isUpgradeTest) {
      objective = "Version upgrade";
      objectiveReasons.push(`Capture ran on ${captureVersion || "unknown version"} and replay ran on ${replayVersion || "unknown version"}.`);
    } else if (meaningfulParamChanges.length > 0) {
      objective = "Parameter change";
      objectiveReasons.push(`${meaningfulParamChanges.length} meaningful parameter difference(s) were detected between capture and replay.`);
    } else if (
      (captureCores && replayCores && captureCores !== replayCores) ||
      (Number.isFinite(captureMemoryGb) && Number.isFinite(replayMemoryGb) && Math.abs(replayMemoryGb - captureMemoryGb) > 1)
    ) {
      objective = "Hardware change";
      objectiveReasons.push("CPU or memory configuration differs between the capture and replay environments.");
    } else if (capturePlatform && replayPlatform && capturePlatform !== replayPlatform) {
      objective = "Hardware change";
      objectiveReasons.push(`Platform differs between environments: ${capturePlatform} vs ${replayPlatform}.`);
    } else {
      objectiveReasons.push("No major version, parameter, or hardware change was identified from the available reports.");
    }

    const validityIssues = [];
    if (status !== "COMPLETED") {
      validityIssues.push(`Replay status is ${status}, so the workload did not complete successfully.`);
    }
    let divergenceLabelNote = "";
    if (typeof divergencePct === "number") {
      if (divergencePct > 20) {
        validityIssues.push(
          `Replay divergence is ${divergencePct.toFixed(2)}%, which is high enough to make the replay unreliable.`
        );
      } else if (divergenceLevel === "HIGH" && divergencePct < 5) {
        divergenceLabelNote = `Oracle label is HIGH, but measured divergence is ${divergencePct.toFixed(2)}% (low).`;
      }
    } else if (divergenceLevel === "HIGH") {
      validityIssues.push(
        "Oracle divergence level is HIGH, and measured divergence percentage is unavailable, so comparability cannot be confirmed."
      );
    }
    if (userCallsSimilar === false) {
      validityIssues.push(`User Calls differ materially between capture and replay (${formatSignedPct(userCallsDiffPct, 1)}).`);
    }
    if (sessionsStable === false) {
      validityIssues.push("Finished Replay Sessions dropped materially, indicating instability during replay.");
    }

    const isValid = validityIssues.length === 0;
    const validityReason = isValid
      ? [
          "Replay completed and the core comparability checks do not show a major fidelity failure.",
          divergenceLabelNote,
        ]
          .filter(Boolean)
          .join(" ")
      : validityIssues.join(" ");

    if (status !== "COMPLETED") {
      findings.push({
        title: "Replay outcome",
        text: `Replay status is ${status}, so this run cannot be treated as a successful validation.`,
      });
      causes.push("Replay failed or was aborted before the workload completed cleanly.");
      actions.push("Review replay execution logs and WRC output before using this run for performance conclusions.");
    } else {
      findings.push({
        title: "Replay outcome",
        text: "Replay completed successfully.",
      });
    }

    const captureValidity = summarizeCaptureValidity(captureReport);
    if (!captureReport.available) {
      findings.push({
        title: "Capture workload quality",
        text: "Database Capture Report is missing, so captured workload representativeness could not be verified.",
      });
      actions.push("Include the Database Capture Report in this replay package for full functional validation.");
    } else {
      findings.push({
        title: "Capture workload quality",
        text: `${captureValidity.representative}. ${captureValidity.reason}`,
      });
      captureValidity.evidence.slice(0, 3).forEach((line) => {
        findings.push({
          title: "Capture evidence",
          text: line,
        });
      });
      if (captureValidity.representative !== "Likely representative") {
        causes.push("Captured workload may be narrow, background-heavy, or insufficiently representative.");
        actions.push("Re-capture workload with representative application sessions and confirm filters before replay.");
      }
    }

    if (typeof dbTime?.changePct === "number") {
      findings.push({
        title: "DB Time",
        text: `DB Time is ${dbTimeAssessment.toLowerCase()} in replay (${dbTime.captureTotal} -> ${dbTime.replayTotal}, ${formatSignedPct(dbTime.changePct, 1)}).`,
      });
    } else {
      findings.push({
        title: "DB Time",
        text: "Insufficient data to compare capture and replay DB Time.",
      });
    }

    if (typeof userCallsDiffPct === "number") {
      findings.push({
        title: "User Calls",
        text: userCallsSimilar
          ? `User Calls are similar between capture and replay (${userCallsCapture || "n/a"} -> ${userCallsReplay || "n/a"}, ${formatSignedPct(userCallsDiffPct, 1)} difference).`
          : `User Calls differ materially between capture and replay (${userCallsCapture || "n/a"} -> ${userCallsReplay || "n/a"}, ${formatSignedPct(userCallsDiffPct, 1)} difference).`,
      });
      if (!userCallsSimilar) {
        causes.push("Replay workload volume differs from capture, reducing comparability.");
        actions.push("Validate workload capture fidelity and ensure the same workload scope was replayed.");
      }
    } else {
      findings.push({
        title: "User Calls",
        text: "Insufficient data to assess whether User Calls were comparable.",
      });
    }

    if (finishedSessions?.capture || finishedSessions?.replay) {
      findings.push({
        title: "Finished Replay Sessions",
        text:
          sessionsStable === false
            ? `Finished Replay Sessions dropped from ${finishedSessions.capture || "n/a"} to ${finishedSessions.replay || "n/a"}, which suggests replay instability.`
            : `Finished Replay Sessions stayed broadly consistent (${finishedSessions.capture || "n/a"} -> ${finishedSessions.replay || "n/a"}).`,
      });
      if (sessionsStable === false) {
        causes.push("Some replay sessions did not complete cleanly.");
        actions.push("Review session-level replay failures and dropped sessions before trusting the performance comparison.");
      }
    } else {
      findings.push({
        title: "Finished Replay Sessions",
        text: "Insufficient data to assess session completion fidelity.",
      });
    }

    if (typeof divergencePct === "number") {
      const oracleTag =
        divergenceLevel && divergenceLevel !== "UNKNOWN"
          ? ` (Oracle label: ${divergenceLevel})`
          : "";
      const functionalSnapshot = buildFunctionalAssessmentSection(parsed);
      findings.push({
        title: "Replay divergence",
        text:
          divergenceAssessment === "Good"
            ? `Replay divergence is ${divergencePct.toFixed(2)}%, which is within the good range for comparability${oracleTag}.`
            : divergenceAssessment === "Moderate"
              ? `Replay divergence is ${divergencePct.toFixed(2)}%, which is moderate and ${functionalSnapshot.localizedDivergence === "Yes" ? "appears localized" : "requires careful review"}${oracleTag}.`
              : `Replay divergence is ${divergencePct.toFixed(2)}%, which is problematic for replay reliability${oracleTag}.`,
      });
      if (divergenceAssessment !== "Good") {
        causes.push("Divergence indicates replay behavior differs from the original capture.");
        actions.push("Review divergence details and align data state, statistics, and environment settings before re-running.");
      }
      if (selectRowFetchDiff?.count) {
        findings.push({
          title: "SELECT result differences",
          text: `${selectRowFetchDiff.count} SELECT calls fetched a different number of rows during replay.`,
        });
      }
    } else {
      findings.push({
        title: "Replay divergence",
        text: "Insufficient data to assess replay divergence.",
      });
    }

    if (capturePlatform || replayPlatform) {
      if (capturePlatform && replayPlatform && capturePlatform !== replayPlatform) {
        findings.push({
          title: "Platform",
          text: `Platform differs between environments: ${capturePlatform} -> ${replayPlatform}.`,
        });
        causes.push("Platform differences may influence CPU scheduling, I/O behavior, or optimizer behavior.");
      } else {
        findings.push({
          title: "Platform",
          text: `Platform appears unchanged (${replayPlatform || capturePlatform}).`,
        });
      }
    }

    if (captureCores && replayCores) {
      findings.push({
        title: "CPU configuration",
        text:
          replayCores < captureCores
            ? `CPU cores decreased from ${captureCores} to ${replayCores}, which can degrade performance.`
            : replayCores > captureCores
              ? `CPU cores increased from ${captureCores} to ${replayCores}, which can make the result look better than capture.`
              : `CPU core count is the same in capture and replay (${captureCores}).`,
      });
      if (replayCores < captureCores) {
        causes.push("Replay environment is CPU-downgraded versus capture.");
        actions.push("Re-run with CPU parity if the goal is an apples-to-apples validation.");
      }
    }

    if (captureMemoryText || replayMemoryText) {
      findings.push({
        title: "Memory configuration",
        text:
          memoryReduced
            ? `Physical memory decreased from ${captureMemoryText || "n/a"} to ${replayMemoryText || "n/a"}.`
            : `Physical memory appears comparable (${captureMemoryText || "n/a"} -> ${replayMemoryText || "n/a"}).`,
      });
      if (memoryReduced) {
        causes.push("Replay environment has less physical memory than capture.");
        actions.push("Validate replay on equivalent memory capacity if this is not an intentional hardware-change test.");
      }
    }

    if (meaningfulParamChanges.length > 0) {
      meaningfulParamChanges.slice(0, 4).forEach((change) => {
        findings.push({
          title: "Parameter change",
          text: change.summary,
        });
      });
      causes.push("Configuration differences between environments may be contributing to the performance change.");
      actions.push("Review meaningful parameter changes and confirm they are intentional for this test objective.");
    }

    if ((cpuThrottling?.replayPct || 0) > 0 || /resmgr:cpu quantum/i.test(topReplayWait?.secondEvent || "")) {
      findings.push({
        title: "CPU throttling",
        text: `${topReplayWait?.secondEvent || "resmgr:cpu quantum"} indicates replay is seeing CPU throttling or scheduling pressure.`,
      });
      causes.push("Resource Manager or CPU pressure is constraining replay throughput.");
      actions.push("Check Resource Manager settings and host CPU headroom before the next replay.");
    }

    if ((hardParseLiteral?.replayPct || 0) > (hardParseLiteral?.capturePct || 0) || (parseTime?.secondPctDbTime || 0) > (parseTime?.firstPctDbTime || 0)) {
      findings.push({
        title: "Parsing overhead",
        text: [
          parseTime ? `Parse time share rose from ${parseTime.firstPctDbTime}% to ${parseTime.secondPctDbTime}%.` : "",
          totalParses.totalParsesFirst && totalParses.totalParsesSecond
            ? `Total parses increased from ${totalParses.totalParsesFirst.toLocaleString()} to ${totalParses.totalParsesSecond.toLocaleString()}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      causes.push("Higher parse pressure or literal SQL usage is adding overhead during replay.");
      actions.push("Review bind usage and cursor reuse if parsing overhead is not expected.");
    }

    const executiveParts = [];
    executiveParts.push(
      status === "COMPLETED"
        ? "The replay completed successfully."
        : `The replay ${status.toLowerCase()}, so the run does not represent a successful validation.`
    );
    if (objective === "Version upgrade") {
      executiveParts.push(`This was an upgrade test from ${captureVersion || "unknown version"} to ${replayVersion || "unknown version"}.`);
    } else if (objective === "Parameter change") {
      executiveParts.push("This appears to be a parameter-change validation rather than a version change.");
    } else if (objective === "Hardware change") {
      executiveParts.push("This appears to be a hardware or environment-change validation.");
    } else {
      executiveParts.push("The specific test objective is not explicit from the available reports.");
    }
    if (typeof dbTime?.changePct === "number") {
      executiveParts.push(
        dbTime.changePct < 0
          ? `Overall DB Time is lower in replay, which is the primary positive performance signal (${formatSignedPct(dbTime.changePct, 1)}).`
          : dbTime.changePct > 0
            ? `Overall DB Time is higher in replay, which is the main sign of degraded performance (${formatSignedPct(dbTime.changePct, 1)}).`
            : "Overall DB Time is effectively unchanged between capture and replay."
      );
    } else {
      executiveParts.push("DB Time comparison has insufficient data.");
    }
    if (captureCores && replayCores && replayCores < captureCores) {
      executiveParts.push(`Replay has fewer CPU cores than capture (${captureCores} vs ${replayCores}), which weakens comparability and can explain slower replay.`);
    }
    if (memoryReduced) {
      executiveParts.push("Replay also has lower physical memory than capture, which can further distort the comparison.");
    }
    if (typeof divergencePct === "number") {
      executiveParts.push(
        divergencePct < 5
          ? `Replay divergence is ${divergencePct.toFixed(2)}%, which supports a broadly reliable replay.`
          : `Replay divergence is ${divergencePct.toFixed(2)}%, which reduces confidence in the replay fidelity.`
      );
    }
    executiveParts.push(
      captureReport.available
        ? `Capture workload validation is ${captureValidity.representative.toLowerCase()}.`
        : "Capture workload validation is unavailable because Database Capture Report is missing."
    );

    const functionalAssessment = buildFunctionalAssessmentSection(parsed);
    const perfSection = buildPerformanceAssessmentSection(parsed, functionalAssessment);
    let replayVerdict = "degraded";
    if (functionalAssessment.status === "Invalid") {
      replayVerdict = "invalid";
    } else if (perfSection.status === "Good" && functionalAssessment.status === "Usable") {
      replayVerdict = "good";
    }

    let bottomLineIntro = "WARN";
    let bottomLineDetail = "⚠️ Degraded or mixed test result";
    if (replayVerdict === "invalid") {
      bottomLineIntro = "FAIL";
      bottomLineDetail = "❌ Invalid replay result";
    } else if (replayVerdict === "good") {
      bottomLineIntro = "PASS";
      bottomLineDetail = "✅ Good replay result";
    }

    const overallExecutiveSummary = {
      verdict: replayVerdict,
      keyMetrics: [
        formatMetricChange("DB Time", dbTime?.captureTotal, dbTime?.replayTotal, dbTime?.changePct),
        formatMetricChange(
          "Replay Divergence",
          "Capture baseline",
          typeof divergencePct === "number" ? `${divergencePct.toFixed(2)}%` : "n/a",
          null
        ),
      ],
      mainReasons: [
        `Functional assessment: ${functionalAssessment.status}.`,
        `Performance assessment: ${perfSection.status} (${perfSection.workloadClass}).`,
      ],
    };

    return {
      executiveParagraph: executiveParts.join(" "),
      findings,
      problems: findings.map((item) => `${item.title}: ${item.text}`),
      causes: causes.length ? causes : ["Insufficient data"],
      actions: actions.length ? actions : ["Insufficient data"],
      bottomLineIntro,
      bottomLineDetail,
      testOutcome: {
        status,
        valid: isValid ? "Yes" : "No",
        reason: validityReason,
      },
      testObjective: {
        type: objective,
        reason: objectiveReasons.join(" "),
      },
      performanceAssessment: {
        overall: perfSection.status,
        dbTime: perfSection.dbTimeVerdict,
        userCalls:
          userCallsSimilar == null ? "Insufficient data" : userCallsSimilar ? "Similar" : "Significantly different",
        divergence: functionalAssessment.divergenceLabel,
        sessionCompletion:
          sessionsStable == null ? "Insufficient data" : sessionsStable ? "Stable" : "Reduced",
      },
      overallExecutiveSummary,
      functionalAssessment,
      performanceAssessmentSection: perfSection,
      includeAwrDeepDive,
      finalVerdict: {
        banner: `Bottom line: ${verdictLabelText(bottomLineDetail)}`,
        verdict: bottomLineDetail,
        rationale: isValid
          ? "Replay status and fidelity checks are sufficient for a directional conclusion."
          : validityReason,
      },
      scoringExplanation: [
        {
          outcome: "PASS / good",
          rule: "Assigned when replay is functionally usable and DB Time improves materially, with divergence below 5% or clearly localized/non-critical.",
        },
        {
          outcome: "WARN / mixed",
          rule: "Assigned when outcome is mixed or degraded: moderate divergence (5-20%), marginal DB Time movement, or unresolved comparability caveats.",
        },
        {
          outcome: "FAIL / bad",
          rule: "Assigned when replay is invalid, including high divergence (>20%), failed/incomplete replay, or severe comparability issues.",
        },
      ],
      riskExplanation: [
        {
          level: "Low",
          rule: "Total finding severity score below 60. Usually means only a few low or moderate issues were detected.",
        },
        {
          level: "Moderate",
          rule: "Total finding severity score from 60 to 84. Usually means multiple moderate issues or one high issue plus other concerns were detected.",
        },
        {
          level: "High",
          rule: "Total finding severity score 85 or above. Usually means several high-impact issues were detected in the replay analysis.",
        },
      ],
    };
  }

  function findLoadProfileMetric(loadProfile, metricPattern) {
    const entry = Object.entries(loadProfile || {}).find(([name]) =>
      name.toLowerCase().includes(metricPattern.toLowerCase())
    );
    return entry ? entry[1] : null;
  }

  function formatPctPointChange(first, second) {
    if (typeof first !== "number" || typeof second !== "number") {
      return "n/a";
    }
    const diff = second - first;
    return `${diff > 0 ? "+" : ""}${diff.toFixed(2)} pp`;
  }

  function formatPercentValue(value, digits = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "n/a";
    }
    return value.toFixed(digits);
  }

  function formatNumberValue(value, digits = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "n/a";
    }
    return value.toFixed(digits);
  }

  function inferSqlIssue(sql) {
    const exec1 = sql.executionsFirst || 0;
    const exec2 = sql.executionsSecond || 0;
    const perExec = sql.perExecMsSecond ?? sql.perExecMsFirst;
    const text = String(sql.sqlText || "").toLowerCase();
    if (exec2 > Math.max(exec1 * 2, exec1 + 200)) {
      return "High-frequency SQL (chatty workload)";
    }
    if (typeof perExec === "number" && perExec > 1000) {
      return "Expensive per execution";
    }
    if (/\b(insert|update|delete|merge)\b/.test(text)) {
      return "Potential contention-causing write SQL";
    }
    return "Mixed cost/frequency profile";
  }

  function mapEventContext(waitClass) {
    const value = String(waitClass || "").toLowerCase();
    if (value.includes("commit")) {
      return "Commit pressure, typically log file sync / redo path";
    }
    if (value.includes("user i/o")) {
      return "Read/write I/O path pressure";
    }
    if (value.includes("concurrency")) {
      return "Contention (buffer/block/library/metadata)";
    }
    if (value.includes("application")) {
      return "Application-layer locking or serialization";
    }
    return "General wait pressure";
  }

  function formatPerSecChange(label, metric) {
    const first = metric?.firstPerSec;
    const second = metric?.secondPerSec;
    const diff = metric?.perSecDiffPct;
    const base = `${label}: ${first ?? "n/a"} -> ${second ?? "n/a"} (${formatSignedPct(diff, 2)})`;
    if (typeof first === "number" && first <= 0) {
      return `${base} [source baseline is non-positive; %Diff may be misleading]`;
    }
    return base;
  }

  function buildAwrCompareDiagnosis(parsed) {
    const awr = parsed.awr || {};
    const loadProfile = awr.loadProfile || {};
    const timeModel = awr.timeModel || {};
    const waitClasses = (awr.waitClasses || []).filter((item) => !/idle/i.test(item.waitClass || ""));
    const waitEvents = (awr.waitEvents || []).filter((item) => !/idle/i.test(item.waitClass || ""));

    const dbTimeMetric =
      findLoadProfileMetric(loadProfile, "db time") ||
      findLoadProfileMetric(loadProfile, "dbtime");
    const dbCpuMetric =
      findLoadProfileMetric(loadProfile, "db cpu") ||
      findLoadProfileMetric(loadProfile, "cpu time");
    const txnMetric = findLoadProfileMetric(loadProfile, "transaction");
    const execMetric = findLoadProfileMetric(loadProfile, "execution");
    const redoMetric = findLoadProfileMetric(loadProfile, "redo size");

    const aasFirst = awr.snapshots?.["1st"]?.avgActiveUsers ?? null;
    const aasSecond = awr.snapshots?.["2nd"]?.avgActiveUsers ?? null;
    const dbCpuTimeModel = timeModel["DB CPU"] || timeModel["db cpu"] || null;
    const dbCpuPctFirst = dbCpuTimeModel?.firstPctDbTime ?? null;
    const dbCpuPctSecond = dbCpuTimeModel?.secondPctDbTime ?? null;
    const nonCpuPctFirst = typeof dbCpuPctFirst === "number" ? 100 - dbCpuPctFirst : null;
    const nonCpuPctSecond = typeof dbCpuPctSecond === "number" ? 100 - dbCpuPctSecond : null;

    const workloadShift = typeof dbTimeMetric?.perSecDiffPct === "number"
      ? dbTimeMetric.perSecDiffPct > 10
        ? "Heavier"
        : dbTimeMetric.perSecDiffPct < -10
          ? "Lighter"
          : "Similar"
      : "Insufficient data";
    const efficiencyShift = typeof dbTimeMetric?.perTxnDiffPct === "number"
      ? dbTimeMetric.perTxnDiffPct > 5
        ? "Worse efficiency per transaction"
        : dbTimeMetric.perTxnDiffPct < -5
          ? "Better efficiency per transaction"
          : "Similar efficiency per transaction"
      : "Insufficient data";

    let cpuWaitMix = "Insufficient data";
    if (typeof dbCpuPctSecond === "number") {
      cpuWaitMix =
        dbCpuPctSecond >= 70 ? "CPU-bound" : dbCpuPctSecond <= 30 ? "Wait-bound" : "Mixed";
    }

    const topWaitClassIncrease = [...waitClasses]
      .sort((a, b) => (b.diffPctDbTime || 0) - (a.diffPctDbTime || 0))[0] || null;
    const topWaitClassDecrease = [...waitClasses]
      .sort((a, b) => (a.diffPctDbTime || 0) - (b.diffPctDbTime || 0))[0] || null;
    const primaryDriver = topWaitClassIncrease?.waitClass || "Insufficient data";

    const topEventsBySecond = [...waitEvents]
      .sort((a, b) => (b.secondPctDbTime || 0) - (a.secondPctDbTime || 0))
      .slice(0, 5);
    const topEventsByDiff = [...waitEvents]
      .sort((a, b) => (b.diffPctDbTime || 0) - (a.diffPctDbTime || 0))
      .slice(0, 5);

    const topSqlElapsed = [...(awr.topSqlComparisons?.elapsedTime || [])]
      .sort((a, b) => (b.diffMetricPct || 0) - (a.diffMetricPct || 0));
    const topSqlCpu = [...(awr.topSqlComparisons?.cpuTime || [])]
      .sort((a, b) => (b.diffMetricPct || 0) - (a.diffMetricPct || 0));
    const topSqlIo = [...(awr.topSqlComparisons?.ioTime || [])]
      .sort((a, b) => (b.diffMetricPct || 0) - (a.diffMetricPct || 0));
    const topSqlExec = [...(awr.topSqlComparisons?.executions || [])]
      .sort((a, b) => ((b.executionsSecond || 0) - (b.executionsFirst || 0)) - ((a.executionsSecond || 0) - (a.executionsFirst || 0)));
    const newSqlInSecond = (awr.topSqlComparisons?.elapsedTime || [])
      .filter((sql) => !Number.isFinite(sql.firstMetricPct) && Number.isFinite(sql.secondMetricPct))
      .slice(0, 5);

    const criticalSql = topSqlElapsed
      .filter((sql) => (sql.diffMetricPct || 0) > 0)
      .slice(0, 5)
      .map((sql) => ({
        sqlId: sql.sqlId,
        diffPctDbTime: sql.diffMetricPct,
        executionsFirst: sql.executionsFirst,
        executionsSecond: sql.executionsSecond,
        issueType: inferSqlIssue(sql),
      }));

    const evidence = [];
    if (topWaitClassIncrease) {
      evidence.push(
        `Wait class ${topWaitClassIncrease.waitClass} increased by ${formatSignedPct(topWaitClassIncrease.diffPctDbTime, 2)} of DB time.`
      );
    }
    topEventsByDiff.slice(0, 3).forEach((event) => {
      evidence.push(
        `${event.event} (${event.waitClass}) diff ${formatSignedPct(event.diffPctDbTime, 2)}; 2nd period ${event.secondPctDbTime ?? "n/a"}% DB time.`
      );
    });
    criticalSql.slice(0, 3).forEach((sql) => {
      evidence.push(
        `SQL ${sql.sqlId} diff ${formatSignedPct(sql.diffPctDbTime, 2)} in Top SQL by Elapsed Time.`
      );
    });
    topSqlCpu.slice(0, 2).forEach((sql) => {
      evidence.push(
        `SQL ${sql.sqlId} CPU diff ${formatSignedPct(sql.diffMetricPct, 2)} in Top SQL by CPU Time.`
      );
    });
    topSqlIo.slice(0, 2).forEach((sql) => {
      evidence.push(
        `SQL ${sql.sqlId} I/O diff ${formatSignedPct(sql.diffMetricPct, 2)} in Top SQL by I/O Time.`
      );
    });

    const hypotheses = [];
    if (/commit/i.test(primaryDriver)) {
      const logFileSync = waitEvents.find((event) => /log file sync/i.test(event.event || ""));
      const logFileParallel = waitEvents.find((event) => /log file parallel write/i.test(event.event || ""));
      hypotheses.push(
        `Hypothesis 1 (Commit path): commit-driven pressure on redo path; log file sync diff ${formatSignedPct(logFileSync?.diffPctDbTime, 2)}, log file parallel write diff ${formatSignedPct(logFileParallel?.diffPctDbTime, 2)}.`
      );
      if (redoMetric?.perSecDiffPct != null) {
        hypotheses.push(
          `Hypothesis 2 (Redo volume): redo size per second changed by ${formatSignedPct(redoMetric.perSecDiffPct, 2)}, indicating possible commit frequency or redo write amplification.`
        );
      }
    } else if (/user i\/o/i.test(primaryDriver)) {
      hypotheses.push("Hypothesis 1 (I/O path): read-side latency/volume increased; confirm SQL with largest I/O-time and physical read deltas.");
    } else if (/concurrency/i.test(primaryDriver)) {
      hypotheses.push("Hypothesis 1 (Contention): latch/mutex/block contention increased; validate hot object and parse pressure contributors.");
    } else if (/db cpu/i.test(primaryDriver)) {
      hypotheses.push("Hypothesis 1 (CPU): CPU demand grew relative to capacity; validate SQL CPU hotspots and host saturation.");
    } else if (primaryDriver !== "Insufficient data") {
      hypotheses.push(`Hypothesis 1 (${primaryDriver}): dominant regression driver appears in this wait class; verify with SQL and event-level corroboration.`);
    } else {
      hypotheses.push("Hypothesis: insufficient AWR compare data to isolate a single regression driver.");
    }

    let workloadSentence = "Workload shift is unavailable from Load Profile metrics.";
    if (workloadShift !== "Insufficient data" || efficiencyShift !== "Insufficient data") {
      if (workloadShift !== "Insufficient data" && efficiencyShift !== "Insufficient data") {
        workloadSentence = `Workload appears ${workloadShift.toLowerCase()} with ${efficiencyShift.toLowerCase()}.`;
      } else if (workloadShift !== "Insufficient data") {
        workloadSentence = `Workload appears ${workloadShift.toLowerCase()}, while efficiency per transaction is unavailable.`;
      } else {
        workloadSentence = `Workload level is unavailable, but ${efficiencyShift.toLowerCase()}.`;
      }
    }

    return {
      executiveSummary: [
        workloadSentence,
        `Time-model in 2nd period is ${cpuWaitMix.toLowerCase()} (DB CPU ${formatPercentValue(dbCpuPctSecond)}% vs non-CPU ${formatPercentValue(nonCpuPctSecond)}%).`,
        `Primary bottleneck signal is ${primaryDriver}.`,
      ].join(" "),
      keyDifferences: [
        formatPerSecChange("DB Time per sec", dbTimeMetric),
        formatPerSecChange("DB CPU per sec", dbCpuMetric),
        `Avg Active Sessions: ${formatNumberValue(aasFirst)} -> ${formatNumberValue(aasSecond)}`,
        `DB CPU % DB time: ${dbCpuPctFirst ?? "n/a"} -> ${dbCpuPctSecond ?? "n/a"} (${formatPctPointChange(dbCpuPctFirst, dbCpuPctSecond)})`,
        `Top wait class increase: ${topWaitClassIncrease?.waitClass || "n/a"} (${formatSignedPct(topWaitClassIncrease?.diffPctDbTime, 2)})`,
        `Top wait class decrease: ${topWaitClassDecrease?.waitClass || "n/a"} (${formatSignedPct(topWaitClassDecrease?.diffPctDbTime, 2)})`,
      ],
      primaryBottleneck: {
        class: primaryDriver,
        rationale:
          topWaitClassIncrease
            ? `Largest positive Diff in Wait Classes % DB time is ${topWaitClassIncrease.waitClass} (${formatSignedPct(topWaitClassIncrease.diffPctDbTime, 2)}).`
            : "Insufficient wait-class data.",
      },
      eventDrilldown: {
        topBySecondPctDbTime: topEventsBySecond.map((event) => ({
          event: event.event,
          waitClass: event.waitClass,
          secondPctDbTime: event.secondPctDbTime,
          diffPctDbTime: event.diffPctDbTime,
          context: mapEventContext(event.waitClass),
        })),
        topByDiffPctDbTime: topEventsByDiff.map((event) => ({
          event: event.event,
          waitClass: event.waitClass,
          secondPctDbTime: event.secondPctDbTime,
          diffPctDbTime: event.diffPctDbTime,
          context: mapEventContext(event.waitClass),
        })),
      },
      sqlLevel: {
        topSqlByElapsedDiff: criticalSql,
        topSqlByCpuDiff: topSqlCpu.slice(0, 5).map((sql) => ({
          sqlId: sql.sqlId,
          diffPctMetric: sql.diffMetricPct,
          issueType: inferSqlIssue(sql),
        })),
        topSqlByIoDiff: topSqlIo.slice(0, 5).map((sql) => ({
          sqlId: sql.sqlId,
          diffPctMetric: sql.diffMetricPct,
          issueType: inferSqlIssue(sql),
        })),
        topSqlByExecutionIncrease: topSqlExec
          .slice(0, 5)
          .map((sql) => ({
            sqlId: sql.sqlId,
            executionsFirst: sql.executionsFirst,
            executionsSecond: sql.executionsSecond,
            deltaExecutions: (sql.executionsSecond || 0) - (sql.executionsFirst || 0),
            issueType: inferSqlIssue(sql),
          })),
        newlyAppearingInSecond: newSqlInSecond.map((sql) => ({
          sqlId: sql.sqlId,
          secondPctMetric: sql.secondMetricPct,
          issueType: inferSqlIssue(sql),
        })),
      },
      evidence,
      rootCauseHypotheses: hypotheses,
      correlationNotes: [
        topWaitClassIncrease
          ? `Wait-class driver ${topWaitClassIncrease.waitClass} is consistent with top wait events in ${topEventsByDiff.slice(0, 3).map((e) => e.waitClass).filter(Boolean).join(", ") || "n/a"}.`
          : "Wait-class to wait-event correlation is unavailable.",
        criticalSql.length
          ? `Top SQL deltas (${criticalSql.slice(0, 3).map((sql) => sql.sqlId).join(", ")}) should be validated against dominant waits for consistency.`
          : "SQL-level compare data is insufficient for strong correlation.",
      ],
      validationSteps: [
        "Confirm non-idle wait-event deltas in Wait Events match primary wait class shift.",
        "Verify top SQL execution/elapsed deltas with SQL Monitor or ASH for the 2nd window.",
        "Validate that workload scope (transactions/executions) is comparable before final conclusion.",
        "Check whether background/internal maintenance SQL dominates 2nd period and filter if needed.",
      ],
      recommendedActions: [
        /concurrency/i.test(primaryDriver)
          ? "Prioritize contention remediation: reduce parse churn, inspect library cache mutex/latch hotspots, and stabilize object access patterns."
          : /commit/i.test(primaryDriver)
            ? "Prioritize commit-path remediation: review commit batching and redo device latency (log file sync / log file parallel write)."
            : /user i\/o/i.test(primaryDriver)
              ? "Prioritize I/O remediation: investigate high-read SQL, storage latency, and plan changes that amplify reads."
              : /db cpu/i.test(primaryDriver)
                ? "Prioritize CPU remediation: tune top CPU SQL and verify CPU headroom/scheduler pressure."
                : "Prioritize the highest positive wait-class and wait-event deltas first; then validate top SQL contributors.",
        "Tune top SQL IDs with highest positive elapsed-time diff and/or execution growth before broad system changes.",
        "Re-run AWR compare after targeted fixes and confirm Diff columns improve for the same sections.",
      ],
      factsVsInference: {
        facts: [
          `Primary wait-class increase: ${topWaitClassIncrease?.waitClass || "n/a"} (${formatSignedPct(topWaitClassIncrease?.diffPctDbTime, 2)}).`,
          `DB CPU % DB time: ${dbCpuPctFirst ?? "n/a"} -> ${dbCpuPctSecond ?? "n/a"}.`,
          `Top SQL entries with positive elapsed diff: ${criticalSql.slice(0, 3).map((sql) => sql.sqlId).join(", ") || "n/a"}.`,
        ],
        inferences: [
          `Dominant regression mode is inferred as ${primaryDriver === "Insufficient data" ? "unknown" : primaryDriver}.`,
          "Root-cause hypotheses require validation with SQL Monitor/ASH and environment checks.",
        ],
      },
      missingData: [
        !waitClasses.length ? "Wait Classes section not parsed." : null,
        !waitEvents.length ? "Wait Events section not parsed." : null,
        !topSqlElapsed.length ? "Top SQL by Elapsed Time section not parsed." : null,
        !topSqlCpu.length ? "Top SQL by CPU Time section not parsed." : null,
        !topSqlIo.length ? "Top SQL by I/O Time section not parsed." : null,
        !topSqlExec.length ? "Top SQL by Executions section not parsed." : null,
      ].filter(Boolean),
    };
  }

  function buildReplaySummary(input) {
    const options = input.options || {};
    const parsed = {
      replayId: input.replayId,
      dbReplay: parseDbReplayReport(input.dbReplayHtml),
      compare: parseCompareReport(input.compareHtml),
      awr: parseAwrReport(input.awrHtml),
      capture: parseCaptureReport(input.captureHtml),
    };

    const findings = buildFindings(parsed);
    const projectSections = buildProjectStyleSections(parsed, options);
    const awrDiagnosis = buildAwrCompareDiagnosis(parsed);
    const verdict = buildVerdict(parsed, projectSections);
    const severityScore =
      findings.reduce((sum, finding) => {
        if (finding.severity === "High") {
          return sum + 35;
        }
        if (finding.severity === "Moderate") {
          return sum + 20;
        }
        return sum + 8;
      }, 0) || 15;

    return {
      replayId: input.replayId,
      headline: buildHeadline(parsed, verdict),
      severity: classifySeverity(Math.min(severityScore, 100)),
      parsed,
      findings,
      projectSections,
      awrDiagnosis,
      options: {
        includeAwrDeepDive: Boolean(options.includeAwrDeepDive),
      },
      verdict,
      generatedAt: new Date().toLocaleString(),
    };
  }

  function renderFinding(finding) {
    return `
      <article class="finding ${finding.severity.toLowerCase()}">
        <div class="tag">${finding.severity}</div>
        <h3>${finding.title}</h3>
        <p><strong>Issue:</strong> ${finding.issue}</p>
        <p><strong>Likely cause:</strong> ${finding.cause}</p>
        <p><strong>Recommendation:</strong> ${finding.recommendation}</p>
      </article>
    `;
  }

  function renderSummaryHtml(summary) {
    const replayName =
      summary.parsed.dbReplay.dbHeader["Replay Name"] ||
      summary.parsed.dbReplay.replayInfo.Name?.replay ||
      `Replay ${summary.replayId}`;
    const replayDbName =
      summary.parsed.compare.databaseInfo?.["Database Name"]?.replay ||
      summary.parsed.dbReplay.replayInfo["Database Name"]?.replay ||
      "";
    const captureDbName =
      summary.parsed.compare.databaseInfo?.["Database Name"]?.capture ||
      summary.parsed.dbReplay.replayInfo["Database Name"]?.capture ||
      "";
    const replayDbVersion =
      summary.parsed.dbReplay.replayInfo["Database Version"]?.replay ||
      summary.parsed.dbReplay.dbHeader["Release"] ||
      "";
    const captureDbVersion =
      summary.parsed.dbReplay.replayInfo["Database Version"]?.capture ||
      "";
    const replayDb =
      replayDbName && replayDbVersion ? `${replayDbName}(${replayDbVersion})` : replayDbName || replayDbVersion || "";
    const captureDb =
      captureDbName && captureDbVersion ? `${captureDbName}(${captureDbVersion})` : captureDbName || captureDbVersion || "";
    const exportFileBase = `replay-executive-summary-${summary.replayId}-${replayName}`
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    const findingsHtml =
      summary.findings.map(renderFinding).join("") ||
      `<article class="finding low"><div class="tag">Low</div><h3>No material issues flagged</h3><p>The available reports do not show a clear regression signal. Review the underlying reports for environment-specific nuances.</p></article>`;
    const verdictTone =
      summary.verdict.tone === "positive"
        ? { fg: "#166534", bg: "rgba(22,101,52,0.12)" }
        : summary.verdict.tone === "negative"
          ? { fg: "#991b1b", bg: "rgba(153,27,27,0.12)" }
          : { fg: "#92400e", bg: "rgba(146,64,14,0.12)" };
    const projectFindingsHtml = summary.projectSections.findings
      .map(
        (item) => `<li>${item.title ? `<strong>${escapeHtml(item.title)}:</strong> ` : ""}${highlightInline(item.text)}</li>`
      )
      .join("");
    const projectCausesHtml = summary.projectSections.causes
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const testOutcome = summary.projectSections.testOutcome || {};
    const testObjective = summary.projectSections.testObjective || {};
    const performanceAssessment = summary.projectSections.performanceAssessment || {};
    const functionalAssessment = summary.projectSections.functionalAssessment || {};
    const performanceAssessmentSection = summary.projectSections.performanceAssessmentSection || {};
    const includeAwrDeepDive = Boolean(
      summary.options?.includeAwrDeepDive || summary.projectSections.includeAwrDeepDive
    );
    const finalVerdict = summary.projectSections.finalVerdict || {};
    const scoringRows = summary.projectSections.scoringExplanation
      .map(
        (row) =>
          `<tr><td><strong>${escapeHtml(row.outcome)}</strong></td><td>${highlightInline(row.rule)}</td></tr>`
      )
      .join("");
    const riskRows = summary.projectSections.riskExplanation
      .map(
        (row) =>
          `<tr><td><strong>${escapeHtml(row.level)}</strong></td><td>${highlightInline(row.rule)}</td></tr>`
      )
      .join("");
    const verdictReasons = (summary.verdict.reasons || [])
      .map((item) => `<li>${highlightVerdictText(item)}</li>`)
      .join("");
    const awrDiagnosis = summary.awrDiagnosis || {};
    const awrKeyDiffsHtml = (awrDiagnosis.keyDifferences || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrEvidenceHtml = (awrDiagnosis.evidence || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrHypothesisHtml = (awrDiagnosis.rootCauseHypotheses || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrValidationHtml = (awrDiagnosis.validationSteps || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrActionsHtml = (awrDiagnosis.recommendedActions || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrFactsHtml = (awrDiagnosis.factsVsInference?.facts || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrInferenceHtml = (awrDiagnosis.factsVsInference?.inferences || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrMissingDataHtml = (awrDiagnosis.missingData || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const awrTopEventsHtml = (awrDiagnosis.eventDrilldown?.topByDiffPctDbTime || [])
      .slice(0, 5)
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.event || "-")}</td><td>${escapeHtml(row.waitClass || "-")}</td><td>${row.secondPctDbTime ?? "-"}</td><td>${row.diffPctDbTime ?? "-"}</td><td>${highlightInline(row.context || "-")}</td></tr>`
      )
      .join("");
    const awrTopSqlHtml = (awrDiagnosis.sqlLevel?.topSqlByElapsedDiff || [])
      .slice(0, 5)
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.sqlId || "-")}</td><td>${row.diffPctDbTime ?? "-"}</td><td>${row.executionsFirst ?? "-"}</td><td>${row.executionsSecond ?? "-"}</td><td>${highlightInline(row.issueType || "-")}</td></tr>`
      )
      .join("");
    const functionalHighlightsHtml = (functionalAssessment.highlights || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const functionalActionsHtml = (functionalAssessment.actions || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const functionalEvidenceHtml = (functionalAssessment.captureValidity?.evidence || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const perfHighlightsHtml = (performanceAssessmentSection.highlights || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const perfBottlenecksHtml = (performanceAssessmentSection.bottlenecks || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const perfActionsHtml = (performanceAssessmentSection.actions || [])
      .map((item) => `<li>${highlightInline(item)}</li>`)
      .join("");
    const parseMetricValue = (value) => {
      const cleaned = String(value || "").replace(/,/g, "");
      const parsed = Number.parseFloat(cleaned.replace(/[^0-9.+-]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const buildCompareBarChart = (title, captureValue, replayValue, unit) => {
      const captureNumeric = parseMetricValue(captureValue);
      const replayNumeric = parseMetricValue(replayValue);
      if (!Number.isFinite(captureNumeric) && !Number.isFinite(replayNumeric)) {
        return "";
      }
      const maxValue = Math.max(captureNumeric || 0, replayNumeric || 0, 1);
      const captureWidth = Number.isFinite(captureNumeric)
        ? Math.max(4, Math.round((captureNumeric / maxValue) * 100))
        : 0;
      const replayWidth = Number.isFinite(replayNumeric)
        ? Math.max(4, Math.round((replayNumeric / maxValue) * 100))
        : 0;
      const formatMetricLabel = (rawValue, numericValue) => {
        if (Number.isFinite(numericValue)) {
          return `${formatNumberValue(numericValue)} ${unit}`.trim();
        }
        return String(rawValue || "n/a");
      };
      return `<div class="metric-chart">
        <h4>${escapeHtml(title)}</h4>
        <div class="metric-row">
          <div class="metric-meta"><span>Capture</span><strong>${escapeHtml(
            formatMetricLabel(captureValue, captureNumeric)
          )}</strong></div>
          <div class="bar-track"><div class="bar-fill capture" style="width:${captureWidth}%;"></div></div>
        </div>
        <div class="metric-row">
          <div class="metric-meta"><span>Replay</span><strong>${escapeHtml(
            formatMetricLabel(replayValue, replayNumeric)
          )}</strong></div>
          <div class="bar-track"><div class="bar-fill replay" style="width:${replayWidth}%;"></div></div>
        </div>
      </div>`;
    };
    const perfDbTimeMetric = summary.parsed.compare.mainPerformance?.["Database Time"] || {};
    const perfCpuTimeMetric = summary.parsed.compare.mainPerformance?.["CPU Time"] || {};
    const perfUserIoMetric = summary.parsed.compare.mainPerformance?.["User I/O Wait Time"] || {};
    const contextCharts = [];
    if (/i\/o-bound|wait\/i\/o-bound/i.test(performanceAssessmentSection.workloadClass || "")) {
      contextCharts.push(
        buildCompareBarChart(
          "User I/O Wait Time",
          perfUserIoMetric.captureTotal,
          perfUserIoMetric.replayTotal,
          "seconds"
        )
      );
    } else if (/commit\/wait-bound/i.test(performanceAssessmentSection.workloadClass || "")) {
      contextCharts.push(
        buildCompareBarChart(
          `ADDM Impact: ${performanceAssessmentSection.dominantAddmName || "Commit finding"}`,
          performanceAssessmentSection.dominantAddmCaptureImpactSec,
          performanceAssessmentSection.dominantAddmReplayImpactSec,
          "seconds"
        )
      );
    }
    const performanceChartsHtml = [
      buildCompareBarChart(
        "DB Time",
        perfDbTimeMetric.captureTotal,
        perfDbTimeMetric.replayTotal,
        "seconds"
      ),
      buildCompareBarChart(
        "CPU Time",
        perfCpuTimeMetric.captureTotal,
        perfCpuTimeMetric.replayTotal,
        "seconds"
      ),
      ...contextCharts,
    ]
      .filter(Boolean)
      .join("");
    const functionalTopHighlight = functionalAssessment.highlights?.[0];
    const functionalExecutiveSummary = [
      `Status is ${functionalAssessment.status || "insufficient data"}.`,
      typeof functionalAssessment.divergencePct === "number"
        ? `Divergence is ${functionalAssessment.divergencePct.toFixed(2)}% (${functionalAssessment.divergenceLabel || "n/a"}).`
        : "Divergence data is unavailable.",
      functionalAssessment.errorSourceSummary || null,
      functionalTopHighlight || null,
    ]
      .filter(Boolean)
      .join(" ");
    const topBottleneck = performanceAssessmentSection.bottlenecks?.[0];
    const topReplaySqlId = performanceAssessmentSection.topSql?.replay?.[0]?.sqlId;
    const performanceExecutiveSummary = [
      `Status is ${performanceAssessmentSection.status || performanceAssessment.overall || "insufficient data"}.`,
      `DB Time outcome is ${(performanceAssessmentSection.dbTimeVerdict || performanceAssessment.dbTime || "insufficient data").toLowerCase()}.`,
      `Dominant mode is ${(performanceAssessmentSection.workloadClass || "insufficient data").toLowerCase()}.`,
      topBottleneck ? `Top bottleneck signal: ${topBottleneck}.` : null,
      topReplaySqlId ? `Top replay SQL by DB Time starts with ${topReplaySqlId}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const llmUsage = summary.llm?.usage || null;
    const llmPromptTokens = Number(llmUsage?.input_tokens);
    const llmCompletionTokens = Number(llmUsage?.output_tokens);
    const llmTotalTokens = Number(llmUsage?.total_tokens);
    const llmUsed = Boolean(summary.llm?.used);
    const llmUsageSectionHtml = llmUsed
      ? `<section>
        <h2>LLM Token Usage</h2>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>LLM narrative mode</td><td>Enabled</td></tr>
          <tr><td>Model</td><td>${escapeHtml(summary.llm?.model || "-")}</td></tr>
          <tr><td>Total tokens</td><td>${Number.isFinite(llmTotalTokens) ? llmTotalTokens : "-"}</td></tr>
          <tr><td>Prompt tokens</td><td>${Number.isFinite(llmPromptTokens) ? llmPromptTokens : "-"}</td></tr>
          <tr><td>Completion tokens</td><td>${Number.isFinite(llmCompletionTokens) ? llmCompletionTokens : "-"}</td></tr>
        </table>
      </section>`
      : `<section>
        <h2>LLM Token Usage</h2>
        <div class="summary-block">LLM narrative mode was not used for this report. Token consumption is 0.</div>
      </section>`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Replay Executive Summary ${summary.replayId}</title>
    <style>
      :root {
        --bg: #fbfaf6;
        --ink: #172033;
        --muted: #526174;
        --line: rgba(23, 32, 51, 0.12);
        --panel: white;
        --accent: #0f766e;
        --accent-soft: rgba(15, 118, 110, 0.12);
        --high: #991b1b;
        --moderate: #92400e;
        --low: #166534;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font: 16px/1.55 "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(45, 212, 191, 0.18), transparent 22%),
          linear-gradient(180deg, #fffefb 0%, var(--bg) 100%);
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 36px 20px 64px;
      }
      .hero {
        padding: 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(236,253,245,0.92));
        border: 1px solid var(--line);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(1.5rem, 3vw, 2.2rem);
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .sub {
        color: var(--muted);
        margin: 0;
        max-width: 860px;
      }
      .meta, .cards, .findings {
        display: grid;
        gap: 16px;
      }
      .meta, .cards {
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        margin-top: 18px;
      }
      .card, .finding {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--panel);
        padding: 18px;
      }
      .eyebrow {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.76rem;
        font-weight: 700;
      }
      .value {
        margin-top: 8px;
        font-size: 1.15rem;
        font-weight: 800;
      }
      section {
        margin-top: 28px;
      }
      h2 {
        margin: 0 0 14px;
        font-size: 1.35rem;
      }
      h3 {
        margin: 0 0 10px;
        font-size: 1.05rem;
      }
      .tag {
        display: inline-block;
        margin-bottom: 12px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.8rem;
        font-weight: 800;
        background: var(--accent-soft);
        color: var(--accent);
      }
      .finding.high .tag { background: rgba(153, 27, 27, 0.12); color: var(--high); }
      .finding.moderate .tag { background: rgba(146, 64, 14, 0.12); color: var(--moderate); }
      .finding.low .tag { background: rgba(22, 101, 52, 0.12); color: var(--low); }
      .finding h3 {
        margin: 0 0 8px;
        font-size: 1.05rem;
      }
      .finding p {
        margin: 8px 0 0;
      }
      .inline-hot {
        color: #b91c1c;
        background: rgba(185, 28, 28, 0.08);
        border-radius: 8px;
        padding: 2px 6px;
        font: 700 0.92em/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        border: 1px solid var(--line);
        border-radius: 18px;
        overflow: hidden;
      }
      th, td {
        padding: 12px 14px;
        text-align: left;
        border-bottom: 1px solid var(--line);
      }
      th {
        background: #f8fafc;
      }
      .summary-block {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: white;
        padding: 18px;
      }
      .verdict {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 12px;
        font-weight: 800;
      }
      .prototype-note {
        margin-top: 12px;
        border: 1px dashed rgba(23, 32, 51, 0.18);
        border-radius: 16px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.82);
      }
      .prototype-note p {
        margin: 0;
      }
      .criteria {
        margin-top: 10px;
      }
      .criteria strong {
        display: block;
        margin-top: 10px;
      }
      .criteria ul {
        margin: 6px 0 0 0;
        padding-left: 20px;
      }
      .criteria li {
        margin: 4px 0;
      }
      .prototype-section {
        border: 1px solid rgba(15, 118, 110, 0.18);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(240, 253, 250, 0.95), rgba(248, 250, 252, 0.98));
        padding: 20px;
      }
      .prototype-section h2 {
        margin-bottom: 10px;
      }
      .prototype-subsection {
        margin-top: 18px;
        border: 1px solid rgba(23, 32, 51, 0.08);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.9);
        padding: 16px;
      }
      .prototype-subsection:first-of-type {
        margin-top: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      .save-btn {
        border: 1px solid var(--line);
        background: white;
        color: var(--ink);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .save-btn:hover {
        border-color: rgba(23, 32, 51, 0.28);
      }
      details.collapsible-wrap {
        margin-top: 10px;
      }
      details.collapsible-wrap > summary {
        list-style: none;
        border: 1px solid var(--line);
        background: #f8fafc;
        color: var(--ink);
        border-radius: 12px;
        padding: 6px 10px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      details.collapsible-wrap > summary::-webkit-details-marker {
        display: none;
      }
      details.collapsible-wrap > summary::before {
        content: "+";
        width: 18px;
        text-align: center;
      }
      details.collapsible-wrap[open] > summary::before {
        content: "-";
      }
      .collapsible-details {
        margin-top: 10px;
      }
      .metric-charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
        margin: 8px 0 14px;
      }
      .metric-chart {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fcfdfd;
        padding: 10px 12px;
      }
      .metric-chart h4 {
        margin: 0 0 8px;
        font-size: 0.98rem;
      }
      .metric-row {
        margin: 8px 0;
      }
      .metric-meta {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 4px;
        font-size: 0.9rem;
      }
      .bar-track {
        height: 10px;
        border-radius: 999px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .bar-fill {
        height: 100%;
        border-radius: 999px;
      }
      .bar-fill.capture {
        background: #2563eb;
      }
      .bar-fill.replay {
        background: #dc2626;
      }
      ul.clean {
        margin: 0;
        padding-left: 20px;
      }
      ul.clean li {
        margin: 10px 0;
      }
      @media print {
        .actions {
          display: none;
        }
        .collapsible-details {
          display: block !important;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">Enterprise Manager Database Replay Executive Summary</div>
        <h1>${replayName}</h1>
        <p class="sub">${summary.headline}</p>
        <div class="verdict" style="color:${verdictTone.fg};background:${verdictTone.bg};margin-top:16px;">
          ${summary.verdict.icon} ${highlightInline(finalVerdict.banner || `Bottom line: ${summary.verdict.label}`)}
        </div>
        <div class="meta">
          <div class="card"><div class="eyebrow">Risk Rating</div><div class="value">${summary.severity}</div></div>
          <div class="card"><div class="eyebrow">Replay Database</div><div class="value">${replayDb || "-"}</div></div>
          <div class="card"><div class="eyebrow">Capture Database</div><div class="value">${captureDb || "-"}</div></div>
        </div>
        <div class="actions">
          <button id="saveReportHtml" class="save-btn" type="button">Save as HTML</button>
        </div>
      </section>

      <section>
        <h2>Executive Summary</h2>
        <div class="summary-block">${highlightInline(summary.projectSections.executiveParagraph || summary.headline)}</div>
      </section>

      <section>
        <h2>Replay At-a-Glance</h2>
        <div class="summary-block">
          <ul class="clean">
            <li><strong>Verdict:</strong> ${highlightInline(summary.projectSections.overallExecutiveSummary?.verdict || "degraded")}</li>
            <li><strong>Test outcome:</strong> ${highlightInline(
              testOutcome.status
                ? `${testOutcome.status}${testOutcome.valid ? ` (valid: ${testOutcome.valid})` : ""}`
                : "Insufficient data"
            )}${testOutcome.reason ? ` - ${highlightInline(testOutcome.reason)}` : ""}</li>
            <li><strong>Test objective:</strong> ${highlightInline(
              testObjective.type || "Insufficient data"
            )}${testObjective.reason ? ` - ${highlightInline(testObjective.reason)}` : ""}</li>
            ${(summary.projectSections.overallExecutiveSummary?.keyMetrics || [])
              .map((item) => `<li>${highlightInline(item)}</li>`)
              .join("")}
            ${(summary.projectSections.overallExecutiveSummary?.mainReasons || [])
              .map((item) => `<li>${highlightInline(item)}</li>`)
              .join("")}
          </ul>
        </div>
      </section>

      <section>
        <h2>Functional Assessment</h2>
        <div class="summary-block">
          <p style="margin-top:0;">${highlightInline(functionalExecutiveSummary)}</p>
          <ul class="clean">
            <li><strong>Assessment status:</strong> ${highlightInline(functionalAssessment.status || "Insufficient data")}</li>
            <li><strong>Divergence:</strong> ${highlightInline(
              typeof functionalAssessment.divergencePct === "number"
                ? `${functionalAssessment.divergencePct.toFixed(2)}% (${functionalAssessment.divergenceLabel || "n/a"})`
                : "Insufficient data"
            )}</li>
            <li><strong>Localized divergence:</strong> ${highlightInline(functionalAssessment.localizedDivergence || "Insufficient data")}</li>
            <li><strong>Error source profile:</strong> ${highlightInline(functionalAssessment.errorSourceSummary || "Insufficient data")}</li>
            <li><strong>Capture validity:</strong> ${highlightInline(functionalAssessment.captureValidity?.representative || "Insufficient data")} ${functionalAssessment.captureValidity?.reason ? `- ${highlightInline(functionalAssessment.captureValidity.reason)}` : ""}</li>
          </ul>
          <details class="collapsible-wrap">
            <summary>Show details</summary>
            <div class="collapsible-details">
            <p style="margin:14px 0 8px;"><strong>Highlights</strong></p>
            <ul class="clean">${functionalHighlightsHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Capture Evidence</strong></p>
            <ul class="clean">${functionalEvidenceHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Actions</strong></p>
            <ul class="clean">${functionalActionsHtml || "<li>Insufficient data</li>"}</ul>
            </div>
          </details>
        </div>
      </section>

      <section>
        <h2>Performance Assessment</h2>
        <div class="summary-block">
          <p style="margin-top:0;">${highlightInline(performanceExecutiveSummary)}</p>
          <ul class="clean">
            <li><strong>Assessment status:</strong> ${highlightInline(performanceAssessmentSection.status || performanceAssessment.overall || "Insufficient data")}</li>
            <li><strong>DB Time outcome:</strong> ${highlightInline(performanceAssessmentSection.dbTimeVerdict || performanceAssessment.dbTime || "Insufficient data")}</li>
            <li><strong>Dominant runtime mix (2nd period):</strong> ${highlightInline(performanceAssessmentSection.workloadClass || "Insufficient data")}</li>
            <li><strong>Session completion:</strong> ${highlightInline(performanceAssessment.sessionCompletion || "Insufficient data")}</li>
          </ul>
          ${performanceChartsHtml ? `<div class="metric-charts">${performanceChartsHtml}</div>` : ""}
          <details class="collapsible-wrap">
            <summary>Show details</summary>
            <div class="collapsible-details">
            <p style="margin:14px 0 8px;"><strong>Highlights</strong></p>
            <ul class="clean">${perfHighlightsHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Top Bottlenecks (ADDM Comparison Insights)</strong></p>
            <ul class="clean">${perfBottlenecksHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Key Findings</strong></p>
            <ul class="clean">${projectFindingsHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Likely Causes</strong></p>
            <ul class="clean">${projectCausesHtml || "<li>Insufficient data</li>"}</ul>
            <p style="margin:14px 0 8px;"><strong>Actions</strong></p>
            <ul class="clean">${perfActionsHtml || "<li>Insufficient data</li>"}</ul>
            </div>
          </details>
        </div>
      </section>

      ${includeAwrDeepDive ? `
      <section>
        <h2>Detailed Drill-down (AWR Compare)</h2>
        <div class="summary-block">
          <p style="margin-top:0;"><strong>Executive summary:</strong> ${highlightInline(awrDiagnosis.executiveSummary || "Insufficient AWR compare data.")}</p>
          <ul class="clean">
            <li><strong>Primary regression driver (Diff vs 1st):</strong> ${highlightInline(awrDiagnosis.primaryBottleneck?.class || "Insufficient data")}</li>
            <li><strong>Bottleneck rationale:</strong> ${highlightInline(awrDiagnosis.primaryBottleneck?.rationale || "Insufficient data")}</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>AWR Key Differences</h2>
        <div class="summary-block">
          <ul class="clean">${awrKeyDiffsHtml || "<li>Insufficient data</li>"}</ul>
        </div>
      </section>

      <section>
        <h2>AWR Wait Events Focus</h2>
        <table>
          <tr><th>Event</th><th>Wait Class</th><th>2nd % DB time</th><th>Diff % DB time</th><th>Context</th></tr>
          ${awrTopEventsHtml || "<tr><td colspan='5'>Insufficient wait-event data</td></tr>"}
        </table>
      </section>

      <section>
        <h2>AWR SQL-Level Comparison</h2>
        <table>
          <tr><th>SQL ID</th><th>Diff % metric</th><th>1st Execs</th><th>2nd Execs</th><th>Classification</th></tr>
          ${awrTopSqlHtml || "<tr><td colspan='5'>Insufficient SQL compare data</td></tr>"}
        </table>
      </section>

      <section>
        <h2>Evidence And Hypotheses</h2>
        <div class="summary-block">
          <p style="margin:0 0 8px;"><strong>Evidence</strong></p>
          <ul class="clean">${awrEvidenceHtml || "<li>Insufficient data</li>"}</ul>
          <p style="margin:14px 0 8px;"><strong>Root cause hypotheses</strong></p>
          <ul class="clean">${awrHypothesisHtml || "<li>Insufficient data</li>"}</ul>
        </div>
      </section>

      <section>
        <h2>Facts Vs Inference</h2>
        <div class="summary-block">
          <p style="margin:0 0 8px;"><strong>Facts</strong></p>
          <ul class="clean">${awrFactsHtml || "<li>Insufficient data</li>"}</ul>
          <p style="margin:14px 0 8px;"><strong>Inference</strong></p>
          <ul class="clean">${awrInferenceHtml || "<li>Insufficient data</li>"}</ul>
        </div>
      </section>

      <section>
        <h2>Validation Steps</h2>
        <div class="summary-block">
          <ul class="clean">${awrValidationHtml || "<li>Insufficient data</li>"}</ul>
        </div>
      </section>

      <section>
        <h2>Recommended Actions</h2>
        <div class="summary-block">
          <ul class="clean">${awrActionsHtml || "<li>Insufficient data</li>"}</ul>
        </div>
      </section>

      ${awrMissingDataHtml ? `<section><h2>Missing Data</h2><div class="summary-block"><ul class="clean">${awrMissingDataHtml}</ul></div></section>` : ""}
      ` : ""}

      <section>
        <h2>Final Verdict</h2>
        <div class="summary-block">
          <strong>${highlightInline(finalVerdict.verdict || summary.projectSections.bottomLineDetail || "Insufficient data")}</strong>
          <div style="margin-top:10px;">${highlightVerdictText(finalVerdict.rationale || summary.projectSections.bottomLineDetail || "Insufficient data")}</div>
          ${verdictReasons ? `<div style="margin-top:14px;"><strong>Why this result was assigned:</strong><ul class="clean">${verdictReasons}</ul></div>` : ""}
        </div>
      </section>

      <section>
        <h2>Diagnostic Notes</h2>
        <div class="findings">${findingsHtml}</div>
      </section>

      <section>
        <h2>Evidence Snapshot</h2>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Replay status</td><td>${summary.parsed.dbReplay.dbHeader["Replay Status"] || "-"}</td></tr>
          <tr><td>Replay divergence</td><td>${summary.parsed.compare.divergence.level || "-"}${typeof summary.parsed.compare.divergence.percent === "number" ? ` (${summary.parsed.compare.divergence.percent.toFixed(2)}%)` : ""}</td></tr>
          <tr><td>Database Time change</td><td>${summary.parsed.compare.mainPerformance["Database Time"]?.changePct ?? "-"}%</td></tr>
          <tr><td>CPU Time change</td><td>${summary.parsed.compare.mainPerformance["CPU Time"]?.changePct ?? "-"}%</td></tr>
          <tr><td>Replay average active sessions</td><td>${summary.parsed.dbReplay.replayStats["Average Active Sessions"]?.replay || "-"}</td></tr>
          <tr><td>AWR top replay wait</td><td>${summary.parsed.awr.topEvents[0]?.secondEvent || "-"}</td></tr>
          <tr><td>Generated</td><td>${summary.generatedAt}</td></tr>
        </table>
      </section>

      ${llmUsageSectionHtml}

      <section>
        <div class="prototype-section">
          <h2>Prototype Verdict Criteria</h2>
          <p style="margin:0;">This section explains the prototype-only scoring logic used to derive the Bottom Line and Risk Rating. It is intended as reviewer guidance and methodology, not as part of the replay performance findings themselves.</p>

          <div class="prototype-subsection">
            <h3>How Bottom Line Is Defined</h3>
            <details class="collapsible-wrap">
              <summary>Show details</summary>
              <div class="collapsible-details">
                <p style="margin-top:0;">This prototype uses a rule-based scoring approach, not an LLM, to assign the Bottom Line. Reviewers can use the table below to see the explicit threshold logic.</p>
                <table>
                  <tr><th>Outcome</th><th>Prototype Rule</th></tr>
                  ${scoringRows}
                </table>
              </div>
            </details>
          </div>

          <div class="prototype-subsection">
            <h3>How Risk Rating Is Defined</h3>
            <details class="collapsible-wrap">
              <summary>Show details</summary>
              <div class="collapsible-details">
                <p style="margin-top:0;">Risk Rating is a separate roll-up of diagnostic findings. Each finding is assigned a severity and converted into a score:</p>
                <ul class="clean">
                  <li><strong>High finding</strong> = 35 points</li>
                  <li><strong>Moderate finding</strong> = 20 points</li>
                  <li><strong>Low finding</strong> = 8 points</li>
                </ul>
                <p>The total score is then mapped to the displayed Risk Rating:</p>
                <table>
                  <tr><th>Risk Rating</th><th>Prototype Rule</th></tr>
                  ${riskRows}
                </table>
              </div>
            </details>
          </div>
        </div>
      </section>
    </main>
    <script>
      (function () {
        const btn = document.getElementById("saveReportHtml");
        if (btn) {
          btn.addEventListener("click", function () {
            const doctype = "<!DOCTYPE html>\\n";
            const html = doctype + document.documentElement.outerHTML;
            const blob = new Blob([html], { type: "text/html;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "${escapeHtml(exportFileBase)}.html";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
          });
        }

      })();
    </script>
  </body>
</html>`;
  }

  function buildLLMSummaryPayload(summary) {
    return {
      replayId: summary.replayId,
      replayName:
        summary.parsed.dbReplay.dbHeader["Replay Name"] ||
        summary.parsed.dbReplay.replayInfo.Name?.replay ||
        `Replay ${summary.replayId}`,
      replayStatus: summary.parsed.dbReplay.dbHeader["Replay Status"] || "UNKNOWN",
      captureDatabase: summary.parsed.dbReplay.replayInfo["Database Name"]?.capture || "",
      replayDatabase: summary.parsed.dbReplay.replayInfo["Database Name"]?.replay || "",
      captureVersion: summary.parsed.dbReplay.replayInfo["Database Version"]?.capture || "",
      replayVersion:
        summary.parsed.dbReplay.replayInfo["Database Version"]?.replay ||
        summary.parsed.dbReplay.dbHeader["Release"] ||
        "",
      dbTimeChangePct: summary.parsed.compare.mainPerformance["Database Time"]?.changePct ?? null,
      dbTimeCapture: summary.parsed.compare.mainPerformance["Database Time"]?.captureTotal || "",
      dbTimeReplay: summary.parsed.compare.mainPerformance["Database Time"]?.replayTotal || "",
      cpuTimeChangePct: summary.parsed.compare.mainPerformance["CPU Time"]?.changePct ?? null,
      cpuDbTimeCapturePct: summary.parsed.compare.mainPerformance["CPU Time"]?.captureDbPct ?? null,
      cpuDbTimeReplayPct: summary.parsed.compare.mainPerformance["CPU Time"]?.replayDbPct ?? null,
      divergenceLevel: summary.parsed.compare.divergence.level || "UNKNOWN",
      divergencePct: summary.parsed.compare.divergence.percent ?? null,
      selectRowFetchDiffCount:
        summary.parsed.dbReplay.divergence["SELECTs with Different Number of Rows Fetched"]?.count ?? 0,
      cpuTopologyCapture: summary.parsed.compare.cpuUsage.Capture?.topology || "",
      cpuTopologyReplay: summary.parsed.compare.cpuUsage.Replay?.topology || "",
      hostCpuCapture: summary.parsed.compare.cpuUsage.Capture?.hostUsage || "",
      hostCpuReplay: summary.parsed.compare.cpuUsage.Replay?.hostUsage || "",
      topReplayWait: summary.parsed.awr.topEvents[0]?.secondEvent || "",
      topReplayWaitPctDbTime: summary.parsed.awr.topEvents[0]?.secondDbTimePct ?? null,
      parseTimePctCapture: summary.parsed.awr.timeModel["parse time elapsed"]?.firstPctDbTime ?? null,
      parseTimePctReplay: summary.parsed.awr.timeModel["parse time elapsed"]?.secondPctDbTime ?? null,
      totalParsesCapture: summary.parsed.awr.totals.totalParsesFirst ?? null,
      totalParsesReplay: summary.parsed.awr.totals.totalParsesSecond ?? null,
      addmCpuThrottlingPct: summary.parsed.compare.addm["Resource Manager CPU Throttling"]?.replayPct ?? null,
      addmHardParseLiteralPct: summary.parsed.compare.addm["Hard Parse Due to Literal Usage"]?.replayPct ?? null,
      captureReportAvailable: Boolean(summary.parsed.capture?.available),
      captureStatus: summary.parsed.capture?.captureDatabase?.Status || null,
      captureUserCalls: getCaptureStatValue(summary.parsed.capture, "User calls captured")?.value ?? null,
      captureUserCallsWithErrors:
        getCaptureStatValue(summary.parsed.capture, "User calls captured with Errors")?.value ?? null,
      captureFilters: (summary.parsed.capture?.workloadFilters || []).slice(0, 5),
      bottomLine: summary.verdict.label,
      riskRating: summary.severity,
      deterministicExecutiveSummary: summary.projectSections.executiveParagraph,
      deterministicFunctionalAssessment: summary.projectSections.functionalAssessment || null,
      deterministicPerformanceAssessment: summary.projectSections.performanceAssessmentSection || null,
      deterministicKeyFindings: summary.projectSections.findings.map((item) => `${item.title}: ${item.text}`),
      deterministicProblems: summary.projectSections.problems,
      deterministicLikelyCauses: summary.projectSections.causes,
      deterministicRecommendedActions: summary.projectSections.actions,
      deterministicBottomLine: `${summary.projectSections.bottomLineIntro}. ${summary.projectSections.bottomLineDetail}`,
    };
  }

  function applyLLMSections(summary, llmSections) {
    if (!llmSections) {
      return summary;
    }

    return {
      ...summary,
      projectSections: {
        ...summary.projectSections,
        executiveParagraph:
          llmSections.executive_summary || summary.projectSections.executiveParagraph,
        findings: Array.isArray(llmSections.key_findings) && llmSections.key_findings.length
          ? llmSections.key_findings.map((item, index) => ({
              title: "",
              text: item,
            }))
          : summary.projectSections.findings,
        problems: Array.isArray(llmSections.problems_detected) && llmSections.problems_detected.length
          ? llmSections.problems_detected
          : summary.projectSections.problems,
        causes: Array.isArray(llmSections.likely_causes) && llmSections.likely_causes.length
          ? llmSections.likely_causes
          : summary.projectSections.causes,
        actions: Array.isArray(llmSections.recommended_actions) && llmSections.recommended_actions.length
          ? llmSections.recommended_actions
          : summary.projectSections.actions,
        bottomLineIntro:
          llmSections.bottom_line_title || summary.projectSections.bottomLineIntro,
        bottomLineDetail:
          llmSections.bottom_line || summary.projectSections.bottomLineDetail,
      },
    };
  }

  function writeToPopup(popup, html) {
    if (!popup || popup.closed) {
      throw new Error("Popup window is not available.");
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    return popup;
  }

  function openSummaryWindow(summary, popup) {
    const targetPopup =
      popup || window.open("", `replay-summary-${summary.replayId}`, "width=1200,height=900");
    if (!targetPopup) {
      throw new Error("Popup blocked. Allow popups for this page.");
    }
    return writeToPopup(targetPopup, renderSummaryHtml(summary));
  }

  function openErrorWindow(error, popup) {
    const targetPopup =
      popup || window.open("", "replay-summary-error", "width=860,height=640");
    if (!targetPopup) {
      throw error;
    }
    return writeToPopup(
      targetPopup,
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Replay Summary Error</title>
    <style>
      body {
        margin: 0;
        padding: 28px;
        font: 16px/1.5 "Avenir Next", "Segoe UI", sans-serif;
        color: #1f2937;
        background: #fffdf8;
      }
      .panel {
        border: 1px solid rgba(31, 41, 55, 0.12);
        border-radius: 18px;
        padding: 20px;
        background: white;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 1.6rem;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f8fafc;
        border-radius: 12px;
        padding: 14px;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Unable to build the executive summary</h1>
      <p>The popup was opened, but the summary generation failed before the report could be rendered.</p>
      <pre>${escapeHtml(error?.stack || error?.message || String(error))}</pre>
    </div>
  </body>
</html>`
    );
  }

  window.ReplaySummaryApp = {
    buildReplaySummary,
    buildLLMSummaryPayload,
    applyLLMSections,
    openSummaryWindow,
    openErrorWindow,
  };
})();
