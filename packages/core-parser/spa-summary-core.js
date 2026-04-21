(function () {
  const METRIC_PRIORITY = [
    "ELAPSED_TIME",
    "CPU_TIME",
    "USER_IO_TIME",
    "BUFFER_GETS",
    "DISK_READS",
    "PHYSICAL I/OS",
    "PHYSICAL_I_OS",
    "IO_INTERCONNECT_BYTES",
    "OPTIMIZER_COST",
  ];
  const SYSTEM_SCHEMAS = new Set(["SYS", "SYSTEM", "DBSNMP", "SYSMAN", "EMAGENT"]);
  const NON_DECISION_METRICS = new Set(["OPTIMIZER_COST"]);
  // GP's review method is intentionally conservative: elapsed time drives the
  // top-line story, while secondary metrics only become decision signals after
  // they clear materiality thresholds and survive noise filtering.
  const MATERIALITY_RULES = {
    workloadImpactPct: 2,
    highFrequency: 50000,
    highFrequencyImpactPct: 1,
    veryHighFrequency: 100000,
    veryHighFrequencyImpactPct: 0.5,
    elapsedRuntimeMajorPct: 20,
    cpuRuntimeMajorPct: 20,
    ioRuntimeMajorPct: 30,
  };
  const SUMMARY_METRIC_PRIORITY = [
    "ELAPSED_TIME",
    "CPU_TIME",
    "USER_IO_TIME",
    "DISK_READS",
    "PHYSICAL I/OS",
    "PHYSICAL_I_OS",
    "IO_INTERCONNECT_BYTES",
    "BUFFER_GETS",
    "OPTIMIZER_COST",
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toNumber(value) {
    const cleaned = String(value ?? "")
      .replace(/,/g, "")
      .replace(/%/g, "")
      .replace(/[^\d.+-]/g, "");
    if (!cleaned) {
      return null;
    }
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits = 2) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? "n/a");
    }

    const fractionDigits =
      Math.abs(numeric) >= 100 || Number.isInteger(numeric) ? 0 : digits;
    return numeric.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    });
  }

  function formatSignedPercent(value, digits = 2) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
  }

  function formatFixedNumber(value, digits = 2) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? "n/a");
    }
    return numeric.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatCompactNumber(value) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? "n/a");
    }
    return numeric.toLocaleString(undefined, {
      notation: "compact",
      compactDisplay: "short",
      minimumFractionDigits: Math.abs(numeric) >= 1000 ? 1 : 0,
      maximumFractionDigits: 1,
    });
  }

  function isTimeMetric(metric) {
    return ["CPU_TIME", "ELAPSED_TIME", "USER_IO_TIME"].includes(normalizeMetric(metric));
  }

  function formatWorkloadValue(metric, value) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? "n/a");
    }
    if (isTimeMetric(metric)) {
      return `${formatFixedNumber(numeric / 60000000, 2)} min`;
    }
    return formatCompactNumber(numeric);
  }

  function shortenSql(text, limit = 120) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 3)).trim()}...`;
  }

  function normalizeMetric(metric) {
    return String(metric ?? "").trim().toUpperCase();
  }

  function metricLabel(metric) {
    switch (normalizeMetric(metric)) {
      case "ELAPSED_TIME":
        return "Elapsed Time";
      case "CPU_TIME":
        return "CPU Time";
      case "USER_IO_TIME":
        return "User I/O Time";
      case "BUFFER_GETS":
        return "Buffer Gets";
      case "OPTIMIZER_COST":
        return "Optimizer Cost";
      case "DISK_READS":
        return "Disk Reads";
      case "IO_INTERCONNECT_BYTES":
        return "I/O Interconnect Bytes";
      case "PHYSICAL I/OS":
      case "PHYSICAL_I_OS":
        return "Physical I/Os";
      default:
        return String(metric ?? "Unknown Metric");
    }
  }

  function metricMeaning(metric) {
    switch (normalizeMetric(metric)) {
      case "ELAPSED_TIME":
        return "End-to-end response time";
      case "CPU_TIME":
        return "CPU consumption";
      case "USER_IO_TIME":
        return "User-visible I/O time";
      case "BUFFER_GETS":
        return "Logical I/O";
      case "DISK_READS":
        return "Physical reads";
      case "IO_INTERCONNECT_BYTES":
        return "Interconnect traffic";
      case "PHYSICAL I/OS":
      case "PHYSICAL_I_OS":
        return "Physical I/O operations";
      case "OPTIMIZER_COST":
        return "Optimizer estimate only";
      default:
        return "Measured SPA comparison signal";
    }
  }

  function formatMetricValue(metric, value) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? "n/a");
    }

    if (isTimeMetric(metric)) {
      const abs = Math.abs(numeric);
      if (abs >= 60000000) {
        return `${formatFixedNumber(numeric / 60000000, 2)} min`;
      }
      if (abs >= 1000000) {
        return `${formatFixedNumber(numeric / 1000000, 2)} sec`;
      }
      if (abs >= 1000) {
        return `${formatFixedNumber(numeric / 1000, 2)} ms`;
      }
      return `${formatFixedNumber(numeric, 2)} us`;
    }

    if (Math.abs(numeric) >= 1000000) {
      return formatCompactNumber(numeric);
    }
    return formatFixedNumber(numeric, Math.abs(numeric) >= 100 ? 0 : 2);
  }

  function workloadDirection(impact) {
    if (!Number.isFinite(impact) || impact === 0) {
      return "unchanged";
    }
    return impact > 0 ? "improved" : "regressed";
  }

  function isNearZeroBaseline(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
      return false;
    }
    return Math.abs(before) <= Math.max(1, Math.abs(after)) * 0.001;
  }

  function metricChangePhrase(metric, result) {
    const normalized = normalizeMetric(metric);
    if (result === "Regressed") {
      switch (normalized) {
        case "ELAPSED_TIME":
          return "slower";
        case "CPU_TIME":
          return "higher CPU time";
        case "USER_IO_TIME":
          return "higher user I/O time";
        case "BUFFER_GETS":
          return "more buffer gets";
        case "DISK_READS":
          return "more disk reads";
        case "IO_INTERCONNECT_BYTES":
          return "more interconnect traffic";
        case "PHYSICAL I/OS":
        case "PHYSICAL_I_OS":
          return "more physical I/Os";
        case "OPTIMIZER_COST":
          return "higher estimated cost";
        default:
          return "worse";
      }
    }

    if (result === "Improved") {
      switch (normalized) {
        case "ELAPSED_TIME":
          return "faster";
        case "CPU_TIME":
          return "lower CPU time";
        case "USER_IO_TIME":
          return "lower user I/O time";
        case "BUFFER_GETS":
          return "fewer buffer gets";
        case "DISK_READS":
          return "fewer disk reads";
        case "IO_INTERCONNECT_BYTES":
          return "less interconnect traffic";
        case "PHYSICAL I/OS":
        case "PHYSICAL_I_OS":
          return "fewer physical I/Os";
        case "OPTIMIZER_COST":
          return "lower estimated cost";
        default:
          return "better";
      }
    }

    return "unchanged";
  }

  function describeMetricChange(metricEntry, targetResult) {
    if (!metricEntry) {
      return "n/a";
    }
    if (targetResult === "Not meaningful") {
      return "Not meaningful (noise)";
    }
    if (targetResult === "Neutral") {
      return "No material change";
    }
    const before = toNumber(metricEntry.before);
    const after = toNumber(metricEntry.after);
    const magnitude = Math.abs(metricEntry.workloadImpact ?? metricEntry.statementImpact ?? 0);
    if ((isNearZeroBaseline(before, after) && Math.abs(after || 0) > 0) || magnitude > 1000) {
      if (targetResult === "Regressed") {
        return "Extreme increase (near-zero baseline)";
      }
      if (targetResult === "Improved") {
        return "Extreme decrease (near-zero baseline)";
      }
      return `Changed from near-zero baseline; use ${formatMetricValue(metricEntry.metric, metricEntry.before)} -> ${formatMetricValue(
        metricEntry.metric,
        metricEntry.after
      )}`;
    }
    if (!Number.isFinite(magnitude)) {
      return "No material change called out";
    }
    return `${formatFixedNumber(magnitude, 2)}% ${metricChangePhrase(metricEntry.metric, targetResult)}`;
  }

  function describeImpactMagnitude(value) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    if (Math.abs(value) > 1000) {
      return "Near-zero baseline; percentage not meaningful";
    }
    return `${formatFixedNumber(Math.abs(value), 2)}%`;
  }

  function rawPercentText(value) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return `${formatFixedNumber(Math.abs(value), 2)}%`;
  }

  function formatOverallImpactSummary(metric, before, after, impact) {
    const direction = workloadDirection(impact);
    const beforeValue = toNumber(before);
    const afterValue = toNumber(after);
    if ((isNearZeroBaseline(beforeValue, afterValue) && Math.abs(afterValue || 0) > 0) || Math.abs(impact || 0) > 1000) {
      if (direction === "regressed") {
        return "Extreme increase from near-zero baseline";
      }
      if (direction === "improved") {
        return "Extreme decrease from near-zero baseline";
      }
      return "Extreme change from near-zero baseline";
    }
    if (direction === "improved") {
      return `${formatFixedNumber(Math.abs(impact || 0), 2)}% improved`;
    }
    if (direction === "regressed") {
      return `${formatFixedNumber(Math.abs(impact || 0), 2)}% regressed`;
    }
    return "Unchanged";
  }

  function aggregateResult(metricEntries) {
    const entries = Object.values(metricEntries || {});
    const decisionEntries = entries.filter((entry) => entry.decisionEligible !== false);
    if (decisionEntries.some((entry) => entry.result === "Regressed")) {
      return "Regressed";
    }
    if (decisionEntries.some((entry) => entry.result === "Improved")) {
      return "Improved";
    }
    if (entries.some((entry) => entry.result === "Neutral")) {
      return "Neutral";
    }
    if (entries.some((entry) => entry.result === "Not meaningful")) {
      return "Not meaningful";
    }
    return "Neutral";
  }

  function compareMetricPriority(left, right) {
    const leftRank = METRIC_PRIORITY.indexOf(left);
    const rightRank = METRIC_PRIORITY.indexOf(right);
    const normalizedLeft = leftRank === -1 ? METRIC_PRIORITY.length : leftRank;
    const normalizedRight = rightRank === -1 ? METRIC_PRIORITY.length : rightRank;
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }
    return String(left || "").localeCompare(String(right || ""));
  }

  function compareSummaryMetricPriority(left, right) {
    const leftRank = SUMMARY_METRIC_PRIORITY.indexOf(normalizeMetric(left));
    const rightRank = SUMMARY_METRIC_PRIORITY.indexOf(normalizeMetric(right));
    const normalizedLeft = leftRank === -1 ? SUMMARY_METRIC_PRIORITY.length : leftRank;
    const normalizedRight = rightRank === -1 ? SUMMARY_METRIC_PRIORITY.length : rightRank;
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }
    return String(left || "").localeCompare(String(right || ""));
  }

  function runtimeMetricClass(metric) {
    const normalized = normalizeMetric(metric);
    if (normalized === "ELAPSED_TIME") {
      return "elapsed";
    }
    if (normalized === "CPU_TIME") {
      return "cpu";
    }
    if (["USER_IO_TIME", "DISK_READS", "PHYSICAL I/OS", "PHYSICAL_I_OS", "IO_INTERCONNECT_BYTES"].includes(normalized)) {
      return "io";
    }
    if (normalized === "BUFFER_GETS") {
      return "buffer";
    }
    return "other";
  }

  function isMicroTimingNoise(metric, before, after) {
    if (!isTimeMetric(metric) || !Number.isFinite(before) || !Number.isFinite(after)) {
      return false;
    }
    const maxMagnitude = Math.max(Math.abs(before), Math.abs(after));
    const delta = Math.abs(after - before);
    return maxMagnitude < 1000 || delta < 1000;
  }

  function evaluateMetricMateriality(metricEntry, sql, metricSummaryByMetric) {
    const metric = normalizeMetric(metricEntry.metric);
    const before = toNumber(metricEntry.before);
    const after = toNumber(metricEntry.after);
    const rawResult = metricEntry.rawResult || metricEntry.result || "Unchanged";
    const workloadImpact = Math.abs(metricEntry.workloadImpact ?? 0);
    const frequency = sql.frequency || 0;
    const elapsedSummary = metricSummaryByMetric?.ELAPSED_TIME;
    const nearZero = isNearZeroBaseline(before, after);
    const microNoise = isMicroTimingNoise(metric, before, after);
    const visibleElapsedShift =
      metric === "ELAPSED_TIME" &&
      Number.isFinite(elapsedSummary?.overallImpact) &&
      Math.abs(elapsedSummary.overallImpact) >= MATERIALITY_RULES.elapsedRuntimeMajorPct &&
      workloadImpact >= MATERIALITY_RULES.workloadImpactPct;

    if (nearZero || microNoise) {
      return {
        result: "Not meaningful",
        isMaterial: false,
        decisionEligible: false,
        materialReason: nearZero
          ? "Near-zero baseline makes the percentage change unreliable."
          : "Microsecond-level timing change is too small to treat as meaningful workload evidence.",
      };
    }

    if (!["Improved", "Regressed"].includes(rawResult)) {
      return {
        result: "Neutral",
        isMaterial: false,
        decisionEligible: !NON_DECISION_METRICS.has(metric),
        materialReason: "Oracle classifies this SQL as unchanged in this metric.",
      };
    }

    if (NON_DECISION_METRICS.has(metric)) {
      return {
        result: "Neutral",
        isMaterial: false,
        decisionEligible: false,
        materialReason: "Optimizer cost alone does not drive the verdict.",
      };
    }

    if (
      workloadImpact >= MATERIALITY_RULES.workloadImpactPct ||
      (frequency >= MATERIALITY_RULES.highFrequency && workloadImpact >= MATERIALITY_RULES.highFrequencyImpactPct) ||
      (frequency >= MATERIALITY_RULES.veryHighFrequency && workloadImpact >= MATERIALITY_RULES.veryHighFrequencyImpactPct) ||
      visibleElapsedShift
    ) {
      return {
        result: rawResult,
        isMaterial: true,
        decisionEligible: true,
        materialReason:
          workloadImpact >= MATERIALITY_RULES.workloadImpactPct
            ? "Workload impact meets the materiality threshold."
            : frequency >= MATERIALITY_RULES.highFrequency && workloadImpact >= MATERIALITY_RULES.highFrequencyImpactPct
              ? "Execution frequency makes this smaller shift material."
              : frequency >= MATERIALITY_RULES.veryHighFrequency && workloadImpact >= MATERIALITY_RULES.veryHighFrequencyImpactPct
                ? "Very high execution frequency makes this smaller shift material."
                : "Elapsed-time workload shift is visibly large at the workload level.",
      };
    }

    return {
      result: "Neutral",
      isMaterial: false,
      decisionEligible: true,
      materialReason: "Below the materiality threshold.",
    };
  }

  function extractXmlModel(html) {
    const match = String(html ?? "").match(/<!--FXTMODEL-->([\s\S]*?)<\/script>/i);
    if (!match) {
      throw new Error("Unable to locate the embedded SPA XML model.");
    }

    const xml = match[1].trim();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`SPA XML parse error: ${parserError.textContent.trim()}`);
    }
    return doc.documentElement;
  }

  function childElements(node, tagName) {
    return Array.from(node?.children || []).filter((child) => child.tagName === tagName);
  }

  function firstChild(node, tagName) {
    return childElements(node, tagName)[0] || null;
  }

  function propertiesToMap(node) {
    const result = {};
    childElements(node, "property").forEach((propertyNode) => {
      const name = propertyNode.getAttribute("name");
      if (name) {
        result[name] = propertyNode.textContent ?? "";
      }
    });
    return result;
  }

  function parseExecution(node) {
    if (!node) {
      return null;
    }
    const properties = propertiesToMap(node);
    return {
      label: node.getAttribute("label") || "",
      ...properties,
      errCount: toNumber(properties.err_count),
      unsupported: toNumber(properties.unsupported),
      id: properties.id || "",
      name: properties.name || "",
      type: properties.type || "",
      status: properties.status || "",
    };
  }

  function parseStatementNode(node) {
    const statNode = firstChild(node, "stat");
    const beforeNode = firstChild(statNode, "b");
    const afterNode = firstChild(statNode, "a");
    const workloadImpact = toNumber(statNode?.getAttribute("wImp"));
    return {
      objectId: node.getAttribute("id") || "",
      sqlId: node.getAttribute("sql_id") || "",
      sqlText: node.getAttribute("sql_text") || "",
      frequency: toNumber(node.getAttribute("frequency")),
      planChanged: /^y$/i.test(node.getAttribute("plan_change") || ""),
      performanceFlag: node.getAttribute("perf") || "",
      summaryMetric: {
        before: beforeNode?.textContent ?? "",
        after: afterNode?.textContent ?? "",
        beforePct: toNumber(beforeNode?.getAttribute("wprc")),
        afterPct: toNumber(afterNode?.getAttribute("wprc")),
        statementImpact: toNumber(statNode?.getAttribute("sImp")),
        workloadImpact,
        result:
          workloadDirection(workloadImpact) === "improved"
            ? "Improved"
            : workloadDirection(workloadImpact) === "regressed"
              ? "Regressed"
              : "Unchanged",
      },
    };
  }

  function categoryToResult(category) {
    const normalized = String(category || "").toLowerCase();
    if (normalized.includes("improved")) {
      return "Improved";
    }
    if (normalized.includes("regressed")) {
      return "Regressed";
    }
    if (normalized.includes("unchanged")) {
      return "Unchanged";
    }
    return null;
  }

  function parseSummary(summaryNode) {
    const workloadNode = firstChild(summaryNode, "workload");
    const workloadBefore = toNumber(firstChild(workloadNode, "b")?.textContent);
    const workloadAfter = toNumber(firstChild(workloadNode, "a")?.textContent);

    const impacts = {};
    childElements(firstChild(summaryNode, "impacts"), "impact").forEach((impactNode) => {
      const type = impactNode.getAttribute("type") || "unknown";
      impacts[type] = {
        value: toNumber(impactNode.textContent),
        sqlCount: toNumber(impactNode.getAttribute("sql_count")),
        planChangeCount: toNumber(impactNode.getAttribute("plan_change_count")),
      };
    });

    const statements = childElements(summaryNode, "statements").map((node) => ({
      category: node.getAttribute("category") || "",
      sqlCount: toNumber(node.getAttribute("sql_count")),
      rows: childElements(node, "object").map(parseStatementNode),
    }));

    const categories = {};
    statements.forEach((entry) => {
      categories[entry.category || "__all__"] = entry;
    });

    const errors = childElements(firstChild(summaryNode, "errors"), "error").map((node) => ({
      objectId: node.getAttribute("object_id") || "",
      sqlId: node.getAttribute("sql_id") || "",
      message: node.textContent.trim(),
    }));

    const errorGroups = childElements(firstChild(summaryNode, "error_groups"), "error_group").map((node) => ({
      code: node.getAttribute("code") || "",
      sqlCount: toNumber(node.getAttribute("sql_count")),
      message: node.textContent.trim(),
    }));

    const unsupported = childElements(firstChild(summaryNode, "unsupported"), "sql_text").map((node) => ({
      objectId: node.getAttribute("object_id") || "",
      sqlId: node.getAttribute("sql_id") || "",
      sqlText: node.textContent.trim(),
    }));

    const timeouts = childElements(firstChild(summaryNode, "timeouts"), "timeout").map((node) => ({
      objectId: node.getAttribute("object_id") || "",
      sqlId: node.getAttribute("sql_id") || "",
      message: node.textContent.trim(),
    }));

    return {
      workloadBefore,
      workloadAfter,
      orderBy: firstChild(summaryNode, "order_by")?.textContent ?? "",
      impacts,
      statements,
      categories,
      errors,
      errorGroups,
      unsupported,
      timeouts,
      unsupportedCount: toNumber(firstChild(summaryNode, "unsupported")?.getAttribute("count")),
      timeoutCount: toNumber(firstChild(summaryNode, "timeouts")?.getAttribute("count")),
      allSqlCount: categories.__all__?.sqlCount ?? null,
    };
  }

  function parseStatMap(node) {
    const stats = {};
    childElements(node, "stat").forEach((statNode) => {
      const name = statNode.getAttribute("name") || "";
      if (!name) {
        return;
      }
      stats[name] = {
        before: firstChild(statNode, "b")?.textContent ?? "",
        after: firstChild(statNode, "a")?.textContent ?? "",
        statementImpact: toNumber(statNode.getAttribute("sImp")),
        workloadImpact: toNumber(statNode.getAttribute("wImp")),
      };
    });
    return stats;
  }

  function parsePlanHashes(plansNode) {
    const plans = {};
    childElements(plansNode, "plan").forEach((planNode) => {
      const type = planNode.getAttribute("type") || "";
      const infos = {};
      planNode.querySelectorAll("info").forEach((infoNode) => {
        const key = infoNode.getAttribute("type") || "";
        if (key) {
          infos[key] = infoNode.textContent ?? "";
        }
      });
      if (type) {
        const operations = childElements(planNode, "operation").map((operationNode) => ({
          id: operationNode.getAttribute("id") || "",
          depth: toNumber(operationNode.getAttribute("depth")),
          pos: toNumber(operationNode.getAttribute("pos")),
          name: operationNode.getAttribute("name") || "",
          options: operationNode.getAttribute("options") || "",
          objectOwner: operationNode.getAttribute("object_owner") || "",
          objectName: operationNode.getAttribute("object_name") || "",
          cardinality: toNumber(firstChild(operationNode, "card")?.textContent),
          cost: toNumber(firstChild(operationNode, "cost")?.textContent),
        }));
        plans[type] = {
          hash: planNode.getAttribute("hash") || "",
          adaptive: /^yes$/i.test(infos.adaptive_plan || ""),
          planHash: infos.plan_hash || planNode.getAttribute("hash") || "",
          planHashFull: infos.plan_hash_full || "",
          operations,
        };
      }
    });
    return plans;
  }

  function parseSqlDetailReport(reportNode) {
    const bodyNode = firstChild(reportNode, "body");
    const objectNode = firstChild(bodyNode, "object");
    if (!objectNode) {
      return null;
    }

    const sqlNode = firstChild(objectNode, "sql");
    const sqlProperties = propertiesToMap(sqlNode);
    const stats = parseStatMap(firstChild(objectNode, "stats"));
    const findings = childElements(firstChild(objectNode, "findings"), "fnd").map((node) => ({
      type: node.getAttribute("type") || "",
      impact: toNumber(node.getAttribute("impact")),
      text: node.textContent.trim(),
    }));
    const plans = parsePlanHashes(firstChild(objectNode, "plans"));

    const metricStats = {};
    Object.entries(stats).forEach(([name, stat]) => {
      const metricKey =
        name === "elapsed_time"
          ? "ELAPSED_TIME"
          : name === "cpu_time"
            ? "CPU_TIME"
            : name === "buffer_gets"
              ? "BUFFER_GETS"
              : name === "cost"
                ? "OPTIMIZER_COST"
                : name.toUpperCase();
      metricStats[metricKey] = stat;
    });

    const findingTexts = findings.map((finding) => finding.text);
    return {
      objectId: objectNode.getAttribute("id") || "",
      sqlId: sqlNode?.getAttribute("id") || "",
      schema: sqlProperties.schema || "",
      sqlText: sqlProperties.text || "",
      shortSqlText: shortenSql(sqlProperties.text || "", 140),
      frequency: toNumber(sqlProperties.frequency),
      metrics: metricStats,
      findings,
      findingTexts,
      planChanged: findingTexts.some((text) => /execution plan has changed/i.test(text)),
      resultChanged: findingTexts.some((text) => /result set .* different/i.test(text)),
      adaptivePlan:
        findingTexts.some((text) => /adaptive/i.test(text)) ||
        Object.values(plans).some((plan) => plan.adaptive),
      plans,
    };
  }

  function summarizeOperation(operation) {
    const parts = [operation.name];
    if (operation.options) {
      parts.push(operation.options);
    }
    if (operation.objectOwner || operation.objectName) {
      parts.push([operation.objectOwner, operation.objectName].filter(Boolean).join("."));
    }
    return parts.filter(Boolean).join(" ");
  }

  function buildPlanChangeSummary(plans) {
    const beforePlan = plans?.before;
    const afterPlan = plans?.after;
    if (!beforePlan && !afterPlan) {
      return {
        hashChange: false,
        summary: "No detailed execution plan was embedded in this SPA report.",
      };
    }
    if (!beforePlan || !afterPlan) {
      return {
        hashChange: false,
        summary: "Only one side of the execution plan is visible in the SPA report.",
      };
    }

    const beforeOps = (beforePlan.operations || []).slice(0, 12).map(summarizeOperation);
    const afterOps = (afterPlan.operations || []).slice(0, 12).map(summarizeOperation);
    const hashChange = beforePlan.planHash !== afterPlan.planHash;
    const leadingOpsChanged = beforeOps.join(" | ") !== afterOps.join(" | ");

    if (!hashChange) {
      return {
        hashChange: false,
        summary: `Plan hash is unchanged (${beforePlan.planHash || beforePlan.hash || "n/a"}).`,
      };
    }

    if (leadingOpsChanged) {
      return {
        hashChange: true,
        summary: `Plan hash changed from ${beforePlan.planHash || beforePlan.hash || "n/a"} to ${afterPlan.planHash || afterPlan.hash || "n/a"}, and the visible leading operations also changed.`,
      };
    }

    return {
      hashChange: true,
      summary: `Plan hash changed from ${beforePlan.planHash || beforePlan.hash || "n/a"} to ${afterPlan.planHash || afterPlan.hash || "n/a"}, but the leading operations visible in the embedded plan remain broadly similar.`,
    };
  }

  function classifySqlOrigin(schema, sqlText) {
    const normalizedSchema = String(schema || "").trim().toUpperCase();
    const normalizedText = String(sqlText || "").toUpperCase();

    if (SYSTEM_SCHEMAS.has(normalizedSchema)) {
      if (normalizedSchema === "DBSNMP" || normalizedSchema === "EMAGENT") {
        return {
          group: "system",
          label: "Enterprise Manager monitoring / background workload",
          reason: `${normalizedSchema} schema`,
        };
      }
      return {
        group: "system",
        label: "System workload",
        reason: `${normalizedSchema} schema`,
      };
    }

    if (
      /DBA_SCHEDULER_/.test(normalizedText) ||
      /\bGV\$/.test(normalizedText) ||
      /\bV\$/.test(normalizedText) ||
      /AVERAGE ACTIVE SESSIONS/.test(normalizedText) ||
      /SESSION COUNT/.test(normalizedText)
    ) {
      return {
        group: "system",
        label: "Enterprise Manager monitoring / background workload",
        reason: "References scheduler or dynamic performance views",
      };
    }

    return {
      group: "application",
      label: normalizedSchema ? `${normalizedSchema} application workload` : "Application workload",
      reason: normalizedSchema ? `${normalizedSchema} schema` : "Non-system SQL",
    };
  }

  function buildReportSignature(report) {
    return [
      report.task.id,
      report.currentExecution.id,
      report.metric,
      report.beforeExecution.id,
      report.afterExecution.id,
    ].join("|");
  }

  function parseSpaReport(file) {
    const root = extractXmlModel(file.html);
    const head = firstChild(root, "head");
    const taskNode = firstChild(head, "task");
    const currentExecution = parseExecution(taskNode?.querySelector('execution[label="current"]'));
    const compareNode = firstChild(head, "compare");
    const beforeExecution = parseExecution(compareNode?.querySelector('execution[label="before"]'));
    const afterExecution = parseExecution(compareNode?.querySelector('execution[label="after"]'));
    const metric = normalizeMetric(firstChild(compareNode, "metric")?.textContent);

    const nestedReports = childElements(root, "report")
      .map(parseSqlDetailReport)
      .filter(Boolean);
    const sqlDetails = [];
    const seenObjectIds = new Set();
    nestedReports.forEach((detail) => {
      if (!detail.objectId || seenObjectIds.has(detail.objectId)) {
        return;
      }
      seenObjectIds.add(detail.objectId);
      sqlDetails.push(detail);
    });

    return {
      fileName: file.name,
      task: {
        id: taskNode?.getAttribute("id") || "",
        ...propertiesToMap(taskNode),
      },
      sqlset: propertiesToMap(firstChild(head, "sqlset")),
      currentExecution,
      beforeExecution,
      afterExecution,
      metric,
      summary: parseSummary(firstChild(root, "summary")),
      sqlDetails,
      signature: buildReportSignature({
        task: { id: taskNode?.getAttribute("id") || "" },
        currentExecution,
        beforeExecution,
        afterExecution,
        metric,
      }),
    };
  }

  function summarizeMetric(report) {
    const summary = report.summary;
    const categories = summary.categories;
    const improved = categories["with Improved Performance"]?.sqlCount ?? summary.impacts.improve?.sqlCount ?? 0;
    const regressed = categories["with Regressed Performance"]?.sqlCount ?? summary.impacts.regress?.sqlCount ?? 0;
    const unchanged = categories["with Unchanged Performance"]?.sqlCount ?? summary.impacts.unchange?.sqlCount ?? 0;
    const changedPlans = categories["with Changed Plans"]?.sqlCount ?? summary.impacts.overall?.planChangeCount ?? 0;
    const missing = categories.Missing?.sqlCount ?? 0;
    const newSql = categories.New?.sqlCount ?? 0;
    const executionUnsupported = Math.max(report.beforeExecution?.unsupported || 0, report.afterExecution?.unsupported || 0);
    const executionErrors = Math.max(report.beforeExecution?.errCount || 0, report.afterExecution?.errCount || 0);
    const unsupportedCount = Math.max(summary.unsupportedCount || 0, executionUnsupported);

    const notes = [];
    if ((summary.unsupportedCount || 0) !== executionUnsupported) {
      notes.push(
        `Summary section shows ${summary.unsupportedCount || 0} unsupported SQL, while execution metadata shows ${executionUnsupported}.`
      );
    }
    if ((summary.errors.length || 0) !== executionErrors && executionErrors > 0) {
      notes.push(
        `Summary section lists ${summary.errors.length} SQL errors, while execution metadata shows ${executionErrors}.`
      );
    }

    return {
      metric: report.metric,
      fileName: report.fileName,
      workloadBefore: summary.workloadBefore,
      workloadAfter: summary.workloadAfter,
      overallImpact: summary.impacts.overall?.value ?? null,
      sqlCount: summary.impacts.overall?.sqlCount ?? summary.allSqlCount ?? null,
      improved,
      regressed,
      unchanged,
      changedPlans,
      errors: Math.max(summary.errors.length, executionErrors),
      unsupported: unsupportedCount,
      missing,
      newSql,
      beforeExecution: report.beforeExecution,
      afterExecution: report.afterExecution,
      currentExecution: report.currentExecution,
      notes,
    };
  }

  function mergeSqlDetails(reports, metricSummaries) {
    const sqlMap = new Map();
    const metricSummaryByMetric = Object.fromEntries(
      (metricSummaries || []).map((metricSummary) => [normalizeMetric(metricSummary.metric), metricSummary])
    );

    reports.forEach((report) => {
      report.sqlDetails.forEach((detail) => {
        const existing = sqlMap.get(detail.sqlId) || {
          sqlId: detail.sqlId,
          schema: detail.schema,
          sqlText: detail.sqlText,
          shortSqlText: detail.shortSqlText,
          frequency: detail.frequency || 0,
          objectIds: [],
          metrics: {},
          findings: [],
          planChanged: false,
          adaptivePlan: false,
          resultChanged: false,
          plans: {},
        };

        existing.schema = existing.schema || detail.schema;
        existing.sqlText = existing.sqlText || detail.sqlText;
        existing.shortSqlText = shortenSql(existing.sqlText || detail.sqlText, 140);
        existing.frequency = Math.max(existing.frequency || 0, detail.frequency || 0);
        if (detail.objectId && !existing.objectIds.includes(detail.objectId)) {
          existing.objectIds.push(detail.objectId);
        }
        detail.findingTexts.forEach((findingText) => {
          if (findingText && !existing.findings.includes(findingText)) {
            existing.findings.push(findingText);
          }
        });

        const classification = classifySqlOrigin(existing.schema, existing.sqlText);
        existing.classification = classification;
        existing.planChanged = existing.planChanged || detail.planChanged;
        existing.adaptivePlan = existing.adaptivePlan || detail.adaptivePlan;
        existing.resultChanged = existing.resultChanged || detail.resultChanged;
        existing.plans = {
          ...existing.plans,
          ...detail.plans,
        };

        const metricStat =
          detail.metrics[report.metric] ||
          detail.metrics[normalizeMetric(report.metric)] ||
          detail.metrics[report.metric.toUpperCase()];
        const summaryStatement =
          report.summary.categories.__all__?.rows.find((row) => row.sqlId === detail.sqlId) ||
          report.summary.categories["with Improved Performance"]?.rows.find((row) => row.sqlId === detail.sqlId) ||
          report.summary.categories["with Regressed Performance"]?.rows.find((row) => row.sqlId === detail.sqlId) ||
          report.summary.categories["with Unchanged Performance"]?.rows.find((row) => row.sqlId === detail.sqlId) ||
          null;
        const summaryCategory =
          report.summary.categories["with Improved Performance"]?.rows.some((row) => row.sqlId === detail.sqlId)
            ? "with Improved Performance"
            : report.summary.categories["with Regressed Performance"]?.rows.some((row) => row.sqlId === detail.sqlId)
              ? "with Regressed Performance"
              : report.summary.categories["with Unchanged Performance"]?.rows.some((row) => row.sqlId === detail.sqlId)
                ? "with Unchanged Performance"
                : "";
        const summaryResult = categoryToResult(summaryCategory);

        const statementImpact =
          metricStat?.statementImpact ??
          summaryStatement?.summaryMetric.statementImpact ??
          null;
        const workloadImpact =
          metricStat?.workloadImpact ??
          summaryStatement?.summaryMetric.workloadImpact ??
          null;

        existing.metrics[report.metric] = {
          metric: report.metric,
          before: metricStat?.before ?? summaryStatement?.summaryMetric.before ?? "",
          after: metricStat?.after ?? summaryStatement?.summaryMetric.after ?? "",
          statementImpact,
          workloadImpact,
          planChanged: detail.planChanged || summaryStatement?.planChanged || false,
          rawResult:
            summaryResult ||
            (workloadDirection(workloadImpact) === "improved"
              ? "Improved"
              : workloadDirection(workloadImpact) === "regressed"
                ? "Regressed"
                : "Unchanged"),
          result:
            summaryResult ||
            (workloadDirection(workloadImpact) === "improved"
              ? "Improved"
              : workloadDirection(workloadImpact) === "regressed"
                ? "Regressed"
                : "Unchanged"),
          executionPair: `${report.beforeExecution?.name || "Before"} -> ${report.afterExecution?.name || "After"}`,
          reportFile: report.fileName,
          summaryCategory,
        };

        sqlMap.set(detail.sqlId, existing);
      });
    });

    return Array.from(sqlMap.values()).map((sql) => {
      const finalizedMetrics = Object.fromEntries(
        Object.entries(sql.metrics).map(([metricName, entry]) => [
          metricName,
          {
            ...entry,
            ...evaluateMetricMateriality(entry, sql, metricSummaryByMetric),
          },
        ])
      );

      return {
        ...sql,
        metrics: finalizedMetrics,
        result: aggregateResult(finalizedMetrics),
        maxWorkloadImpact: Object.values(finalizedMetrics).reduce((max, entry) => {
          if (!entry.isMaterial) {
            return max;
          }
          const magnitude = Math.abs(entry.workloadImpact || 0);
          return Math.max(max, magnitude);
        }, 0),
        planSummary: buildPlanChangeSummary(sql.plans),
      };
    });
  }

  function buildExecutionNotes(metricSummaries, duplicateReports) {
    const notes = [];
    const pairMap = new Map();

    metricSummaries.forEach((metricSummary) => {
      const key = [
        metricSummary.beforeExecution?.id || "",
        metricSummary.afterExecution?.id || "",
      ].join("|");
      const existing = pairMap.get(key) || {
        beforeName: metricSummary.beforeExecution?.name || "",
        afterName: metricSummary.afterExecution?.name || "",
        afterType: metricSummary.afterExecution?.type || "",
        metrics: [],
      };
      existing.metrics.push(metricSummary.metric);
      pairMap.set(key, existing);
    });

    if (pairMap.size > 1) {
      notes.push(
        "The supplied reports do not all compare the same after execution. Cost uses the explain-plan run, while runtime metrics use the post-change test-execute run."
      );
    }

    pairMap.forEach((value) => {
      notes.push(
        `${value.beforeName || "Before"} -> ${value.afterName || "After"} (${value.afterType || "Unknown type"}) covers ${value.metrics
          .sort(compareMetricPriority)
          .map(metricLabel)
          .join(", ")}.`
      );
    });

    duplicateReports.forEach((duplicate) => {
      notes.push(
        `Duplicate ${metricLabel(duplicate.metric)} report ignored: ${duplicate.fileName}.`
      );
    });

    return notes;
  }

  function buildErrorThemes(reports) {
    const grouped = new Map();
    (reports || []).forEach((report) => {
      (report.summary?.errorGroups || []).forEach((group) => {
        const key = `${group.code || ""}|${group.message || ""}`;
        const existing = grouped.get(key) || {
          code: group.code || "",
          message: group.message || "",
          sqlCount: 0,
        };
        existing.sqlCount = Math.max(existing.sqlCount, group.sqlCount || 0);
        grouped.set(key, existing);
      });
    });
    return Array.from(grouped.values()).sort((left, right) => {
      if ((right.sqlCount || 0) !== (left.sqlCount || 0)) {
        return (right.sqlCount || 0) - (left.sqlCount || 0);
      }
      return String(left.code || "").localeCompare(String(right.code || ""));
    }).map((theme) => ({
      ...theme,
      likelyCause: likelyCauseForErrorTheme(theme),
    }));
  }

  function likelyCauseForErrorTheme(theme) {
    const code = String(theme?.code || "").toUpperCase();
    const message = String(theme?.message || "").toUpperCase();

    if (code.includes("ORA-01400") || /CANNOT INSERT NULL/i.test(message)) {
      return "likely missing required column values or invalid test data setup";
    }
    if (code.includes("ORA-01407") || /CANNOT UPDATE .* TO NULL/i.test(message)) {
      return "likely null updates into non-null columns or invalid application state";
    }
    if (code.includes("ORA-00001") || /UNIQUE CONSTRAINT/i.test(message)) {
      return "likely duplicate-key/data-reset issues rather than a performance problem";
    }
    if (code.includes("ORA-02291") || /INTEGRITY CONSTRAINT .* PARENT KEY NOT FOUND/i.test(message)) {
      return "likely missing parent rows or incomplete referential test data";
    }
    if (code.includes("ORA-02292") || /CHILD RECORD FOUND/i.test(message)) {
      return "likely delete-order or referential cleanup issues in test setup";
    }
    if (code.includes("ORA-06502")) {
      return "likely PL/SQL conversion or value-size issues in application logic or bind data";
    }
    if (code.includes("ORA-06512")) {
      return "likely procedural PL/SQL execution failure; inspect the paired application error";
    }
    if (code.includes("ORA-00942")) {
      return "likely missing object privileges or object-state differences between runs";
    }
    if (code.includes("ORA-01031")) {
      return "likely privilege differences between the compared executions";
    }
    if (code.includes("ORA-04098")) {
      return "likely invalid trigger or dependent object state";
    }
    if (code.includes("ORA-04068") || code.includes("ORA-04061")) {
      return "likely invalidated PL/SQL package state between executions";
    }
    return "";
  }

  function buildUnsupportedAssessment(reports) {
    const unsupportedRows = [];
    (reports || []).forEach((report) => {
      (report.summary?.unsupported || []).forEach((row) => {
        if (!unsupportedRows.some((existing) => existing.sqlId === row.sqlId && existing.sqlText === row.sqlText)) {
          unsupportedRows.push(row);
        }
      });
    });

    if (!unsupportedRows.length) {
      return { total: 0, note: "", brief: "" };
    }

    const plsqlRows = unsupportedRows.filter((row) => /^(BEGIN|DECLARE|CALL)\b/i.test(String(row.sqlText || "").trim()));
    const instrumentationRows = unsupportedRows.filter((row) =>
      /\bDBMS_APPLICATION_INFO\b|\bDBMS_SESSION\b/i.test(String(row.sqlText || ""))
    );
    const appPackageRows = unsupportedRows.filter((row) => /\bORDERENTRY\./i.test(String(row.sqlText || "")));

    if (plsqlRows.length === unsupportedRows.length) {
      return {
        total: unsupportedRows.length,
        note:
          ` Unsupported SQL appears to be mostly PL/SQL-style calls${
            appPackageRows.length > 0 ? " (including ORDERENTRY package calls)" : ""
          }${instrumentationRows.length > 0 ? " plus instrumentation such as DBMS_APPLICATION_INFO" : ""}.`,
        brief: instrumentationRows.length > 0
          ? "Unsupported items are mostly PL/SQL calls and instrumentation."
          : "Unsupported items are mostly PL/SQL-style calls.",
      };
    }

    if (instrumentationRows.length === unsupportedRows.length) {
      return {
        total: unsupportedRows.length,
        note: " Unsupported SQL appears to be limited to instrumentation or session-state calls.",
        brief: "Unsupported items are primarily instrumentation calls.",
      };
    }

    return { total: unsupportedRows.length, note: "", brief: "" };
  }

  function buildWorkloadValidity(metricSummaries, reports, sqlset) {
    const totalSql =
      toNumber(sqlset?.sql_count) ||
      metricSummaries.reduce((max, metric) => Math.max(max, metric.sqlCount || 0), 0) ||
      0;
    const beforeErrors = reports.reduce((max, report) => Math.max(max, report.beforeExecution?.err_count || 0), 0);
    const afterErrors = reports.reduce((max, report) => Math.max(max, report.afterExecution?.err_count || 0), 0);
    const beforeUnsupported = reports.reduce((max, report) => Math.max(max, report.beforeExecution?.unsupported || 0), 0);
    const afterUnsupported = reports.reduce((max, report) => Math.max(max, report.afterExecution?.unsupported || 0), 0);
    const unsupported = metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const errors = Math.max(beforeErrors, afterErrors, metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0));
    const missing = metricSummaries.reduce((max, metric) => Math.max(max, metric.missing || 0), 0);
    const newSql = metricSummaries.reduce((max, metric) => Math.max(max, metric.newSql || 0), 0);
    const mixedExecutionPairs =
      new Set((reports || []).map((report) => `${report.beforeExecution?.id || ""}|${report.afterExecution?.id || ""}`)).size > 1;
    const commonSql = Math.max(0, totalSql - missing - newSql);
    const comparableSql = Math.max(0, totalSql - Math.max(beforeUnsupported, afterUnsupported, unsupported) - errors - missing - newSql);
    const successfulBefore = Math.max(0, totalSql - beforeErrors - beforeUnsupported);
    const successfulAfter = Math.max(0, totalSql - afterErrors - afterUnsupported);
    const commonPct = totalSql > 0 ? (commonSql / totalSql) * 100 : null;
    const comparablePct = totalSql > 0 ? (comparableSql / totalSql) * 100 : null;

    let score = 100;
    score -= Math.min(35, errors * 4);
    score -= Math.min(25, Math.max(beforeUnsupported, afterUnsupported, unsupported) * 2);
    score -= Math.min(20, (missing + newSql) * 3);
    if (mixedExecutionPairs) {
      score -= 15;
    }
    score = Math.max(0, score);

    let label = "High";
    if (score < 60) {
      label = "Low";
    } else if (score < 85) {
      label = "Medium";
    }

    const issues = [];
    if (errors > 0) {
      issues.push(`${errors} execution errors`);
    }
    if (Math.max(beforeUnsupported, afterUnsupported, unsupported) > 0) {
      issues.push(`${Math.max(beforeUnsupported, afterUnsupported, unsupported)} unsupported SQL`);
    }
    if (missing + newSql > 0) {
      issues.push(`${missing + newSql} non-common statements`);
    }
    if (mixedExecutionPairs) {
      issues.push("mixed execution pairs");
    }

    return {
      score,
      label,
      totalSql,
      commonSql,
      commonPct,
      comparableSql,
      comparablePct,
      successfulBefore,
      successfulAfter,
      beforeErrors,
      afterErrors,
      beforeUnsupported,
      afterUnsupported,
      unsupported: Math.max(beforeUnsupported, afterUnsupported, unsupported),
      missing,
      newSql,
      mixedExecutionPairs,
      isClean: issues.length === 0,
      reason: issues.length
        ? `Comparison validity is reduced by ${issues.join(", ")}.`
        : "Before/after workload coverage is clean and comparable.",
    };
  }

  function buildTopLinePerformance(metricSummaries) {
    const runtimeMetrics = metricSummaries
      .filter((metric) => !NON_DECISION_METRICS.has(normalizeMetric(metric.metric)))
      .slice()
      .sort((left, right) => compareSummaryMetricPriority(left.metric, right.metric));
    const elapsedMetric = runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "ELAPSED_TIME");
    const cpuMetric = runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "CPU_TIME");
    const ioMetrics = runtimeMetrics.filter((metric) => runtimeMetricClass(metric.metric) === "io");
    const ioRegressions = ioMetrics.filter((metric) => workloadDirection(metric.overallImpact) === "regressed");
    const ioImprovements = ioMetrics.filter((metric) => workloadDirection(metric.overallImpact) === "improved");

    let label = "Mixed runtime result";
    let tone = "amber";
    let metric = elapsedMetric || cpuMetric || runtimeMetrics[0] || null;
    if (elapsedMetric) {
      const direction = workloadDirection(elapsedMetric.overallImpact);
      if (direction === "regressed") {
        label = `Elapsed Time regressed ${formatFixedNumber(Math.abs(elapsedMetric.overallImpact || 0), 2)}%`;
        tone = "red";
      } else if (direction === "improved") {
        label = `Elapsed Time improved ${formatFixedNumber(Math.abs(elapsedMetric.overallImpact || 0), 2)}%`;
        tone = "green";
      } else {
        label = "Elapsed Time is effectively unchanged";
      }
    }

    let reason = metric
      ? `${metricLabel(metric.metric)} changed from ${formatWorkloadValue(metric.metric, metric.workloadBefore)} to ${formatWorkloadValue(metric.metric, metric.workloadAfter)}.`
      : "No runtime metric was available for top-line diagnosis.";

    if (elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "regressed") {
      if (ioRegressions.length > 0) {
        reason += ` Supporting I/O regression is visible in ${ioRegressions
          .slice()
          .sort((left, right) => compareSummaryMetricPriority(left.metric, right.metric))
          .map((entry) => metricLabel(entry.metric))
          .join(", ")}.`;
      }
      if (cpuMetric && workloadDirection(cpuMetric.overallImpact) === "improved") {
        reason += " CPU Time does not regress in the same direction, so the slowdown is not explained by CPU alone.";
      }
    } else if (elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "improved" && ioImprovements.length > 0) {
      reason += ` Supporting improvement is also visible in ${ioImprovements
        .slice()
        .sort((left, right) => compareSummaryMetricPriority(left.metric, right.metric))
        .map((entry) => metricLabel(entry.metric))
        .join(", ")}.`;
    }

    return {
      label,
      tone,
      metric,
      reason,
    };
  }

  function summarizeRuntimeSignals(metricSummaries) {
    const runtimeMetrics = metricSummaries
      .filter((metric) => !NON_DECISION_METRICS.has(normalizeMetric(metric.metric)))
      .slice()
      .sort((left, right) => compareSummaryMetricPriority(left.metric, right.metric));
    const runtimeRegressions = runtimeMetrics.filter((metric) => workloadDirection(metric.overallImpact) === "regressed");
    const runtimeImprovements = runtimeMetrics.filter((metric) => workloadDirection(metric.overallImpact) === "improved");
    const significantRuntimeRegressions = runtimeMetrics.filter((metric) => {
      const metricClass = runtimeMetricClass(metric.metric);
      if (!Number.isFinite(metric.overallImpact) || metric.overallImpact >= 0) {
        return false;
      }
      if (metricClass === "elapsed") {
        return Math.abs(metric.overallImpact) >= MATERIALITY_RULES.elapsedRuntimeMajorPct;
      }
      if (metricClass === "cpu") {
        return Math.abs(metric.overallImpact) >= MATERIALITY_RULES.cpuRuntimeMajorPct;
      }
      return Math.abs(metric.overallImpact) >= MATERIALITY_RULES.ioRuntimeMajorPct;
    });
    const hasConsistentMajorRuntimeImprovement =
      ["ELAPSED_TIME", "CPU_TIME"].every((metricName) =>
        runtimeMetrics.some(
          (metric) => normalizeMetric(metric.metric) === metricName && workloadDirection(metric.overallImpact) === "improved"
        )
      ) &&
      runtimeMetrics.some((metric) =>
        ["BUFFER_GETS", "DISK_READS", "USER_IO_TIME", "IO_INTERCONNECT_BYTES", "PHYSICAL I/OS", "PHYSICAL_I_OS"].includes(
          normalizeMetric(metric.metric)
        ) && workloadDirection(metric.overallImpact) === "improved"
      ) &&
      runtimeRegressions.length === 0;

    return {
      runtimeMetrics,
      runtimeRegressions,
      runtimeImprovements,
      significantRuntimeRegressions,
      hasConsistentMajorRuntimeImprovement,
    };
  }

  function buildSignalStrengthAssessment(metricSummaries, applicationSql) {
    const runtime = summarizeRuntimeSignals(metricSummaries);
    const elapsedMetric = runtime.runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "ELAPSED_TIME");
    const cpuMetric = runtime.runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "CPU_TIME");
    const ioMetrics = runtime.runtimeMetrics.filter((metric) =>
      ["BUFFER_GETS", "DISK_READS", "USER_IO_TIME", "IO_INTERCONNECT_BYTES", "PHYSICAL I/OS", "PHYSICAL_I_OS"].includes(
        normalizeMetric(metric.metric)
      )
    );
    const ioImprovement = ioMetrics.some((metric) => workloadDirection(metric.overallImpact) === "improved");
    const ioRegression = ioMetrics.some((metric) => workloadDirection(metric.overallImpact) === "regressed");
    const maxErrors = metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const hasCoverageGap = maxErrors > 0 || maxUnsupported > 0 || runtime.runtimeMetrics.length === 0;
    const hasMaterialSqlRegression = (applicationSql || []).some((sql) => sql.result === "Regressed");
    const hasMaterialSqlDriver = (applicationSql || []).some((sql) => sql.result === "Regressed");
    const hasNonRuntimeImprovement = metricSummaries.some(
      (metric) => NON_DECISION_METRICS.has(normalizeMetric(metric.metric)) && workloadDirection(metric.overallImpact) === "improved"
    );
    const elapsedImproves = elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "improved";
    const cpuImproves = cpuMetric && workloadDirection(cpuMetric.overallImpact) === "improved";
    const elapsedStrongRegression =
      elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "regressed" && Math.abs(elapsedMetric.overallImpact || 0) >= 20;
    const cpuStrongRegression =
      cpuMetric && workloadDirection(cpuMetric.overallImpact) === "regressed" && Math.abs(cpuMetric.overallImpact || 0) >= 20;
    const otherMajorRuntimeRegressionCount =
      runtime.runtimeRegressions.filter((metric) => !["ELAPSED_TIME", "CPU_TIME"].includes(normalizeMetric(metric.metric))).length +
      (elapsedStrongRegression ? 1 : 0) +
      (cpuStrongRegression ? 1 : 0);

    if (runtime.runtimeMetrics.length === 0) {
      return {
        label: "Weak / Conflicting signal",
        tone: "amber",
        reason: "Missing runtime metrics reduce interpretability of the workload signal.",
      };
    }

    if (
      elapsedImproves &&
      cpuImproves &&
      ioImprovement &&
      !hasMaterialSqlRegression &&
      runtime.runtimeRegressions.length === 0
    ) {
      return {
        label: "Strong improvement signal",
        tone: "green",
        reason: "Elapsed time, CPU, and at least one major I/O metric all improve consistently with no conflicting runtime regressions.",
      };
    }

    if ((elapsedStrongRegression || cpuStrongRegression) && otherMajorRuntimeRegressionCount >= 2 && runtime.runtimeImprovements.length === 0) {
      return {
        label: "Strong regression signal",
        tone: "red",
        reason: "Elapsed time or CPU regresses significantly and at least one other major runtime metric regresses in the same direction.",
      };
    }

    if (
      (runtime.significantRuntimeRegressions.length > 0 && !hasMaterialSqlDriver) ||
      (runtime.runtimeRegressions.length > 0 && hasNonRuntimeImprovement) ||
      (runtime.runtimeRegressions.length > 0 && runtime.runtimeImprovements.length > 0)
    ) {
      return {
        label: "Weak / Conflicting signal",
        tone: "amber",
        reason: "Runtime metrics conflict, or workload-level regression is significant without a clear SQL-level driver.",
      };
    }

    if (
      runtime.runtimeImprovements.length > 0 ||
      runtime.runtimeRegressions.length > 0 ||
      ioImprovement ||
      ioRegression
    ) {
      if (hasCoverageGap) {
        return {
          label: "Weak / Conflicting signal",
          tone: "amber",
          reason: "Coverage gaps and partial runtime movement reduce how confidently the workload signal can be interpreted.",
        };
      }
      return {
        label: "Moderate / Mixed signal",
        tone: "amber",
        reason: "Some runtime metrics improve while others regress, or the workload-level and SQL-level signals do not align cleanly.",
      };
    }

    return {
      label: "Weak / Conflicting signal",
      tone: "amber",
      reason: hasCoverageGap
        ? "Errors, unsupported SQL, or incomplete coverage reduce interpretability of the workload signal."
        : "The available runtime evidence is limited, noisy, or does not show a single clear direction.",
    };
  }

  function buildFinalInterpretation(applicationSql, metricSummaries, confidence) {
    const runtime = summarizeRuntimeSignals(metricSummaries);
    const sqlLevel = applicationSql.some((sql) => sql.result === "Regressed") ? "FAIL" : "PASS";

    const elapsedMetric = runtime.runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "ELAPSED_TIME");
    const cpuMetric = runtime.runtimeMetrics.find((metric) => normalizeMetric(metric.metric) === "CPU_TIME");
    const elapsedImproved = elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "improved";
    const cpuImproved = cpuMetric && workloadDirection(cpuMetric.overallImpact) === "improved";
    const elapsedRegressed =
      elapsedMetric && workloadDirection(elapsedMetric.overallImpact) === "regressed" && Math.abs(elapsedMetric.overallImpact || 0) >= 20;
    const cpuRegressed =
      cpuMetric && workloadDirection(cpuMetric.overallImpact) === "regressed" && Math.abs(cpuMetric.overallImpact || 0) >= 20;

    let workloadLevel;
    if (elapsedImproved && cpuImproved && runtime.significantRuntimeRegressions.length === 0) {
      workloadLevel = "IMPROVED";
    } else if (elapsedRegressed || cpuRegressed) {
      workloadLevel = "REGRESSED";
    } else {
      workloadLevel = "MIXED";
    }

    let finalDecision;
    if (sqlLevel === "PASS" && workloadLevel === "IMPROVED") {
      finalDecision = "PASS";
    } else if (sqlLevel === "FAIL" && workloadLevel === "REGRESSED") {
      finalDecision = "FAIL";
    } else {
      finalDecision = "WARN";
    }

    if (String(confidence?.label || "").toLowerCase() === "low" && finalDecision === "PASS") {
      finalDecision = "WARN";
    }

    let narrative;
    if (sqlLevel === "PASS" && workloadLevel === "IMPROVED") {
      narrative =
        "Workload performance improved consistently across all major runtime metrics.";
      if (finalDecision === "WARN") {
        narrative += " Confidence is low due to incomplete workload coverage, so the result should be treated as provisional.";
      }
    } else if (sqlLevel === "PASS" && workloadLevel === "REGRESSED") {
      narrative =
        "SQL-level performance is stable with no material regressions, but overall workload performance degraded significantly, indicating workload-level change without a clearly isolated material SQL driver.";
    } else if (sqlLevel === "PASS" && workloadLevel === "MIXED") {
      narrative =
        "No material SQL-level regression was detected, but workload-level metrics move in different directions, so the environment still requires investigation before sign-off.";
    } else if (sqlLevel === "FAIL" && workloadLevel === "IMPROVED") {
      narrative =
        "Overall workload metrics improved, but material SQL-level regression risk remains, so the change still needs SQL-focused follow-up before sign-off.";
    } else if (sqlLevel === "FAIL" && workloadLevel === "REGRESSED") {
      narrative =
        "Both SQL-level and workload-level evidence point to regression, making this a high-risk change from a performance perspective.";
    } else {
      narrative =
        "Conflicting signals between SQL-level results and workload-level behavior suggest environmental or execution differences that require further investigation.";
    }

    if (
      String(confidence?.label || "").toLowerCase() === "low" &&
      finalDecision !== "FAIL" &&
      !/confidence is low/i.test(narrative)
    ) {
      narrative += " Confidence is low due to incomplete workload coverage, so the result should be treated as provisional.";
    }

    return {
      sqlLevel,
      workloadLevel,
      confidence: confidence?.label || "Unknown",
      finalDecision,
      text: `SQL-level: ${sqlLevel} | Workload-level: ${workloadLevel} | Confidence: ${confidence?.label || "Unknown"} | Final Decision: ${finalDecision}`,
      narrative,
    };
  }

  function buildDominantSignal(applicationSql, systemSql, metricSummaries) {
    const runtime = summarizeRuntimeSignals(metricSummaries);
    const applicationRegression = applicationSql.some((sql) => sql.result === "Regressed");
    const monitoringRegression = systemSql.some((sql) => sql.result === "Regressed");

    if (applicationRegression) {
      return {
        label: "Material application SQL regression",
        detail: "Business SQL regression is the dominant signal and drives the outcome.",
      };
    }

    if (runtime.significantRuntimeRegressions.length > 0) {
      return {
        label: "Workload-level regression (no SQL driver)",
        detail: "Workload-level runtime metrics regress significantly without a clearly isolated material application SQL regression.",
      };
    }

    if (runtime.hasConsistentMajorRuntimeImprovement) {
      return {
        label: "Consistent runtime improvement",
        detail: "Elapsed time, CPU, and I/O all improve in the same direction.",
      };
    }

    if (monitoringRegression) {
      return {
        label: "Monitoring workload regression only",
        detail: "Measured regression is limited to system or monitoring SQL rather than business SQL.",
      };
    }

    return {
      label: "Mixed / limited workload signal",
      detail: "No single dominant runtime or SQL-level signal stands out.",
    };
  }

  function buildBottomLine(applicationSql, systemSql, metricSummaries, reports, workloadValidity, topLinePerformance) {
    const appRegressions = applicationSql.filter((sql) => sql.result === "Regressed");
    const appImprovements = applicationSql.filter((sql) => sql.result === "Improved");
    const systemRegressions = systemSql.filter((sql) => sql.result === "Regressed");
    const maxErrors = metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const beforeErrors = reports.reduce((max, report) => Math.max(max, report.beforeExecution?.err_count || 0), 0);
    const afterErrors = reports.reduce((max, report) => Math.max(max, report.afterExecution?.err_count || 0), 0);
    const beforeUnsupported = reports.reduce((max, report) => Math.max(max, report.beforeExecution?.unsupported || 0), 0);
    const afterUnsupported = reports.reduce((max, report) => Math.max(max, report.afterExecution?.unsupported || 0), 0);
    const runtimeSummary = summarizeRuntimeSignals(metricSummaries);
    const runtimeMetrics = runtimeSummary.runtimeMetrics;
    const hasRuntimeCoverage = runtimeMetrics.length > 0;
    const executionPairCount = new Set(
      reports.map((report) => `${report.beforeExecution?.id || ""}|${report.afterExecution?.id || ""}`)
    ).size;
    const hasCoverageCaveat = maxErrors > 0 || maxUnsupported > 0 || executionPairCount > 1 || !hasRuntimeCoverage;
    const runtimeRegressions = runtimeSummary.runtimeRegressions;
    const runtimeImprovements = runtimeSummary.runtimeImprovements;
    const nonRuntimeImprovements = metricSummaries.filter(
      (metric) => NON_DECISION_METRICS.has(normalizeMetric(metric.metric)) && workloadDirection(metric.overallImpact) === "improved"
    );
    const runtimeRegressionSummary = runtimeRegressions
      .slice()
      .sort((left, right) => compareMetricPriority(left.metric, right.metric))
      .map((metric) => metricLabel(metric.metric))
      .join(", ");
    const nonRuntimeImprovementSummary = nonRuntimeImprovements
      .slice()
      .sort((left, right) => compareMetricPriority(left.metric, right.metric))
      .map((metric) => metricLabel(metric.metric))
      .join(", ");

    let lead;
    if (appRegressions.length > 0 && !workloadValidity?.isClean) {
      lead = `FAIL: ${topLinePerformance?.label || "Elapsed Time regressed"} and at least one material application SQL regression is present, but workload comparison validity is ${String(workloadValidity?.label || "reduced").toLowerCase()}.`;
    } else if (appRegressions.length > 0) {
      lead = `FAIL: ${topLinePerformance?.label || "Elapsed Time regressed"} and at least one material application SQL regression is present in the supplied SPA results.`;
    } else if (!workloadValidity?.isClean) {
      lead = `WARN: workload comparison validity is ${String(workloadValidity?.label || "reduced").toLowerCase()} (${topLinePerformance?.label || "runtime result unavailable"}).`;
    } else if (runtimeSummary.significantRuntimeRegressions.length > 0 && nonRuntimeImprovements.length > 0) {
      lead = `WARN: ${topLinePerformance?.label || "Elapsed Time regressed"}, and workload-level runtime metrics (${runtimeRegressionSummary || "runtime metrics"}) still regress even though ${nonRuntimeImprovementSummary} improved.`;
    } else if (runtimeSummary.significantRuntimeRegressions.length > 0) {
      lead = `WARN: ${topLinePerformance?.label || "Elapsed Time regressed"}, but no material SQL-level regression was isolated.`;
    } else if (!hasCoverageCaveat && runtimeRegressions.length > 0 && runtimeImprovements.length === 0) {
      lead = `WARN: ${topLinePerformance?.label || "Elapsed Time regressed"}, although no material application SQL regression was isolated.`;
    } else if (!hasCoverageCaveat && appImprovements.length > 0 && systemRegressions.length > 0) {
      lead = `GO: ${topLinePerformance?.label || "Elapsed Time improved"}, and the remaining regressions are limited to monitoring SQL rather than business SQL.`;
    } else if (!hasCoverageCaveat && appImprovements.length > 0) {
      lead = `GO: ${topLinePerformance?.label || "Elapsed Time improved"}, with no material application-level regression detected.`;
    } else if (!hasCoverageCaveat) {
      lead = `GO: ${topLinePerformance?.label || "Runtime metrics remain stable"}, with no material application-level regression detected.`;
    } else if (appImprovements.length > 0 && systemRegressions.length > 0) {
      lead = `WARN: ${topLinePerformance?.label || "Runtime result is mixed"}, application SQL improved overall, but the evidence set is incomplete and residual regression is limited to monitoring workload.`;
    } else if (systemRegressions.length > 0) {
      lead = `WARN: ${topLinePerformance?.label || "Runtime result is mixed"}, no material application-level regression was detected, but the evidence set is incomplete.`;
    } else {
      lead = `WARN: ${topLinePerformance?.label || "Runtime result is mixed"}, but the evidence set is incomplete for a clean sign-off.`;
    }

    const caveats = [];
    const heroCaveats = [];
    if (maxErrors > 0) {
      caveats.push(`${maxErrors} SQL errors occurred during trial execution, which reduces comparison confidence.`);
      heroCaveats.push(`${beforeErrors} errors before and ${afterErrors} after reduce confidence`);
    }
    if (maxUnsupported > 0) {
      caveats.push(`${maxUnsupported} SQL statements were unsupported, so workload coverage is incomplete.`);
      heroCaveats.push(`${beforeUnsupported} unsupported before and ${afterUnsupported} after limit coverage`);
    }
    if (executionPairCount > 1) {
      caveats.push("Optimizer cost and runtime metrics were taken from different post-change executions.");
      heroCaveats.push("metrics come from different post-change executions");
    }
    if (!hasRuntimeCoverage) {
      caveats.push("Only optimizer-cost evidence is available, so runtime workload safety is not fully validated.");
      heroCaveats.push("runtime metrics are missing");
    }

    return {
      paragraph: [lead].concat(caveats).join(" "),
      heroText: heroCaveats.length ? `${lead} ${heroCaveats.join("; ")}.` : lead,
      noApplicationRegression: appRegressions.length === 0,
      applicationRegressions: appRegressions.length,
      systemRegressions: systemRegressions.length,
    };
  }

  function buildConfidenceAssessment(metricSummaries, reports, workloadValidity) {
    const hasRuntimeCoverage = metricSummaries.some((metric) => !NON_DECISION_METRICS.has(normalizeMetric(metric.metric)));
    if (!hasRuntimeCoverage) {
      return {
        label: "Low",
        tone: "red",
        score: 20,
        reason: "Only optimizer-cost evidence is available, so runtime workload safety is not fully validated.",
      };
    }

    if ((workloadValidity?.score ?? 100) < 60) {
      return {
        label: "Low",
        tone: "red",
        score: Math.max(0, Math.round((workloadValidity?.score ?? 40) * 0.7)),
        reason: workloadValidity?.reason || "Execution errors, unsupported SQL, or missing coverage reduce confidence.",
      };
    }

    if ((workloadValidity?.score ?? 100) < 85) {
      return {
        label: "Medium",
        tone: "amber",
        score: Math.round(workloadValidity?.score ?? 70),
        reason: workloadValidity?.reason || "The workload comparison is usable, but it is not fully clean or apples-to-apples.",
      };
    }

    return {
      label: "High",
      tone: "green",
      score: Math.round(workloadValidity?.score ?? 95),
      reason: workloadValidity?.reason || "The loaded metrics compare a consistent execution pair and no coverage gaps were reported.",
    };
  }

  function buildApplicationVerdict(applicationSql, metricSummaries, reports, workloadValidity, topLinePerformance) {
    const appRegressions = applicationSql.filter((sql) => sql.result === "Regressed");
    const appImprovements = applicationSql.filter((sql) => sql.result === "Improved");
    const maxErrors = metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const runtimeSummary = summarizeRuntimeSignals(metricSummaries);
    const mixedExecutionPairs =
      new Set(reports.map((report) => `${report.beforeExecution?.id || ""}|${report.afterExecution?.id || ""}`)).size > 1;
    const hasRuntimeCoverage = metricSummaries.some((metric) => !NON_DECISION_METRICS.has(normalizeMetric(metric.metric)));
    const hasCoverageCaveat = maxErrors > 0 || maxUnsupported > 0 || mixedExecutionPairs || !hasRuntimeCoverage;

    if (appRegressions.length > 0) {
      return {
        label: "Material application regression detected",
        score: 25,
        tone: "red",
        reason: `${topLinePerformance?.label || "Elapsed Time regressed"} and ${appRegressions.length} material application SQL statement(s) regress in the supplied runtime metrics.`,
      };
    }

    if (runtimeSummary.significantRuntimeRegressions.length > 0) {
      return {
        label: "No SQL-level regression detected, but workload performance regressed",
        score: 55,
        tone: "amber",
        reason: `${topLinePerformance?.label || "Elapsed Time regressed"}. No material application SQL regression is isolated, but workload-level elapsed time, CPU time, or I/O metrics regress significantly.`,
      };
    }

    if (appImprovements.length > 0 && !hasCoverageCaveat) {
      return {
        label: "Application workload improved",
        score: 90,
        tone: "green",
        reason: `${topLinePerformance?.label || "Elapsed Time improved"}. No material application regression is detected and at least one application SQL statement improves materially.`,
      };
    }

    if (!hasCoverageCaveat) {
      return {
        label: "No material application-level regression detected",
        score: 80,
        tone: "green",
        reason: `${topLinePerformance?.label || "Runtime metrics remain stable"}. No material application SQL statement is classified as regressed in the supplied runtime metrics.`,
      };
    }

    if (appImprovements.length > 0) {
      return {
        label: "Application improved, but evidence is incomplete",
        score: Math.min(65, Math.round((workloadValidity?.score ?? 65))),
        tone: "amber",
        reason: "Application SQL improves overall, but errors, unsupported SQL, missing runtime metrics, or mixed execution pairs reduce confidence.",
      };
    }

    return {
      label: "No material application regression detected, but evidence is incomplete",
      score: Math.min(60, Math.round((workloadValidity?.score ?? 60))),
      tone: "amber",
      reason: "No material application SQL regression is visible, but errors, unsupported SQL, missing runtime metrics, or mixed execution pairs limit confidence.",
    };
  }

  function verdictBadge(applicationVerdict) {
    if (applicationVerdict.tone === "green") {
      return {
        icon: "PASS",
        fg: "#166534",
        bg: "rgba(22, 101, 52, 0.12)",
      };
    }
    if (applicationVerdict.tone === "red") {
      return {
        icon: "FAIL",
        fg: "#991b1b",
        bg: "rgba(153, 27, 27, 0.12)",
      };
    }
    return {
      icon: "WARN",
      fg: "#92400e",
      bg: "rgba(146, 64, 14, 0.12)",
    };
  }

  function buildExecutiveBullets(summary) {
    const bullets = [];
    const appTop = summary.topApplicationRegressions[0] || summary.topImprovements.find((row) => row.sql.classification?.group === "application");
    const systemTop = summary.topRegressions.find((row) => row.sql.classification?.group === "system");
    const maxErrors = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const runtimeSummary = summarizeRuntimeSignals(summary.metricSummaries);
    const mixedExecutionPairs =
      new Set(summary.reports.map((report) => `${report.beforeExecution?.id || ""}|${report.afterExecution?.id || ""}`)).size > 1;
    const runtimeRegressions = runtimeSummary.runtimeRegressions;
    const nonRuntimeImprovements = summary.metricSummaries.filter(
      (metric) => NON_DECISION_METRICS.has(normalizeMetric(metric.metric)) && workloadDirection(metric.overallImpact) === "improved"
    );

    bullets.push(`Workload validity: ${summary.workloadValidity.label} (${summary.workloadValidity.score}/100). ${summary.workloadValidity.reason}`);
    bullets.push(`Top-line performance: ${summary.topLinePerformance.label}. ${summary.topLinePerformance.reason}`);
    if (maxErrors > 0 || maxUnsupported > 0) {
      bullets.push(
        `Confidence: ${summary.confidence.label}. ${maxErrors} SQL errors and ${maxUnsupported} unsupported SQL statements reduce workload coverage.`
      );
    } else {
      bullets.push(`Confidence: ${summary.confidence.label}. ${summary.confidence.reason}`);
    }

    if (summary.primaryDriver && appTop && summary.primaryDriver.sqlId === appTop.sqlId) {
      bullets.push(
        `Application workload: ${summary.bottomLine.noApplicationRegression ? "no material application-level regression detected" : "material application regression detected"}. Primary business driver is ${appTop.sqlId}, ${describeMetricChange(
          appTop.metricEntry,
          appTop.metricEntry?.result || appTop.sql.result
        ).toLowerCase()} on ${metricLabel(appTop.metricEntry?.metric)}${Number.isFinite(appTop.contributionPct) ? ` and contributing ${formatFixedNumber(appTop.contributionPct, 2)}% of the measured ${appTop.sql.result === "Regressed" ? "regression" : "improvement"}` : ""}.`
      );
    } else if (appTop) {
      bullets.push(
        `Application workload: ${summary.bottomLine.noApplicationRegression ? "no material application-level regression detected" : "material application regression detected"}. No single dominant application SQL driver stands out in the measured workload.`
      );
    } else {
      bullets.push("Application workload: no detailed application SQL rows were available in the supplied reports.");
    }

    if (systemTop) {
      bullets.push(
        `System/monitoring workload: the main non-application regression is ${systemTop.sqlId}, ${describeMetricChange(
          systemTop.metricEntry,
          "Regressed"
        ).toLowerCase()} in ${metricLabel(systemTop.metricEntry?.metric)}. This remains secondary unless monitoring overhead is itself in scope.`
      );
    } else {
      bullets.push("System/monitoring workload: no system or monitoring SQL contributed materially to this result; the findings are limited to application SQL.");
    }

    if (runtimeRegressions.length > 0 && nonRuntimeImprovements.length > 0) {
      bullets.push(
        `Metric mix: ${nonRuntimeImprovements
          .slice()
          .sort((left, right) => compareMetricPriority(left.metric, right.metric))
          .map((metric) => metricLabel(metric.metric))
          .join(", ")} improved, but runtime metrics (${runtimeRegressions
          .slice()
          .sort((left, right) => compareMetricPriority(left.metric, right.metric))
          .map((metric) => metricLabel(metric.metric))
          .join(", ")}) still show regression.`
      );
    }

    if (runtimeSummary.significantRuntimeRegressions.length > 0 && summary.bottomLine.noApplicationRegression) {
      bullets.push("Despite no material SQL-level regressions, overall workload performance degraded significantly at the workload level and should be investigated as a workload-level issue rather than a clean SQL-level regression.");
    }

    if (runtimeSummary.hasConsistentMajorRuntimeImprovement) {
      bullets.push("Improvements are consistent across all major runtime metrics (elapsed time, CPU, I/O).");
    }

    if (mixedExecutionPairs) {
      bullets.push("Metric reconciliation: runtime metrics and optimizer-cost metrics do not all come from the same post-change execution, so treat them as complementary evidence rather than as a single merged run.");
    }

    return bullets.slice(0, 5);
  }

  function buildRisks(summary) {
    const risks = [];
    const maxErrors = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    const runtimeSummary = summarizeRuntimeSignals(summary.metricSummaries);
    const topErrorTheme = (summary.errorThemes || [])[0] || null;

    if (summary.applicationSql.some((sql) => sql.result === "Regressed")) {
      summary.applicationSql
        .filter((sql) => sql.result === "Regressed")
        .slice(0, 3)
        .forEach((sql) => {
          risks.push(`Application SQL ${sql.sqlId} shows a material regression in the supplied runtime metrics and should be reviewed before sign-off.`);
        });
    }

    summary.applicationSql
      .filter((sql) => sql.resultChanged)
      .slice(0, 2)
      .forEach((sql) => {
        risks.push(
          `Result-set difference was flagged for application SQL ${sql.sqlId}; validate correctness before treating the performance comparison as a pure runtime issue.`
        );
      });

    summary.systemSql
      .filter((sql) => sql.planChanged)
      .slice(0, 2)
      .forEach((sql) => {
        risks.push(
          `Plan change observed on monitoring SQL ${sql.sqlId}; this is low business risk unless Enterprise Manager overhead matters for the target environment.`
        );
      });

    summary.systemSql
      .filter((sql) => sql.resultChanged)
      .slice(0, 2)
      .forEach((sql) => {
        risks.push(
          `Result-set difference was flagged for monitoring SQL ${sql.sqlId}; this does not indicate an application regression, but it does mean the monitoring query itself changed behavior.`
        );
      });

    if (summary.bottomLine?.noApplicationRegression && runtimeSummary.significantRuntimeRegressions.length > 0) {
      risks.push(
        `Workload-level runtime regression remains a major risk: ${runtimeSummary.significantRuntimeRegressions
          .slice()
          .sort((left, right) => compareMetricPriority(left.metric, right.metric))
          .map((metric) => `${metricLabel(metric.metric)} ${formatFixedNumber(Math.abs(metric.overallImpact || 0), 2)}% worse`)
          .join("; ")}.`
      );
    }

    if (topErrorTheme) {
      risks.push(
        `Grouped execution failures remain a risk: ${topErrorTheme.code || "Execution error"} affects ${formatNumber(topErrorTheme.sqlCount, 0)} SQL${
          topErrorTheme.likelyCause ? ` and suggests ${topErrorTheme.likelyCause}` : ""
        }.`
      );
    }

    if (maxErrors > 0) {
      const groupedThemes = (summary.errorThemes || []).slice(0, 2).map((theme) => `${theme.code || "Error"} affecting ${theme.sqlCount} SQL`);
      risks.push(
        `${maxErrors} SQL errors occurred during trial execution${groupedThemes.length ? `, primarily ${groupedThemes.join("; ")}` : ""}.`
      );
    }

    if (maxUnsupported > 0) {
      risks.push(
        `${maxUnsupported} SQL statements were unsupported, so the SPA comparison does not fully cover PL/SQL and instrumentation calls in the captured workload.`
      );
    }

    if (summary.executionNotes.some((note) => /do not all compare the same after execution/i.test(note))) {
      risks.push(
        "Optimizer cost and runtime metrics come from different post-change executions, so they should be read as complementary signals rather than as a single uniform run."
      );
    }

    risks.push(
      "The SPA compare HTML exposes a captured execution frequency per SQL, but not split before-versus-after execution counts, so execution-count shifts cannot be isolated from response-time change in this report alone."
    );

    summary.metricSummaries.forEach((metric) => {
      metric.notes.forEach((note) => risks.push(`${metricLabel(metric.metric)} reconciliation note: ${note}`));
    });

    return risks.slice(0, 7);
  }

  function buildNextSteps(summary) {
    const steps = [];
    const maxErrors = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.errors || 0), 0);
    const maxUnsupported = summary.metricSummaries.reduce((max, metric) => Math.max(max, metric.unsupported || 0), 0);
    if (maxErrors > 0) {
      steps.push(`Re-run the pre-change SPA execution after fixing the ${formatNumber(maxErrors, 0)} failing SQL statements so the before/after comparison is based on a clean baseline.`);
    }
    if (maxUnsupported > 0) {
      steps.push(`Address or separately validate the ${formatNumber(maxUnsupported, 0)} unsupported SQL statements, especially the application PL/SQL calls, because current SPA coverage is incomplete.`);
    }
    if (summary.topApplicationRegressions[0]) {
      steps.push(`Gather the full before/after execution plans and row-source statistics for SQL ${summary.topApplicationRegressions[0].sqlId} to validate whether the flagged plan change actually explains the elapsed-time impact.`);
    } else if (summary.topImprovements.find((row) => row.sql.classification?.group === "application")) {
      const topAppImprovement = summary.topImprovements.find((row) => row.sql.classification?.group === "application");
      steps.push(
        `Validate the business benefit of SQL ${topAppImprovement.sqlId} under a runtime execution test before using it as the primary upgrade benefit signal.`
      );
    }
    if (summary.rootCauseThemes.some((theme) => /statistics|cardinality/i.test(theme))) {
      steps.push("Validate optimizer statistics quality, histogram coverage, and any data skew on the affected objects before using hints or SQL Plan Baselines.");
    }
    if (summary.topRegressions.some((row) => /logical i\/o/i.test(row.likelyCause) || /cpu/i.test(row.likelyCause))) {
      steps.push("Review indexing and access-path changes for the highest-impact regressions to confirm whether extra logical I/O or CPU work was introduced after the change.");
    }
    if (summary.topRegressions.length > 0) {
      steps.push("Cross-check the highest-impact regressions in AWR or ASH for wait events and physical I/O, because the supplied SPA compare HTML does not expose that breakdown.");
    }
    if (!summary.topRegressions.length && summary.metricSummaries.some((metric) => normalizeMetric(metric.metric) === "ELAPSED_TIME" && workloadDirection(metric.overallImpact) === "regressed")) {
      steps.push("Compare the before/after workload context, caching, and storage behavior because elapsed-time regression is visible even though no material SQL-level regression was isolated.");
    }
    if (summary.systemSql[0]) {
      steps.push(
        `Review monitoring SQL ${summary.systemSql[0].sqlId} only if Enterprise Manager overhead matters in production; otherwise treat it as low business risk.`
      );
    }
    return steps.slice(0, 5);
  }

  function sortSqlRows(rows) {
    return rows.slice().sort((left, right) => {
      if (right.maxWorkloadImpact !== left.maxWorkloadImpact) {
        return right.maxWorkloadImpact - left.maxWorkloadImpact;
      }
      return (right.frequency || 0) - (left.frequency || 0);
    });
  }

  function metricEntryFor(sql, preferredMetric, targetResult) {
    const preferredEntry = preferredMetric ? sql.metrics[preferredMetric] : null;
    if (preferredEntry && (!targetResult || preferredEntry.result === targetResult)) {
      return preferredEntry;
    }
    const candidates = Object.values(sql.metrics).filter((entry) => !targetResult || entry.result === targetResult);
    return (candidates.length ? candidates : Object.values(sql.metrics)).sort(
      (left, right) => Math.abs((right.workloadImpact || 0)) - Math.abs((left.workloadImpact || 0))
    )[0] || null;
  }

  function classifyPriority(sql, metricEntry, targetResult) {
    if (sql.classification?.group === "system") {
      return targetResult === "Regressed" ? "Low business risk" : "Low business priority";
    }
    const workloadImpact = Math.abs(metricEntry?.workloadImpact || 0);
    const frequency = sql.frequency || 0;
    if (targetResult === "Regressed") {
      if (workloadImpact >= 5 || (workloadImpact >= 1 && frequency >= 100000)) {
        return "Must-fix now";
      }
      return "Watchlist";
    }
    if (workloadImpact >= 5 || (workloadImpact >= 1 && frequency >= 100000)) {
      return "High-value improvement";
    }
    return "Improvement watchlist";
  }

  function resourceProfileFor(sql) {
    const elapsed = sql.metrics.ELAPSED_TIME;
    const cpu = sql.metrics.CPU_TIME;
    const bufferGets = sql.metrics.BUFFER_GETS;
    const elapsedMagnitude = Math.abs(elapsed?.statementImpact || 0);
    const cpuMagnitude = Math.abs(cpu?.statementImpact || 0);
    const bufferMagnitude = Math.abs(bufferGets?.statementImpact || 0);

    if (elapsed && cpu && bufferGets) {
      if (cpuMagnitude >= Math.max(elapsedMagnitude * 0.6, 20) && bufferMagnitude >= 20) {
        return "CPU/logical I/O-bound";
      }
      if (cpuMagnitude >= Math.max(elapsedMagnitude * 0.6, 20)) {
        return "CPU-bound";
      }
      if (bufferMagnitude >= Math.max(elapsedMagnitude * 0.6, 20)) {
        return "Logical I/O-bound";
      }
      return "Elapsed-time change is visible, but CPU and logical I/O do not isolate a single driver";
    }

    if (elapsed && cpu) {
      return cpuMagnitude >= 20 ? "CPU-bound" : "Elapsed-time change with limited resource detail";
    }
    if (elapsed && bufferGets) {
      return bufferMagnitude >= 20 ? "Logical I/O-bound" : "Elapsed-time change with limited resource detail";
    }
    if (cpu) {
      return "CPU-only evidence available";
    }
    if (bufferGets) {
      return "Logical I/O-only evidence available";
    }
    return "Physical I/O and wait breakdown are not exposed in the supplied SPA compare reports";
  }

  function planInterpretationFor(sql, metricEntry) {
    const direction = metricEntry?.result || sql.result;
    if (sql.planChanged || sql.planSummary?.hashChange) {
      if (direction === "Regressed") {
        return "Plan changed and performance regressed, so an optimizer-related regression is plausible.";
      }
      if (direction === "Improved") {
        return "Plan changed and performance improved, so an optimizer-related improvement is plausible.";
      }
      return "Plan changed, but the measured performance result is not clearly directional.";
    }

    if (sql.plans?.before?.planHash || sql.plans?.after?.planHash) {
      if (!sql.planSummary?.hashChange && sql.adaptivePlan) {
        return "Plan hash is unchanged and the plan is adaptive, so the visible plan signal is weak; runtime differences may come from adaptive branches, row-source behavior, caching, or environment effects.";
      }
      if (!sql.planSummary?.hashChange && direction === "Regressed") {
        return "Plan hash is unchanged, so the regression is more likely due to caching, I/O, row-source behavior, concurrency, or other environment effects than a plan rewrite.";
      }
      if (!sql.planSummary?.hashChange && direction === "Improved") {
        return "Plan hash is unchanged, so the improvement is more likely due to caching, row-source behavior, or environment effects than a plan rewrite.";
      }
    }

    return "No strong plan-change signal is visible in the embedded plan data.";
  }

  function likelyCauseFor(sql, metricEntry) {
    const parts = [];
    if (sql.planChanged || sql.plans?.before?.planHash || sql.plans?.after?.planHash) {
      parts.push(sql.planSummary.summary);
      parts.push(planInterpretationFor(sql, metricEntry));
    }

    if (sql.resultChanged) {
      parts.push("SPA also flags a result-set difference, so the performance comparison is not purely plan-level.");
    }
    if (sql.adaptivePlan) {
      parts.push("Oracle marks the post-change plan as adaptive.");
    }

    const profile = resourceProfileFor(sql);
    if (profile !== "Physical I/O and wait breakdown are not exposed in the supplied SPA compare reports") {
      parts.push(`Resource profile: ${profile}.`);
    }

    if (!parts.length && metricEntry?.metric === "OPTIMIZER_COST") {
      parts.push("Only optimizer-cost evidence is available here, so runtime root cause is ambiguous.");
    }
    if (!parts.length) {
      parts.push("Cause is ambiguous from the supplied SPA sections; gather the full execution plans and runtime details before concluding.");
    }

    return parts.join(" ");
  }

  function recommendedActionFor(sql, metricEntry) {
    if (sql.planChanged || sql.planSummary?.hashChange) {
      return "Compare the full before/after plans and row-source stats for the changed plan.";
    }
    if (sql.adaptivePlan) {
      return "Validate adaptive branches and row-count estimates with runtime plan statistics.";
    }
    if (metricEntry?.metric === "OPTIMIZER_COST") {
      return "Validate this with runtime execution because cost-only change is not a proven workload gain.";
    }
    if (metricEntry?.metric === "BUFFER_GETS" || /logical i\/o/i.test(resourceProfileFor(sql))) {
      return "Review access paths and indexing for extra logical I/O.";
    }
    if (metricEntry?.metric === "CPU_TIME" || /cpu/i.test(resourceProfileFor(sql))) {
      return "Check row-count estimates, join methods, and CPU-heavy filters.";
    }
    return "Capture the full execution plan, runtime stats, and workload context before concluding.";
  }

  function priorityReasonFor(sql, targetResult, contributionPct) {
    const parts = [];
    if (sql.classification?.group === "system") {
      parts.push("Monitoring or background workload");
    } else {
      parts.push(`Freq ${formatNumber(sql.frequency, 0)}`);
    }
    if (Number.isFinite(contributionPct)) {
      parts.push(`${formatFixedNumber(contributionPct, 2)}% of measured ${targetResult === "Regressed" ? "regression" : "improvement"}`);
    }
    return parts.join(" | ");
  }

  function contributionLabel(contributionPct, totalMeasuredImpact, targetResult) {
    if (!Number.isFinite(contributionPct)) {
      return "n/a";
    }
    const base = `${formatFixedNumber(contributionPct, 2)}%`;
    if (contributionPct >= 99.5 && Number.isFinite(totalMeasuredImpact) && totalMeasuredImpact < 5) {
      return `${base} (${targetResult === "Regressed" ? "small overall regression pool" : "small overall improvement pool"})`;
    }
    return base;
  }

  function shouldShowPrimaryDriver(row) {
    if (!row) {
      return false;
    }
    return row.impactSort >= 5 || (Number.isFinite(row.contributionPct) && row.contributionPct >= 60 && row.impactSort >= 2);
  }

  function buildRegressionOrImprovementRows(rows, targetResult) {
    const mapped = rows
      .filter((sql) => sql.result === targetResult)
      .map((sql) => {
        const metricEntry =
          targetResult === "Regressed"
            ? metricEntryFor(sql, "ELAPSED_TIME", targetResult)
            : metricEntryFor(sql, "ELAPSED_TIME", targetResult) || metricEntryFor(sql, "OPTIMIZER_COST", targetResult);
        return {
          sqlId: sql.sqlId,
          sql,
          metricEntry,
          impactSort: Math.abs(metricEntry?.workloadImpact || metricEntry?.statementImpact || 0),
          impact: metricEntry ? describeMetricChange(metricEntry, targetResult) : "n/a",
          rawImpactText: metricEntry
            ? `Raw workload impact ${rawPercentText(metricEntry.workloadImpact)}`
            : "",
          before: metricEntry ? formatMetricValue(metricEntry.metric, metricEntry.before) : "n/a",
          after: metricEntry ? formatMetricValue(metricEntry.metric, metricEntry.after) : "n/a",
          planChange: sql.planChanged ? (sql.planSummary.hashChange ? "Yes" : "Flagged") : "No",
          likelyCause: likelyCauseFor(sql, metricEntry),
          recommendedAction: recommendedActionFor(sql, metricEntry),
          priority: classifyPriority(sql, metricEntry, targetResult),
          frequency: sql.frequency || 0,
        };
      });

    const totalMeasuredImpact = mapped.reduce((sum, row) => sum + Math.abs(row.metricEntry?.workloadImpact || row.metricEntry?.statementImpact || 0), 0);

    return mapped
      .map((row) => ({
        ...row,
        contributionPct:
          totalMeasuredImpact > 0 ? (Math.abs(row.metricEntry?.workloadImpact || row.metricEntry?.statementImpact || 0) / totalMeasuredImpact) * 100 : null,
        contributionText:
          totalMeasuredImpact > 0
            ? contributionLabel(
                (Math.abs(row.metricEntry?.workloadImpact || row.metricEntry?.statementImpact || 0) / totalMeasuredImpact) * 100,
                totalMeasuredImpact,
                targetResult
              )
            : "n/a",
        priorityReason: priorityReasonFor(row.sql, targetResult, totalMeasuredImpact > 0 ? (Math.abs(row.metricEntry?.workloadImpact || row.metricEntry?.statementImpact || 0) / totalMeasuredImpact) * 100 : null),
      }))
      .sort((left, right) => {
        if (right.impactSort !== left.impactSort) {
          return right.impactSort - left.impactSort;
        }
        return (right.frequency || 0) - (left.frequency || 0);
      });
  }

  function buildRootCauseThemes(summary) {
    const themes = [];
    const topRegression = summary.topRegressions[0];
    const topImprovement = summary.topImprovements[0];
    const hasElapsedRegressions = summary.topRegressions.some((row) => row.metricEntry?.metric === "ELAPSED_TIME");
    const objectCounts = new Map();

    summary.topApplicationRegressions.forEach((row) => {
      const seen = new Set();
      Object.values(row.sql.plans || {}).forEach((plan) => {
        (plan.operations || []).forEach((operation) => {
          const objectKey = [operation.objectOwner, operation.objectName].filter(Boolean).join(".");
          if (!objectKey || seen.has(objectKey)) {
            return;
          }
          seen.add(objectKey);
          objectCounts.set(objectKey, (objectCounts.get(objectKey) || 0) + 1);
        });
      });
    });

    if (topRegression) {
      themes.push(
        `Primary regression theme: ${topRegression.sqlId} is the largest measured regression by ${topRegression.metricEntry ? metricLabel(topRegression.metricEntry.metric) : "available metric"}, contributing ${topRegression.contributionText || "n/a"} of the measured regression. ${topRegression.likelyCause}`
      );
    }

    if (hasElapsedRegressions) {
      themes.push(
        "Resource-profile theme: elapsed-time regressions can be cross-checked against CPU Time and Buffer Gets in this report set, but physical I/O and wait-event evidence is not exposed here."
      );
    }

    themes.push(
      "Cardinality theme: the embedded SPA XML exposes optimizer estimates such as plan cardinality and cost, but it does not expose full estimate-vs-actual row-source counts, so stale-statistics or skew can only be treated as a hypothesis when supported by plan change symptoms."
    );

    const sharedObject = Array.from(objectCounts.entries()).sort((left, right) => right[1] - left[1])[0];
    if (sharedObject && sharedObject[1] >= 2) {
      themes.push(
        `Shared-object theme: ${sharedObject[1]} regressed application SQL statements reference ${sharedObject[0]} in the embedded plans, so object-level checks such as statistics quality, indexing, and access path changes should be prioritized there.`
      );
    }

    if (topImprovement) {
      themes.push(
        `Improvement theme: ${topImprovement.sqlId} is the strongest measured improvement. ${topImprovement.likelyCause}`
      );
    }

    if ((summary.errorThemes || []).length > 0) {
      const topErrorTheme = summary.errorThemes[0];
      themes.push(
        `Execution-validity theme: ${topErrorTheme.sqlCount} SQL statements fail with the same root cause (${topErrorTheme.code || "error"}${topErrorTheme.likelyCause ? `, ${topErrorTheme.likelyCause}` : ""}), so functional correctness and data setup should be validated before treating this as a pure performance comparison.`
      );
    }

    if (summary.executionNotes.some((note) => /do not all compare the same after execution/i.test(note))) {
      themes.push(
        "Comparison-scope theme: runtime metrics and optimizer-cost metrics come from different post-change executions, so plan-cost improvements should be validated with runtime tests before being treated as proven workload gains."
      );
    }

    return themes.slice(0, 5);
  }

  function buildSpaSummary(input) {
    const reports = (input.reports || []).map((report) => parseSpaReport(report));
    if (!reports.length) {
      throw new Error("At least one SPA report is required.");
    }

    const uniqueReports = [];
    const duplicateReports = [];
    const seenSignatures = new Set();
    reports.forEach((report) => {
      if (seenSignatures.has(report.signature)) {
        duplicateReports.push(report);
        return;
      }
      seenSignatures.add(report.signature);
      uniqueReports.push(report);
    });

    const metricReports = uniqueReports
      .slice()
      .sort((left, right) => compareMetricPriority(left.metric, right.metric));
    const metricSummaries = metricReports.map(summarizeMetric);
    const workloadValidity = buildWorkloadValidity(metricSummaries, metricReports, metricReports[0]?.sqlset);
    const topLinePerformance = buildTopLinePerformance(metricSummaries);
    const errorThemes = buildErrorThemes(metricReports);
    const unsupportedAssessment = buildUnsupportedAssessment(metricReports);
    const mergedSql = mergeSqlDetails(metricReports, metricSummaries);
    const applicationSql = sortSqlRows(mergedSql.filter((sql) => sql.classification?.group === "application"));
    const systemSql = sortSqlRows(mergedSql.filter((sql) => sql.classification?.group === "system"));
    const executionNotes = buildExecutionNotes(metricSummaries, duplicateReports);
    const bottomLine = buildBottomLine(applicationSql, systemSql, metricSummaries, metricReports, workloadValidity, topLinePerformance);
    const applicationVerdict = buildApplicationVerdict(applicationSql, metricSummaries, metricReports, workloadValidity, topLinePerformance);
    const topApplicationRegressions = buildRegressionOrImprovementRows(applicationSql, "Regressed");
    const topSystemRegressions = buildRegressionOrImprovementRows(systemSql, "Regressed");
    const topRegressions = topApplicationRegressions.concat(topSystemRegressions).slice().sort((a, b) => {
      if (a.priority === b.priority) {
        if (b.impactSort !== a.impactSort) {
          return b.impactSort - a.impactSort;
        }
        return (b.frequency || 0) - (a.frequency || 0);
      }
      const order = {
        "Must-fix now": 0,
        Watchlist: 1,
        "Low business risk": 2,
      };
      return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    });
    const topImprovements = buildRegressionOrImprovementRows(applicationSql.concat(systemSql), "Improved");
    const rootCauseThemes = buildRootCauseThemes({
      topRegressions,
      topImprovements,
      executionNotes,
      topApplicationRegressions,
      errorThemes,
    });
    const confidence = buildConfidenceAssessment(metricSummaries, metricReports, workloadValidity);
    const signalStrength = buildSignalStrengthAssessment(metricSummaries, applicationSql);
    const primaryDriverCandidate =
      topApplicationRegressions[0] ||
      topImprovements.find((row) => row.sql.classification?.group === "application") ||
      topRegressions[0] ||
      null;
    const primaryDriver = shouldShowPrimaryDriver(primaryDriverCandidate) ? primaryDriverCandidate : null;
    const finalInterpretation = buildFinalInterpretation(applicationSql, metricSummaries, confidence);
    const dominantSignal = buildDominantSignal(applicationSql, systemSql, metricSummaries);
    const topRegressionCause = topRegressions[0]?.likelyCause || "";
    const topImprovementCause = topImprovements[0]?.likelyCause || "";
    const noiseSqlCount = applicationSql.filter((sql) => sql.result === "Not meaningful").length + systemSql.filter((sql) => sql.result === "Not meaningful").length;
    const executiveNarrative = buildExecutiveNarrative({
      task: metricReports[0].task,
      sqlset: metricReports[0].sqlset,
      workloadValidity,
      topLinePerformance,
      confidence,
      applicationSql,
      primaryDriver,
    });
    const functionalAssessment = buildFunctionalAssessment({
      workloadValidity,
      applicationSql,
      errorThemes,
      unsupportedAssessment,
    });
    const performanceAssessment = buildPerformanceAssessment({
      applicationVerdict,
      topLinePerformance,
      metricSummaries,
      topRegressions,
      topImprovements,
    });

    return {
      task: metricReports[0].task,
      sqlset: metricReports[0].sqlset,
      reports: metricReports,
      duplicateReports,
      metricSummaries,
      applicationSql,
      systemSql,
      topApplicationRegressions,
      topRegressions,
      topImprovements,
      rootCauseThemes,
      executionNotes,
      bottomLine,
      applicationVerdict,
      confidence,
      signalStrength,
      primaryDriver,
      topRegressionCause,
      topImprovementCause,
      noiseSqlCount,
      executiveNarrative,
      functionalAssessment,
      performanceAssessment,
      finalInterpretation,
      dominantSignal,
      executiveSummary: buildExecutiveBullets({
      metricSummaries,
      workloadValidity,
      topLinePerformance,
      applicationSql,
      systemSql,
      bottomLine,
      executionNotes,
      topApplicationRegressions,
      topImprovements,
      topRegressions,
      confidence,
      reports: metricReports,
    }),
      risks: buildRisks({
        reports: metricReports,
        metricSummaries,
        applicationSql,
        systemSql,
        executionNotes,
        bottomLine,
        errorThemes,
      }),
      nextSteps: buildNextSteps({
        metricSummaries,
        applicationSql,
        systemSql,
        topApplicationRegressions,
        topRegressions,
        topImprovements,
        rootCauseThemes,
        errorThemes,
      }),
      workloadValidity,
      topLinePerformance,
      errorThemes,
      unsupportedAssessment,
      generatedAt: new Date().toLocaleString(),
    };
  }

  function sqlInventoryMetricSummary(sql) {
    const entries = Object.values(sql.metrics || {}).sort((left, right) => compareMetricPriority(left.metric, right.metric));
    const runtimeEntries = entries.filter((entry) => !NON_DECISION_METRICS.has(normalizeMetric(entry.metric)));
    const materialEntries = runtimeEntries.filter((entry) => entry.isMaterial);
    const changedEntries = runtimeEntries.filter((entry) => ["Improved", "Regressed"].includes(entry.result));
    const noteworthyEntries = runtimeEntries.filter((entry) => entry.result === "Not meaningful");
    const selectedEntries = (materialEntries.length
      ? materialEntries
      : changedEntries.length
        ? changedEntries
        : noteworthyEntries.length
          ? noteworthyEntries
          : runtimeEntries
    ).slice(0, 3);

    if (!selectedEntries.length) {
      return ["No runtime metric detail available."];
    }

    return selectedEntries.map((entry) => {
      const parts = [
        `${metricLabel(entry.metric)}: ${formatMetricValue(entry.metric, entry.before)} -> ${formatMetricValue(entry.metric, entry.after)}`,
        describeMetricChange(entry, entry.result),
      ];
      if (entry.materialReason) {
        parts.push(entry.materialReason);
      }
      return parts.join(" | ");
    });
  }

  function sqlInventoryFindings(sql) {
    const items = [];
    if (sql.planChanged) {
      items.push("Plan changed");
    }
    if (sql.adaptivePlan) {
      items.push("Adaptive plan");
    }
    if (sql.resultChanged) {
      items.push("Result changed");
    }
    const metricReason = Object.values(sql.metrics || {})
      .map((entry) => entry.materialReason)
      .find(Boolean);
    if (!items.length && metricReason) {
      items.push(metricReason);
    }
    return items.length ? items : ["None called out"];
  }

  function renderSqlInventoryCards(rows, emptyMessage) {
    if (!rows.length) {
      return `<div class="summary-block">${escapeHtml(emptyMessage)}</div>`;
    }

    return `<div class="sql-inventory-list">${rows
      .map((sql) => {
        const resultTone =
          sql.result === "Improved" ? "good" : sql.result === "Regressed" ? "bad" : "neutral";
        const metricItems = sqlInventoryMetricSummary(sql)
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("");
        const findingItems = sqlInventoryFindings(sql)
          .map((item) => `<span class="pill neutral">${escapeHtml(item)}</span>`)
          .join("");
        return `<article class="sql-card">
          <div class="sql-card-head">
            <div>
              <div class="sql-card-id">${escapeHtml(sql.sqlId)}</div>
              <div class="tiny">${escapeHtml(sql.schema || "-")} | Freq ${escapeHtml(formatNumber(sql.frequency, 0))}</div>
            </div>
            <span class="pill ${resultTone}">${escapeHtml(sql.result)}</span>
          </div>
          <div class="sql-card-text">${escapeHtml(shortenSql(sql.sqlText, 180))}</div>
          <div class="tiny">${escapeHtml(sql.classification?.label || "")}</div>
          <div class="sql-card-grid">
            <div>
              <div class="sql-card-subtitle">Key Metrics</div>
              <ul class="sql-metric-list">${metricItems}</ul>
            </div>
            <div>
              <div class="sql-card-subtitle">Plan / Findings</div>
              <div class="sql-card-tags">
                <span class="pill ${sql.planChanged ? "bad" : "neutral"}">${escapeHtml(sql.planChanged ? "Plan changed" : "Plan unchanged")}</span>
                ${findingItems}
              </div>
            </div>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  function renderMetricRows(metricSummaries) {
    return metricSummaries
      .map((metric) => {
        const direction = workloadDirection(metric.overallImpact);
        const tone = direction === "improved" ? "good" : direction === "regressed" ? "bad" : "neutral";
        const overallText = formatOverallImpactSummary(
          metric.metric,
          metric.workloadBefore,
          metric.workloadAfter,
          metric.overallImpact
        );
        return `<tr>
          <td><strong>${escapeHtml(metricLabel(metric.metric))}</strong></td>
          <td>${escapeHtml(metric.beforeExecution?.name || "-")} -> ${escapeHtml(metric.afterExecution?.name || "-")}<div class="tiny">${escapeHtml(
            metric.afterExecution?.type || ""
          )}</div></td>
          <td>${renderWorkloadCompareCell(metric)}</td>
          <td><span class="pill ${tone}">${escapeHtml(overallText)}</span><div class="tiny">${escapeHtml(metricMeaning(metric.metric))}</div></td>
          <td>${[
            `Improved ${formatNumber(metric.improved, 0)}`,
            `Regressed ${formatNumber(metric.regressed, 0)}`,
            `Unchanged ${formatNumber(metric.unchanged, 0)}`,
            `Plans ${formatNumber(metric.changedPlans, 0)}`,
            `Errors ${formatNumber(metric.errors, 0)}`,
            `Unsupported ${formatNumber(metric.unsupported, 0)}`,
          ]
            .map((item) => `<div class="count-line">${escapeHtml(item)}</div>`)
            .join("")}</td>
        </tr>`;
      })
      .join("");
  }

  function renderWorkloadCompareCell(metric) {
    const before = toNumber(metric.workloadBefore) || 0;
    const after = toNumber(metric.workloadAfter) || 0;
    const maxValue = Math.max(before, after, 1);
    const beforeWidth = before > 0 ? Math.max(6, Math.round((before / maxValue) * 100)) : 0;
    const afterWidth = after > 0 ? Math.max(6, Math.round((after / maxValue) * 100)) : 0;

    return `<div><strong>${escapeHtml(formatWorkloadValue(metric.metric, metric.workloadBefore))}</strong> -> <strong>${escapeHtml(
      formatWorkloadValue(metric.metric, metric.workloadAfter)
    )}</strong></div>
      <div class="workload-compare">
        <div class="workload-row">
          <div class="workload-label">Before</div>
          <div class="workload-track"><div class="workload-fill before" style="width:${beforeWidth}%;"></div></div>
        </div>
        <div class="workload-row">
          <div class="workload-label">After</div>
          <div class="workload-track"><div class="workload-fill after" style="width:${afterWidth}%;"></div></div>
        </div>
      </div>`;
  }

  function renderImpactTableRows(rows, emptyMessage) {
    if (!rows.length) {
      return `<tr><td colspan="9">${escapeHtml(emptyMessage)}</td></tr>`;
    }

    return rows
      .map((row) => {
        const priorityTone =
          row.priority === "Must-fix now"
            ? "priority-high"
            : row.priority === "Watchlist"
              ? "priority-watch"
              : row.priority === "Improvement watchlist"
                ? "priority-improvement-watch"
              : row.priority === "High-value improvement"
                ? "priority-good"
                : "priority-low";
        return `<tr>
        <td><strong>${escapeHtml(row.sqlId)}</strong><div class="tiny">${escapeHtml(row.sql.schema || "-")}</div></td>
        <td title="${escapeHtml(row.rawImpactText || "")}">${escapeHtml(row.impact)}</td>
        <td>${escapeHtml(formatNumber(row.frequency, 0))}</td>
        <td>${escapeHtml(row.before)}</td>
        <td>${escapeHtml(row.after)}</td>
        <td>${escapeHtml(row.contributionText || "n/a")}<div class="tiny">${escapeHtml(
          `of measured ${row.sql.result === "Regressed" ? "regression" : "improvement"}`
        )}</div></td>
        <td>${escapeHtml(row.planChange)}</td>
        <td>${escapeHtml(row.likelyCause)}<div class="tiny">${escapeHtml(`Next check: ${row.recommendedAction}`)}</div></td>
        <td><span class="pill ${priorityTone}">${escapeHtml(row.priority)}</span><div class="tiny">${escapeHtml(row.priorityReason)}</div></td>
      </tr>`;
      })
      .join("");
  }

  function renderList(items, emptyMessage) {
    if (!items.length) {
      return `<li>${escapeHtml(emptyMessage)}</li>`;
    }
    return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function buildExecutiveNarrative(summary) {
    const workloadValidity = summary.workloadValidity;
    const confidence = summary.confidence;
    const topLine = summary.topLinePerformance;
    const appRegressionCount = summary.applicationSql.filter((sql) => sql.result === "Regressed").length;
    const appImprovementCount = summary.applicationSql.filter((sql) => sql.result === "Improved").length;
    const dominantDriverText = summary.primaryDriver
      ? `${summary.primaryDriver.sqlId} (${summary.primaryDriver.impact.toLowerCase()})`
      : "no single material SQL driver";
    const confidenceClause =
      confidence.label === "High"
        ? "The workload comparison is clean enough for high-confidence interpretation."
        : `Confidence is ${confidence.label.toLowerCase()} because ${confidence.reason.charAt(0).toLowerCase()}${confidence.reason.slice(1)}`;

    return `${summary.task.name || "This SPA task"} compares ${formatNumber(workloadValidity.totalSql, 0)} SQL statements from ${summary.sqlset.name || "the loaded SQL tuning set"}. ${topLine.label}. ${appRegressionCount > 0 ? `${appRegressionCount} material application SQL regression${appRegressionCount === 1 ? "" : "s"} were isolated.` : "No material application SQL regression was isolated."} ${appImprovementCount > 0 ? `${appImprovementCount} application SQL statement${appImprovementCount === 1 ? "" : "s"} improved materially.` : ""} The dominant measured driver is ${dominantDriverText}, while ${confidenceClause}.`;
  }

  function renderExecutiveNarrativeHtml(summary) {
    const workloadValidity = summary.workloadValidity;
    const confidence = summary.confidence;
    const topLine = summary.topLinePerformance;
    const appRegressionCount = summary.applicationSql.filter((sql) => sql.result === "Regressed").length;
    const appImprovementCount = summary.applicationSql.filter((sql) => sql.result === "Improved").length;
    const dominantDriverText = summary.primaryDriver
      ? `${summary.primaryDriver.sqlId} (${summary.primaryDriver.impact.toLowerCase()})`
      : "no single material SQL driver";
    const hasConfidenceCaveat = confidence.label !== "High";
    const cleanedConfidenceReason = String(confidence.reason || "").replace(/[. ]+$/g, "");
    const confidenceReason = hasConfidenceCaveat
      ? ` because ${cleanedConfidenceReason.charAt(0).toLowerCase()}${cleanedConfidenceReason.slice(1)}`
      : "";

    return `${escapeHtml(summary.task.name || "This SPA task")} compares ${escapeHtml(
      formatNumber(workloadValidity.totalSql, 0)
    )} SQL statements from ${escapeHtml(summary.sqlset.name || "the loaded SQL tuning set")}. <strong>${escapeHtml(
      topLine.label
    )}</strong>. ${
      appRegressionCount > 0
        ? `<strong>${escapeHtml(
            `${appRegressionCount} material application SQL regression${appRegressionCount === 1 ? "" : "s"}`
          )}</strong> were isolated.`
        : "No material application SQL regression was isolated."
    } ${
      appImprovementCount > 0
        ? `<strong>${escapeHtml(
            `${appImprovementCount} application SQL statement${appImprovementCount === 1 ? "" : "s"} improved materially`
          )}</strong>.`
        : ""
    } The dominant measured driver is <strong>${escapeHtml(dominantDriverText)}</strong>. ${
      hasConfidenceCaveat
        ? `<strong>${escapeHtml(`Confidence is ${confidence.label.toLowerCase()}`)}</strong>${escapeHtml(confidenceReason)}.`
        : "The workload comparison is clean enough for high-confidence interpretation."
    }`;
  }

  function emphasizeInlineHtml(text) {
    let html = escapeHtml(text || "");
    html = html.replace(/^([^:]{1,80}:)/, "<strong>$1</strong>");
    html = html.replace(/\b(\d+(?:,\d{3})*(?:\.\d+)?%)\b/g, "<strong>$1</strong>");
    html = html.replace(/\b([a-z0-9]{13})\b/gi, "<strong>$1</strong>");
    html = html.replace(/\b(Confidence is low|Confidence is medium|Confidence is high)\b/gi, "<strong>$1</strong>");
    html = html.replace(/\b(Status is [A-Za-z /-]+)\b/g, "<strong>$1</strong>");
    html = html.replace(/\b(\d+(?:,\d{3})*\s+(?:errors?|unsupported SQL statements?|unsupported SQL|material application SQL regressions?|application SQL statement(?:s)?|SQL statements?))\b/gi, "<strong>$1</strong>");
    html = html.replace(/\b(Plan changed|Plan unchanged|Adaptive plan|Result changed)\b/g, "<strong>$1</strong>");
    html = html.replace(/\b(Elapsed Time(?: regressed| improved)?(?: \d+(?:,\d{3})*(?:\.\d+)?%)?|CPU Time(?: regressed| improved)?(?: \d+(?:,\d{3})*(?:\.\d+)?%)?)\b/g, "<strong>$1</strong>");
    return html;
  }

  function renderFunctionalAssessmentHtml(summary) {
    return emphasizeInlineHtml(summary.functionalAssessment?.paragraph || "");
  }

  function renderPerformanceAssessmentHtml(summary) {
    return emphasizeInlineHtml(summary.performanceAssessment?.paragraph || "");
  }

  function renderHighlightedList(items, emptyMessage) {
    if (!items.length) {
      return `<li>${escapeHtml(emptyMessage)}</li>`;
    }
    return items.map((item) => `<li>${emphasizeInlineHtml(item)}</li>`).join("");
  }

  function buildFunctionalAssessment(summary) {
    const resultChangedCount = summary.applicationSql.filter((sql) => sql.resultChanged).length;
    const errorThemes = summary.errorThemes || [];
    const unsupportedAssessment = summary.unsupportedAssessment || { note: "", brief: "" };
    const topErrorTheme = errorThemes[0] || null;
    const groupedErrorNote =
      topErrorTheme && summary.workloadValidity.beforeErrors > 0
        ? ` This includes ${formatNumber(summary.workloadValidity.beforeErrors, 0)} SQL errors${topErrorTheme.code ? `, including ${formatNumber(topErrorTheme.sqlCount, 0)} with ${topErrorTheme.code}` : ""}.`
        : "";
    let status = "Usable";
    if (summary.workloadValidity.score < 60 || resultChangedCount > 0) {
      status = "Use with caution";
    }
    if (summary.workloadValidity.score < 40) {
      status = "Needs cleanup";
    }

    const paragraph = `Status is ${status}. Functional comparability is driven primarily by execution cleanliness rather than elapsed-time movement: ${formatNumber(summary.workloadValidity.beforeErrors, 0)} errors before, ${formatNumber(summary.workloadValidity.afterErrors, 0)} errors after, and ${formatNumber(summary.workloadValidity.unsupported, 0)} unsupported SQL statements.${groupedErrorNote}${unsupportedAssessment.note} ${resultChangedCount > 0 ? `${resultChangedCount} application SQL statement${resultChangedCount === 1 ? "" : "s"} also show result-set differences and should be validated separately from performance.` : "No application result-set difference was flagged in the loaded evidence."}`;

    const bullets = [
      `Assessment status: ${status}`,
      `Comparable SQL: ${formatNumber(summary.workloadValidity.comparableSql, 0)} of ${formatNumber(summary.workloadValidity.totalSql, 0)}${Number.isFinite(summary.workloadValidity.comparablePct) ? ` (${formatFixedNumber(summary.workloadValidity.comparablePct, 1)}%)` : ""}`,
      `Errors before / after: ${formatNumber(summary.workloadValidity.beforeErrors, 0)} / ${formatNumber(summary.workloadValidity.afterErrors, 0)}`,
      `Unsupported SQL: ${formatNumber(summary.workloadValidity.unsupported, 0)}`,
      resultChangedCount > 0
        ? `Result-set differences: ${resultChangedCount} application SQL statement${resultChangedCount === 1 ? "" : "s"}`
        : "Result-set differences: none flagged in application SQL",
    ];
    if (unsupportedAssessment.brief) {
      bullets.push(unsupportedAssessment.brief);
    }
    if (errorThemes[0]) {
      bullets.push(`Dominant failure theme: ${errorThemes[0].code || "Execution error"} affecting ${formatNumber(errorThemes[0].sqlCount, 0)} SQL${errorThemes[0].likelyCause ? ` (${errorThemes[0].likelyCause})` : ""}`);
    }

    return { status, paragraph, bullets: bullets.slice(0, 5) };
  }

  function buildPerformanceAssessment(summary) {
    const elapsedMetric = summary.metricSummaries.find((metric) => normalizeMetric(metric.metric) === "ELAPSED_TIME");
    const cpuMetric = summary.metricSummaries.find((metric) => normalizeMetric(metric.metric) === "CPU_TIME");
    const ioMetrics = summary.metricSummaries.filter((metric) => runtimeMetricClass(metric.metric) === "io");
    const dominantIoMetric = ioMetrics
      .slice()
      .sort((left, right) => Math.abs(right.overallImpact || 0) - Math.abs(left.overallImpact || 0))[0];
    const topRegression = summary.topRegressions[0];
    const topImprovement = summary.topImprovements[0];
    const planSignal = topRegression
      ? planInterpretationFor(topRegression.sql, topRegression.metricEntry)
      : topImprovement
        ? planInterpretationFor(topImprovement.sql, topImprovement.metricEntry)
        : "No material SQL-level plan signal was isolated.";
    const paragraph = `Status is ${summary.applicationVerdict.label}. ${summary.topLinePerformance.reason} ${topRegression ? `Top material regression is ${topRegression.sqlId} (${topRegression.impact.toLowerCase()}).` : "No material SQL-level regression was isolated, so the performance result is currently driven by workload-level evidence."} ${topImprovement ? `Top measured improvement is ${topImprovement.sqlId} (${topImprovement.impact.toLowerCase()}).` : ""} ${planSignal}`;

    const bullets = [
      `Elapsed Time: ${elapsedMetric ? formatOverallImpactSummary(elapsedMetric.metric, elapsedMetric.workloadBefore, elapsedMetric.workloadAfter, elapsedMetric.overallImpact) : "n/a"}`,
      `CPU Time: ${cpuMetric ? formatOverallImpactSummary(cpuMetric.metric, cpuMetric.workloadBefore, cpuMetric.workloadAfter, cpuMetric.overallImpact) : "n/a"}`,
      dominantIoMetric
        ? `${metricLabel(dominantIoMetric.metric)}: ${formatOverallImpactSummary(dominantIoMetric.metric, dominantIoMetric.workloadBefore, dominantIoMetric.workloadAfter, dominantIoMetric.overallImpact)}`
        : "I/O metrics: n/a",
      topRegression
        ? `Top regression interpretation: ${topRegression.sqlId} | ${topRegression.planChange === "No" ? "no plan change visible" : "plan change visible"}`
        : "Top regression interpretation: no material SQL-level regression isolated",
      topImprovement
        ? `Top improvement interpretation: ${topImprovement.sqlId} | ${topImprovement.planChange === "No" ? "no plan change visible" : "plan change visible"}`
        : "Top improvement interpretation: none material",
    ];

    return { paragraph, bullets };
  }

  function buildWorkloadDriverRows(summary, limit = 6) {
    const sqlLevel = summary.finalInterpretation?.sqlLevel || "";
    const workloadLevel = summary.finalInterpretation?.workloadLevel || "";
    const alignedDirection = workloadLevel === "REGRESSED" ? "Regressed" : workloadLevel === "IMPROVED" ? "Improved" : null;
    const allMaterialRows = summary.topRegressions.concat(summary.topImprovements);
    const totalMaterialImpact = allMaterialRows.reduce(
      (sum, row) => sum + Math.abs(row.metricEntry?.workloadImpact ?? row.metricEntry?.statementImpact ?? 0),
      0
    );
    const alignedMaterialImpact = alignedDirection
      ? allMaterialRows
          .filter((row) => row.sql.result === alignedDirection)
          .reduce((sum, row) => sum + Math.abs(row.metricEntry?.workloadImpact ?? row.metricEntry?.statementImpact ?? 0), 0)
      : null;
    const explainedPct =
      alignedDirection && totalMaterialImpact > 0 ? (alignedMaterialImpact / totalMaterialImpact) * 100 : null;
    const unexplainedPct =
      alignedDirection && Number.isFinite(explainedPct) ? Math.max(0, 100 - explainedPct) : null;
    let selectedRows = [];
    let title = "Largest Measured SQL Changes";
    let caption =
      "These SQL statements represent the largest measured SQL-level changes in the supplied SPA reports.";

    if (workloadLevel === "REGRESSED" && sqlLevel === "PASS" && summary.topImprovements.length > 0) {
      selectedRows = summary.topImprovements;
      title = "Largest Measured SQL Improvements";
      caption =
        "These SQL improvements do not explain the workload regression.";
    } else if (workloadLevel === "IMPROVED" && summary.topImprovements.length > 0) {
      selectedRows = summary.topImprovements;
      title = "Largest Measured SQL Improvements";
      caption = "These SQL improvements align with the workload result.";
    } else if (summary.topRegressions.length > 0) {
      selectedRows = summary.topRegressions;
      title = "Largest Measured SQL Regressions";
      caption =
        workloadLevel === "REGRESSED"
          ? "These SQL statements are the clearest measured workload drivers."
          : "These are the clearest measured SQL regressions.";
    } else if (summary.topImprovements.length > 0) {
      selectedRows = summary.topImprovements;
      title = "Largest Measured SQL Improvements";
      caption = "These are the clearest measured SQL improvements.";
    }

    const limitedRows = selectedRows.slice(0, limit);
    const normalizedTotal = limitedRows.reduce(
      (sum, row) => sum + Math.abs(row.metricEntry?.workloadImpact ?? row.metricEntry?.statementImpact ?? 0),
      0
    );
    const rows = limitedRows
      .map((row) => {
        const sql = row.sql;
        const driverMetric = row.metricEntry || metricEntryFor(sql, null, sql.result);
        if (!driverMetric) {
          return null;
        }
        const baseImpact = Math.abs(driverMetric.workloadImpact ?? driverMetric.statementImpact ?? 0);
        if (!Number.isFinite(baseImpact) || baseImpact <= 0) {
          return null;
        }
        const elapsedMetric = sql.metrics.ELAPSED_TIME || null;
        const elapsedBefore = toNumber(elapsedMetric?.before);
        const elapsedAfter = toNumber(elapsedMetric?.after);
        const elapsedDeltaRaw =
          Number.isFinite(elapsedBefore) &&
          Number.isFinite(elapsedAfter) &&
          !isMicroTimingNoise("ELAPSED_TIME", elapsedBefore, elapsedAfter)
            ? elapsedAfter - elapsedBefore
            : null;
        const elapsedDeltaText = Number.isFinite(elapsedDeltaRaw)
          ? `${elapsedDeltaRaw > 0 ? "+" : elapsedDeltaRaw < 0 ? "-" : ""}${formatMetricValue("ELAPSED_TIME", Math.abs(elapsedDeltaRaw))} ${
              elapsedDeltaRaw > 0 ? "slower" : elapsedDeltaRaw < 0 ? "faster" : "flat"
            }`
          : "N/A";
        const contributionSharePct = normalizedTotal > 0 ? (baseImpact / normalizedTotal) * 100 : null;
        const workloadProxySigned = Number.isFinite(driverMetric.workloadImpact)
          ? row.sql.result === "Regressed"
            ? Math.abs(driverMetric.workloadImpact)
            : -Math.abs(driverMetric.workloadImpact)
          : null;
        const workloadProxyText = Number.isFinite(driverMetric.workloadImpact)
          ? `${formatFixedNumber(Math.abs(driverMetric.workloadImpact), 2)}% ${row.sql.result === "Regressed" ? "regressed" : "improved"}`
          : "N/A";
        return {
          sqlId: sql.sqlId,
          schema: sql.schema || "",
          sqlText: sql.shortSqlText || shortenSql(sql.sqlText, 120),
          direction: row.sql.result,
          frequency: sql.frequency || row.frequency || 0,
          workloadImpactAbs: baseImpact,
          workloadImpactRaw: driverMetric.workloadImpact,
          contributionMetric: driverMetric.metric,
          contributionMetricLabel: metricLabel(driverMetric.metric),
          elapsedDeltaSigned: elapsedDeltaRaw,
          elapsedDeltaText,
          workloadProxySigned,
          workloadProxyText,
          contributionSharePct,
          contributionShareText: Number.isFinite(contributionSharePct) ? `${formatFixedNumber(contributionSharePct, 1)}%` : "N/A",
          tooltipText: [
            `SQL ID: ${sql.sqlId}`,
            `Direction: ${row.sql.result}`,
            `Frequency: ${formatNumber(sql.frequency || row.frequency || 0, 0)}`,
            `Per-execution elapsed delta: ${elapsedDeltaText}`,
            `Workload-level proxy: ${workloadProxyText}`,
            `Contribution share: ${Number.isFinite(contributionSharePct) ? `${formatFixedNumber(contributionSharePct, 1)}% (normalized)` : "N/A"}`,
          ].join(" | "),
        };
      })
      .filter(Boolean);

    let unexplainedTitle = "Unexplained workload indicator";
    let unexplainedText =
      "Available SQL detail does not fully explain the workload result.";
    if (workloadLevel === "REGRESSED" && sqlLevel === "PASS") {
      unexplainedTitle = "Unexplained workload";
      unexplainedText = Number.isFinite(unexplainedPct)
        ? `Nearly all of the workload regression is explained; only ${formatFixedNumber(unexplainedPct, 1)}% remains unexplained.`
        : "The workload regression is not explained by material SQL-level rows.";
    } else if (alignedDirection && Number.isFinite(unexplainedPct)) {
      unexplainedText = `${formatFixedNumber(unexplainedPct, 1)}% of the workload ${workloadLevel.toLowerCase()} signal is not explained by same-direction material SQL rows.`;
    }

    return {
      title,
      caption,
      rows,
      matrixNote:
        "Higher frequency usually has the biggest workload impact.",
      interpretation:
        "Small SQL changes can add up when execution frequency is high.",
      unexplainedTitle,
      unexplainedText,
      hasRegressionMismatch:
        workloadLevel === "REGRESSED" && sqlLevel === "PASS" && summary.topImprovements.length > 0,
    };
  }

  function renderContributionBarChart(driverSection) {
    const rows = driverSection?.rows || [];
    if (!rows.length) {
      return `<div class="summary-block">No workload-driving SQL statements were available for charting.</div>`;
    }
    const bars = rows
      .map((row) => {
        const toneClass = row.direction === "Regressed" ? "bad" : "good";
        const width = Number.isFinite(row.contributionSharePct) ? Math.max(8, Math.round(row.contributionSharePct)) : 8;
        return `<div class="driver-bar-row" title="${escapeHtml(row.tooltipText)}">
          <div class="driver-bar-meta">
            <strong>${escapeHtml(row.sqlId)}</strong>
            <span class="pill ${toneClass}">${escapeHtml(row.direction)}</span>
          </div>
          <div class="driver-bar-track">
            <div class="driver-bar-fill ${toneClass}" style="width:${width}%;"></div>
          </div>
          <div class="driver-bar-value">${escapeHtml(row.contributionShareText)}</div>
        </div>`;
      })
      .join("");
    return `<div class="driver-chart-block">
      <div class="driver-chart-title">${escapeHtml(driverSection.title || "Largest Measured SQL Changes")}</div>
      <div class="driver-chart-caption">${escapeHtml(driverSection.caption || "This chart shows which SQL statements drive the overall workload change.")}</div>
      <div class="tiny" style="margin-bottom:10px;">Contribution share is normalized from the available workload impact values for the top workload-driving SQL statements.</div>
      <div class="driver-bar-chart">${bars}</div>
    </div>`;
  }

  function renderImpactFrequencyMatrix(driverSection) {
    const rows = driverSection?.rows || [];
    const exactRows = rows.filter(
      (row) =>
        Number.isFinite(row.frequency) &&
        row.frequency > 0 &&
        Number.isFinite(row.elapsedDeltaSigned) &&
        Number.isFinite(row.contributionSharePct)
    );
    const proxyRows = rows.filter(
      (row) =>
        Number.isFinite(row.frequency) &&
        row.frequency > 0 &&
        Number.isFinite(row.workloadProxySigned) &&
        Number.isFinite(row.contributionSharePct)
    );
    const useProxy = exactRows.length < 2 && proxyRows.length > 0;
    const matrixRows = useProxy ? proxyRows : exactRows.length ? exactRows : proxyRows;
    if (!matrixRows.length) {
      return `<div class="summary-block">Impact vs Frequency Matrix is unavailable because frequency and workload-level impact were not present for the top workload-driving SQL statements.</div>`;
    }

    const width = 720;
    const height = 295;
    const margin = { top: 28, right: 20, bottom: 42, left: 118 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xValues = matrixRows.map((row) => Math.log10((row.frequency || 0) + 1));
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues, xMin + 1);
    const yAccessor = (row) => (useProxy ? row.workloadProxySigned : row.elapsedDeltaSigned);
    const yMaxAbs = Math.max(...matrixRows.map((row) => Math.abs(yAccessor(row) || 0)), 1);
    const xMid = (xMin + xMax) / 2;
    const yZero = margin.top + plotHeight / 2;
    const xScale = (value) => margin.left + ((Math.log10((value || 0) + 1) - xMin) / (xMax - xMin || 1)) * plotWidth;
    const yScale = (value) => margin.top + ((yMaxAbs - value) / (2 * yMaxAbs || 1)) * plotHeight;
    const bubbleRadius = (share) => 6 + Math.sqrt(Math.max(share || 0, 0)) * 1.9;
    const midXPos = margin.left + ((xMid - xMin) / (xMax - xMin || 1)) * plotWidth;

    const bubbles = matrixRows
      .map((row) => {
        const cx = xScale(row.frequency);
        const cy = yScale(yAccessor(row));
        const radius = bubbleRadius(row.contributionSharePct);
        const fill = row.direction === "Regressed" ? "rgba(153, 27, 27, 0.72)" : "rgba(22, 101, 52, 0.72)";
        const stroke = row.direction === "Regressed" ? "#991b1b" : "#166534";
        const pointTitle = useProxy
          ? `${row.tooltipText} | Y-axis mode: workload-level proxy`
          : row.tooltipText;
        return `<g>
          <circle cx="${formatFixedNumber(cx, 2)}" cy="${formatFixedNumber(cy, 2)}" r="${formatFixedNumber(radius, 2)}" fill="${fill}" stroke="${stroke}" stroke-width="2">
            <title>${escapeHtml(pointTitle)}</title>
          </circle>
          <text x="${formatFixedNumber(cx, 2)}" y="${formatFixedNumber(cy - radius - 6, 2)}" text-anchor="middle" font-size="11" fill="#334155">${escapeHtml(
            row.sqlId
          )}</text>
        </g>`;
      })
      .join("");

    const chartNotes = [];
    if (driverSection.matrixNote) {
      chartNotes.push(driverSection.matrixNote);
    }
    if (driverSection.interpretation) {
      chartNotes.push(driverSection.interpretation);
    }
    if (driverSection.hasRegressionMismatch) {
      chartNotes.push("Measured SQL improvements do not explain the workload regression.");
    }
    if (matrixRows.length < 3) {
      chartNotes.push("Limited data: fewer than three SQL points.");
    }
    if (driverSection.unexplainedText) {
      chartNotes.push(`${driverSection.unexplainedTitle || "Unexplained workload"}: ${driverSection.unexplainedText}`);
    }

    return `<div class="driver-chart-block">
      <div class="driver-chart-title">Impact vs Frequency Matrix</div>
      <div class="driver-chart-caption">${
        useProxy
          ? "Y-axis uses workload impact because per-SQL elapsed-time detail was not available."
          : "Shows how frequency can turn small SQL changes into larger workload impact."
      }</div>
      <svg class="driver-matrix" viewBox="0 0 ${width} ${height}" role="img" aria-label="Impact versus frequency matrix">
        <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="#ffffff" stroke="rgba(26, 34, 56, 0.12)" />
        <line x1="${margin.left}" y1="${yZero}" x2="${margin.left + plotWidth}" y2="${yZero}" stroke="rgba(26, 34, 56, 0.18)" stroke-dasharray="4 4" />
        <line x1="${midXPos}" y1="${margin.top}" x2="${midXPos}" y2="${margin.top + plotHeight}" stroke="rgba(26, 34, 56, 0.18)" stroke-dasharray="4 4" />
        <text x="${margin.left - 10}" y="${margin.top + 10}" text-anchor="end" font-size="14" font-weight="700" fill="#5d677d">${
          useProxy ? "Higher impact" : "Slower"
        }</text>
        <text x="${margin.left - 10}" y="${margin.top + plotHeight - 1}" text-anchor="end" font-size="14" font-weight="700" fill="#5d677d">${
          useProxy ? "Lower impact" : "Faster"
        }</text>
        <text x="${margin.left + plotWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="15" font-weight="700" fill="#5d677d">Execution Frequency</text>
        <text x="30" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="15" font-weight="700" fill="#5d677d" transform="rotate(-90 30 ${margin.top + plotHeight / 2})">${
          useProxy
            ? `<tspan x="30" dy="-8">Workload-Level</tspan><tspan x="30" dy="16">Impact Proxy</tspan>`
            : "Per-execution Elapsed-Time Delta"
        }</text>
        <text x="${margin.left + 8}" y="${margin.top + 12}" font-size="12" fill="#991b1b">
          <tspan x="${margin.left + 8}" dy="0">${escapeHtml(useProxy ? "High freq + higher proxy" : "High freq + slower")}</tspan>
          <tspan x="${margin.left + 8}" dy="13">${escapeHtml(useProxy ? "= strongest workload signal" : "= highest priority")}</tspan>
        </text>
        <text x="${midXPos + 8}" y="${margin.top + 12}" font-size="12" fill="#991b1b">
          <tspan x="${midXPos + 8}" dy="0">${escapeHtml(useProxy ? "Low freq + higher proxy" : "Low freq + slower")}</tspan>
          <tspan x="${midXPos + 8}" dy="13">${escapeHtml(useProxy ? "= narrower workload signal" : "= lower priority")}</tspan>
        </text>
        <text x="${margin.left + 8}" y="${margin.top + plotHeight - 22}" font-size="12" fill="#166534">
          <tspan x="${margin.left + 8}" dy="0">${escapeHtml(useProxy ? "High freq + lower proxy" : "High freq + faster")}</tspan>
          <tspan x="${margin.left + 8}" dy="13">${escapeHtml(useProxy ? "= strongest improvement signal" : "= still important")}</tspan>
        </text>
        <text x="${midXPos + 8}" y="${margin.top + plotHeight - 22}" font-size="12" fill="#166534">
          <tspan x="${midXPos + 8}" dy="0">${escapeHtml(useProxy ? "Low freq + lower proxy" : "Low freq + faster")}</tspan>
          <tspan x="${midXPos + 8}" dy="13">${escapeHtml(useProxy ? "= lighter improvement signal" : "= low impact")}</tspan>
        </text>
        ${bubbles}
      </svg>
      <div class="driver-guide">
        <div><span class="driver-swatch bad"></span>Red bubbles = regressed SQL</div>
        <div><span class="driver-swatch good"></span>Green bubbles = improved SQL</div>
        <div>Bubble size = normalized workload contribution</div>
        <div>${useProxy ? "Y-axis uses a workload proxy." : "Rows without elapsed-time delta were omitted."}</div>
      </div>
      <div class="summary-block" style="margin-top:12px;">
        <strong>What This Chart Shows</strong>
        <ul class="clean" style="margin-top:8px;">${chartNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      </div>
    </div>`;
  }

  function renderSummaryHtml(summary) {
    const loadedMetrics = summary.metricSummaries.map((metric) => metricLabel(metric.metric)).join(", ");
    const executionDetail = summary.executionNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
    const workloadDrivers = buildWorkloadDriverRows(summary);
    const badge = verdictBadge(summary.applicationVerdict);
    const signalSummaryText =
      summary.signalStrength.label === "Strong improvement signal" && String(summary.confidence?.label || "").toLowerCase() === "low"
        ? "Strong improvement signal (low confidence due to incomplete coverage)"
        : summary.signalStrength.label;
    const finalDecisionText = summary.finalInterpretation?.finalDecision || summary.applicationVerdict.label;
    const compactVerdictText =
      finalDecisionText === "FAIL" || /regression detected/i.test(summary.applicationVerdict.label)
        ? "FAIL"
        : finalDecisionText === "WARN" || /regressed|incomplete/i.test(summary.applicationVerdict.label)
          ? "WARN"
          : "PASS";
    const compactValidityText = `${summary.workloadValidity.score}/100`;
    const compactValidityNote = [
      Number.isFinite(summary.workloadValidity.commonPct) ? `${formatFixedNumber(summary.workloadValidity.commonPct, 0)}% common` : "",
      summary.workloadValidity.beforeErrors || summary.workloadValidity.afterErrors
        ? `${formatNumber(summary.workloadValidity.beforeErrors || 0, 0)}/${formatNumber(summary.workloadValidity.afterErrors || 0, 0)} err`
        : "",
      summary.workloadValidity.beforeUnsupported || summary.workloadValidity.afterUnsupported
        ? `${formatNumber(summary.workloadValidity.beforeUnsupported || 0, 0)}/${formatNumber(summary.workloadValidity.afterUnsupported || 0, 0)} unsup`
        : "",
    ]
      .filter(Boolean)
      .join(" | ") || summary.workloadValidity.label;
    const compactValidityExplain = "Score uses comparable SQL, errors, unsupported SQL, and execution-pair consistency.";
    const compactTopLineNote = summary.topLinePerformance.metric ? metricLabel(summary.topLinePerformance.metric.metric) : "Runtime";
    const compactSignalText = signalSummaryText
      .replace(/\s*\(low confidence due to incomplete coverage\)/i, "")
      .replace(/ signal$/i, "");
    const compactSignalNote =
      summary.dominantSignal?.label === "Workload-level regression (no SQL driver)"
        ? "No SQL driver"
        : summary.dominantSignal?.label || "";
    const compactDriverText = summary.primaryDriver ? summary.primaryDriver.sqlId : "None";
    const compactDriverNote = summary.primaryDriver?.impact || "No SQL driver";
    const heroMetaText = [
      `Score ${summary.applicationVerdict.score}/100`,
      `Confidence ${summary.confidence.label}`,
      summary.bottomLine.applicationRegressions > 0
        ? `${formatNumber(summary.bottomLine.applicationRegressions, 0)} app SQL regress`
        : "No app SQL regressions",
      summary.workloadValidity.beforeErrors || summary.workloadValidity.afterErrors
        ? `Errors: ${formatNumber(summary.workloadValidity.beforeErrors || 0, 0)} before, ${formatNumber(summary.workloadValidity.afterErrors || 0, 0)} after`
        : "",
      summary.workloadValidity.beforeUnsupported || summary.workloadValidity.afterUnsupported
        ? `Unsupported: ${formatNumber(summary.workloadValidity.beforeUnsupported || 0, 0)} before, ${formatNumber(summary.workloadValidity.afterUnsupported || 0, 0)} after`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const hasTaskDescription = Boolean(String(summary.task.desc || "").trim());
    const mixedExecutionPairs = summary.executionNotes.some((note) => /do not all compare the same after execution/i.test(note));
    const llmUsage = summary.llm?.usage || null;
    const llmPromptTokens = Number(llmUsage?.input_tokens);
    const llmCompletionTokens = Number(llmUsage?.output_tokens);
    const llmTotalTokens = Number(llmUsage?.total_tokens);
    const llmUsed = Boolean(summary.llm?.used);
    const llmUsageSectionHtml = llmUsed
      ? `<section class="panel">
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
      : `<section class="panel">
        <h2>LLM Token Usage</h2>
        <div class="summary-block">LLM narrative mode was not used for this report. Token consumption is 0.</div>
      </section>`;
    const saveFileName = `spa-executive-summary-${summary.task.name || summary.task.id || "task"}`
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>SPA Executive Summary</title>
    <style>
      :root {
        --bg: #f7f5ef;
        --ink: #1a2238;
        --muted: #5d677d;
        --panel: rgba(255, 255, 255, 0.94);
        --line: rgba(26, 34, 56, 0.12);
        --accent: #0f766e;
        --accent-soft: rgba(15, 118, 110, 0.12);
        --good: #166534;
        --bad: #991b1b;
        --neutral: #92400e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font: 16px/1.55 "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(20, 184, 166, 0.18), transparent 22%),
          radial-gradient(circle at top left, rgba(245, 158, 11, 0.12), transparent 28%),
          linear-gradient(180deg, #fffdf7 0%, var(--bg) 100%);
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 36px 20px 72px;
      }
      .hero, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 26px;
        box-shadow: 0 22px 56px rgba(17, 24, 39, 0.08);
      }
      .hero {
        padding: 28px;
      }
      .eyebrow {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.76rem;
        font-weight: 800;
      }
      h1 {
        margin: 10px 0 8px;
        font-size: clamp(1.7rem, 3vw, 2.5rem);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      h2 {
        margin: 0 0 14px;
        font-size: 1.35rem;
      }
      .sub {
        margin: 0;
        color: var(--muted);
        max-width: 920px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: white;
        padding: 10px 12px;
      }
      .label {
        color: var(--muted);
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 800;
      }
      .value {
        margin-top: 8px;
        font-size: 1.1rem;
        font-weight: 800;
      }
      .value.compact {
        font-size: 0.88rem;
        font-weight: 700;
        line-height: 1.28;
      }
      .verdict {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 12px;
        font-weight: 800;
        margin-top: 16px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      button {
        border: 1px solid var(--line);
        background: white;
        color: var(--ink);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      section {
        margin-top: 28px;
      }
      .panel {
        padding: 22px;
      }
      ul.clean {
        margin: 0;
        padding-left: 20px;
      }
      ul.clean li {
        margin: 8px 0;
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
        vertical-align: top;
      }
      th {
        background: #f8fafc;
        font-size: 0.9rem;
      }
      .tiny {
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.82rem;
        font-weight: 800;
      }
      .pill.good {
        background: rgba(22, 101, 52, 0.12);
        color: var(--good);
      }
      .pill.bad {
        background: rgba(153, 27, 27, 0.12);
        color: var(--bad);
      }
      .pill.neutral {
        background: rgba(146, 64, 14, 0.12);
        color: var(--neutral);
      }
      .pill.priority-high {
        background: rgba(190, 24, 93, 0.14);
        color: #9d174d;
      }
      .pill.priority-watch {
        background: rgba(146, 64, 14, 0.12);
        color: #92400e;
      }
      .pill.priority-improvement-watch {
        background: rgba(22, 101, 52, 0.10);
        color: #166534;
      }
      .pill.priority-good {
        background: rgba(22, 101, 52, 0.12);
        color: #166534;
      }
      .pill.priority-low {
        background: rgba(51, 65, 85, 0.10);
        color: #475569;
      }
      .count-line {
        white-space: nowrap;
      }
      .workload-compare {
        margin-top: 8px;
      }
      .workload-row {
        display: grid;
        grid-template-columns: 42px 1fr;
        align-items: center;
        gap: 8px;
        margin: 4px 0;
      }
      .workload-label {
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
      }
      .workload-track {
        height: 8px;
        border-radius: 999px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .workload-fill {
        height: 100%;
        border-radius: 999px;
      }
      .workload-fill.before {
        background: #2563eb;
      }
      .workload-fill.after {
        background: #dc2626;
      }
      .impact-line {
        margin-bottom: 4px;
      }
      .summary-block {
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        background: white;
      }
      .section-note {
        color: var(--muted);
        margin-top: -4px;
        margin-bottom: 14px;
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
      .prototype-section {
        border: 1px solid rgba(15, 118, 110, 0.18);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(240, 253, 250, 0.95), rgba(248, 250, 252, 0.98));
        padding: 20px;
      }
      .prototype-subsection {
        margin-top: 18px;
        border: 1px solid rgba(26, 34, 56, 0.08);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.92);
        padding: 16px;
      }
      .prototype-subsection:first-of-type {
        margin-top: 12px;
      }
      .snapshot-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 10px;
      }
      .snapshot-card {
        border: 1px solid rgba(26, 34, 56, 0.08);
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
        padding: 12px 13px;
        min-height: 98px;
      }
      .snapshot-label {
        color: var(--muted);
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 800;
      }
      .snapshot-value {
        margin-top: 8px;
        font-size: 1.05rem;
        font-weight: 800;
        line-height: 1.2;
      }
      .snapshot-note {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.78rem;
        line-height: 1.3;
      }
      .snapshot-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 64px;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 0.8rem;
        font-weight: 800;
        margin-top: 8px;
      }
      .snapshot-chip.good {
        background: rgba(22, 101, 52, 0.12);
        color: var(--good);
      }
      .snapshot-chip.bad {
        background: rgba(153, 27, 27, 0.12);
        color: var(--bad);
      }
      .snapshot-chip.neutral {
        background: rgba(146, 64, 14, 0.12);
        color: var(--neutral);
      }
      .driver-chart-block + .driver-chart-block {
        margin-top: 18px;
      }
      .driver-chart-title {
        font-size: 1rem;
        font-weight: 800;
        margin-bottom: 4px;
      }
      .driver-chart-caption {
        color: var(--ink);
        font-weight: 400;
        margin-bottom: 6px;
      }
      .driver-bar-chart {
        display: grid;
        gap: 10px;
      }
      .driver-bar-row {
        display: grid;
        grid-template-columns: minmax(140px, 220px) minmax(200px, 1fr) 72px;
        gap: 12px;
        align-items: center;
      }
      .driver-bar-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .driver-bar-track {
        height: 12px;
        border-radius: 999px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .driver-bar-fill {
        height: 100%;
        border-radius: 999px;
      }
      .driver-bar-fill.good {
        background: linear-gradient(90deg, rgba(22, 101, 52, 0.8), rgba(22, 101, 52, 1));
      }
      .driver-bar-fill.bad {
        background: linear-gradient(90deg, rgba(153, 27, 27, 0.8), rgba(153, 27, 27, 1));
      }
      .driver-bar-value {
        text-align: right;
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--muted);
        white-space: nowrap;
      }
      .driver-matrix {
        width: min(96%, 720px);
        height: auto;
        display: block;
        margin: 10px auto 0;
      }
      .driver-guide {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 16px;
        color: var(--muted);
        font-size: 0.82rem;
        margin-top: 10px;
      }
      .driver-swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-right: 6px;
        vertical-align: middle;
      }
      .driver-swatch.good {
        background: rgba(22, 101, 52, 0.9);
      }
      .driver-swatch.bad {
        background: rgba(153, 27, 27, 0.9);
      }
      .driver-interpretation {
        margin-top: 14px;
      }
      .sql-inventory-list {
        display: grid;
        gap: 12px;
      }
      .sql-card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: white;
        padding: 14px 16px;
      }
      .sql-card-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      .sql-card-id {
        font-size: 1rem;
        font-weight: 800;
      }
      .sql-card-text {
        margin-top: 10px;
        font-weight: 700;
        line-height: 1.45;
      }
      .sql-card-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr);
        gap: 16px;
        margin-top: 12px;
      }
      .sql-card-subtitle {
        color: var(--muted);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 800;
        margin-bottom: 6px;
      }
      .sql-metric-list {
        margin: 0;
        padding-left: 18px;
      }
      .sql-metric-list li {
        margin: 6px 0;
      }
      .sql-card-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      @media (max-width: 760px) {
        .driver-bar-row {
          grid-template-columns: 1fr;
          gap: 6px;
        }
        .driver-bar-value {
          text-align: left;
        }
        .sql-card-grid {
          grid-template-columns: 1fr;
        }
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
        <div class="eyebrow">Oracle SQL Performance Analyzer Executive Summary</div>
        <h1>${escapeHtml(summary.task.name || "SPA Task")}</h1>
        <p class="sub">${escapeHtml(summary.bottomLine.heroText || summary.bottomLine.paragraph)}</p>
        <div class="verdict" style="color:${badge.fg};background:${badge.bg};">
          ${badge.icon} Bottom line: ${escapeHtml(summary.applicationVerdict.label.toLowerCase())}
        </div>
        <div class="tiny" style="margin-top:10px;">${escapeHtml(heroMetaText)}</div>
        <div class="cards">
          ${hasTaskDescription ? `<div class="card"><div class="label">Task Description</div><div class="value compact">${escapeHtml(
            summary.task.desc || ""
          )}</div></div>` : ""}
          <div class="card"><div class="label">SQL Tuning Set</div><div class="value compact">${escapeHtml(
            summary.sqlset.name || "-"
          )}</div><div class="tiny">${escapeHtml(summary.sqlset.sql_count || "-")} SQL in set</div></div>
          <div class="card"><div class="label">Loaded Metrics</div><div class="value compact">${escapeHtml(
            loadedMetrics || "-"
          )}</div></div>
        </div>
        <div class="actions">
          <button id="saveReportHtml" type="button">Save as HTML</button>
        </div>
      </section>

      <section class="panel">
        <h2>Executive Summary</h2>
        <div class="summary-block">${renderExecutiveNarrativeHtml(summary)}</div>
      </section>

      <section class="panel">
        <h2>Decision Snapshot</h2>
        <div class="snapshot-grid">
          <div class="snapshot-card">
            <div class="snapshot-label">Decision</div>
            <div class="snapshot-chip ${escapeHtml(summary.applicationVerdict?.tone === "red" ? "bad" : summary.applicationVerdict?.tone === "green" ? "good" : "neutral")}">${escapeHtml(compactVerdictText)}</div>
            <div class="snapshot-note">${escapeHtml(summary.finalInterpretation?.workloadLevel === "REGRESSED" ? "Workload regressed" : summary.finalInterpretation?.workloadLevel || summary.applicationVerdict.label)}</div>
          </div>
          <div class="snapshot-card">
            <div class="snapshot-label">Workload Validity</div>
            <div class="snapshot-value">${escapeHtml(compactValidityText)}</div>
            <div class="snapshot-note">${escapeHtml(compactValidityNote)}</div>
            <div class="tiny">${escapeHtml(compactValidityExplain)}</div>
          </div>
          <div class="snapshot-card">
            <div class="snapshot-label">Top Line</div>
            <div class="snapshot-value">${escapeHtml(summary.topLinePerformance.label)}</div>
            <div class="snapshot-note">${escapeHtml(compactTopLineNote)}</div>
          </div>
          <div class="snapshot-card">
            <div class="snapshot-label">Confidence</div>
            <div class="snapshot-chip ${escapeHtml(summary.confidence?.tone === "red" ? "bad" : summary.confidence?.tone === "green" ? "good" : "neutral")}">${escapeHtml(summary.confidence.label)}</div>
            <div class="snapshot-note">${escapeHtml(
              summary.confidence.label === "Low"
                ? "Coverage gaps"
                : summary.confidence.label === "Medium"
                  ? "Some caveats"
                  : "Clean compare"
            )}</div>
          </div>
          <div class="snapshot-card">
            <div class="snapshot-label">Dominant Signal</div>
            <div class="snapshot-chip ${escapeHtml(summary.signalStrength?.tone === "red" ? "bad" : summary.signalStrength?.tone === "green" ? "good" : "neutral")}">${escapeHtml(compactSignalText)}</div>
            <div class="snapshot-note">${escapeHtml(compactSignalNote)}</div>
          </div>
          <div class="snapshot-card">
            <div class="snapshot-label">Driver</div>
            <div class="snapshot-value">${escapeHtml(compactDriverText)}</div>
            <div class="snapshot-note">${escapeHtml(compactDriverNote)}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Functional Assessment</h2>
        <div class="summary-block">
          <p style="margin-top:0;">${renderFunctionalAssessmentHtml(summary)}</p>
          <ul class="clean">${renderHighlightedList(summary.functionalAssessment.bullets, "No functional assessment details available.")}</ul>
        </div>
      </section>

      <section class="panel">
        <h2>Performance Assessment</h2>
        <div class="summary-block">
          <p style="margin-top:0;">${renderPerformanceAssessmentHtml(summary)}</p>
          <ul class="clean">${renderHighlightedList(summary.performanceAssessment.bullets, "No performance assessment details available.")}</ul>
        </div>
        <div class="prototype-subsection driver-interpretation">
          <h3 style="margin-top:0;">Workload Drivers</h3>
          <p class="section-note" style="margin-bottom:16px;">These visuals highlight which SQL statements drive the measured workload result and why SQL-level results can differ from workload-level behavior.</p>
          ${renderContributionBarChart(workloadDrivers)}
          ${renderImpactFrequencyMatrix(workloadDrivers)}
        </div>
      </section>

      <section class="panel">
        <h2>Root-Cause Themes</h2>
        <ul class="clean">${renderHighlightedList(summary.rootCauseThemes, "No root-cause themes could be derived from the supplied reports.")}</ul>
      </section>

      <section class="panel">
        <h2>Risks And Watchouts</h2>
        <ul class="clean">${renderHighlightedList(summary.risks, "No additional watchouts were derived from the supplied reports.")}</ul>
      </section>

      <section class="panel">
        <h2>Recommended Next Steps</h2>
        <ul class="clean">${renderList(summary.nextSteps, "No next steps were generated.")}</ul>
      </section>

      <section class="panel">
        <h2>Top Regressions</h2>
        <p class="section-note">Only material SQL regressions are listed here. Noise, near-zero baselines, and below-threshold changes are excluded.</p>
        <table>
          <tr>
            <th>SQL ID</th>
            <th>What Changed</th>
            <th>Frequency</th>
            <th>Before</th>
            <th>After</th>
            <th>Contribution</th>
            <th>Plan Change</th>
            <th>Likely Cause / Next Check</th>
            <th>Priority</th>
          </tr>
          ${renderImpactTableRows(summary.topRegressions.slice(0, 8), "No regressed SQL statements were identified in the supplied SPA reports.")}
        </table>
      </section>

      <section class="panel">
        <h2>Top Improvements</h2>
        <p class="section-note">Only material improvements are listed here. Optimizer-cost-only changes do not drive the verdict and are filtered out of this table.</p>
        <table>
          <tr>
            <th>SQL ID</th>
            <th>What Changed</th>
            <th>Frequency</th>
            <th>Before</th>
            <th>After</th>
            <th>Contribution</th>
            <th>Plan Change</th>
            <th>Likely Cause / Next Check</th>
            <th>Priority</th>
          </tr>
          ${renderImpactTableRows(summary.topImprovements.slice(0, 8), "No improved SQL statements were identified in the supplied SPA reports.")}
        </table>
      </section>

      <section class="panel">
        <h2>Final Interpretation</h2>
        <table>
          <tr><th>Dimension</th><th>Result</th></tr>
          <tr><td>SQL-Level</td><td>${escapeHtml(summary.finalInterpretation.sqlLevel)}</td></tr>
          <tr><td>Workload-Level</td><td>${escapeHtml(summary.finalInterpretation.workloadLevel)}</td></tr>
          <tr><td>Confidence</td><td>${escapeHtml(summary.finalInterpretation.confidence)}</td></tr>
          <tr><td>Final Decision</td><td>${escapeHtml(summary.finalInterpretation.finalDecision)}</td></tr>
        </table>
        <div class="summary-block" style="margin-top:16px;">${escapeHtml(summary.finalInterpretation.narrative)}</div>
      </section>

      <section class="panel">
        <h2>Workload Reconciliation</h2>
        <details class="collapsible-wrap">
          <summary>Show details</summary>
          <div class="collapsible-details">
            <p class="section-note">${escapeHtml(
              mixedExecutionPairs
                ? "The metrics do not all come from the same post-change execution, so the rows below should be read side by side rather than collapsed into a single raw score."
                : "All loaded metrics compare the same before/after execution pair, so the rows below can be read as a consistent workload comparison."
            )}</p>
            <table>
              <tr>
                <th>Metric</th>
                <th>Execution Pair</th>
                <th>Total Workload Before -> After</th>
                <th>Overall Impact</th>
                <th style="width: 220px;">Counts</th>
              </tr>
              ${renderMetricRows(summary.metricSummaries)}
            </table>
            <div class="summary-block" style="margin-top:16px;">
              <strong>Execution notes</strong>
              <ul class="clean" style="margin-top:8px;">${executionDetail || "<li>No execution notes.</li>"}</ul>
            </div>
          </div>
        </details>
      </section>

      <section class="panel">
        <h2>Detailed SQL Inventory</h2>
        <p class="section-note">Application SQL is prioritized first. Monitoring and background SQL is shown separately so it does not drive the business decision.</p>
        <details class="collapsible-wrap">
          <summary>Show details</summary>
          <div class="collapsible-details">
            <h3 style="margin-top:0;">Application SQL</h3>
            ${renderSqlInventoryCards(summary.applicationSql.slice(0, 8), "No application SQL detail rows were available in the supplied reports.")}

            <h3 style="margin-top:22px;">System / Monitoring SQL</h3>
            <div class="summary-block" style="margin-bottom:14px;">Non-application (monitoring workload)</div>
            ${renderSqlInventoryCards(summary.systemSql.slice(0, 8), "No system or monitoring SQL detail rows were available in the supplied reports.")}
          </div>
        </details>
      </section>

      <section class="panel">
        <h2>Evidence Snapshot</h2>
        <table>
          <tr><th>Field</th><th>Value</th></tr>
          <tr><td>Task</td><td>${escapeHtml(summary.task.name || "-")}</td></tr>
          <tr><td>Task Owner</td><td>${escapeHtml(summary.task.owner || "-")}</td></tr>
          <tr><td>Task Status</td><td>${escapeHtml(summary.task.status || "-")}</td></tr>
          <tr><td>SQL Set</td><td>${escapeHtml(summary.sqlset.name || "-")} (${escapeHtml(
            summary.sqlset.sql_count || "-"
          )} SQL)</td></tr>
          <tr><td>Loaded Metrics</td><td>${escapeHtml(loadedMetrics || "-")}</td></tr>
          <tr><td>Report Count</td><td>${summary.reports.length}</td></tr>
          <tr><td>Ignored Duplicates</td><td>${summary.duplicateReports.length}</td></tr>
          <tr><td>LLM Narrative</td><td>${summary.llm?.used ? `Enabled (${escapeHtml(summary.llm.model || "unknown model")})` : "Disabled"}</td></tr>
          <tr><td>Generated</td><td>${escapeHtml(summary.generatedAt)}</td></tr>
        </table>
      </section>

      ${llmUsageSectionHtml}

      <section class="panel">
        <div class="prototype-section">
          <h2>SPA Verdict Criteria</h2>
          <p style="margin:0;">This section explains the current rule-based logic used to derive the SPA Bottom Line and finding priority. It is methodology guidance, not additional evidence beyond the loaded reports.</p>

          <div class="prototype-subsection">
            <h3>How Bottom Line Is Defined</h3>
            <details class="collapsible-wrap">
              <summary>Show details</summary>
              <div class="collapsible-details">
                <p style="margin-top:0;">The SPA summary applies these rules in order:</p>
                <table>
                  <tr><th>Outcome</th><th>Current Rule</th></tr>
                  <tr><td><strong>PASS</strong></td><td>No material application SQL regression is detected and there are no material coverage caveats. If application SQL also improves, the score is higher.</td></tr>
                  <tr><td><strong>WARN</strong></td><td>No material application SQL regression is visible, but errors, unsupported SQL, missing runtime metrics, or mixed execution pairs reduce confidence.</td></tr>
                  <tr><td><strong>FAIL</strong></td><td>At least one material application SQL statement is classified as regressed in the supplied runtime metrics.</td></tr>
                  <tr><td><strong>Confidence</strong></td><td>High means clean workload coverage, Medium means mixed execution pairs only, and Low means the report set includes errors, unsupported SQL, or missing runtime metrics.</td></tr>
                </table>
              </div>
            </details>
          </div>

          <div class="prototype-subsection">
            <h3>How Regression Priority Is Defined</h3>
            <details class="collapsible-wrap">
              <summary>Show details</summary>
              <div class="collapsible-details">
                <p style="margin-top:0;">Top regressions are ranked by measured impact, with preference for elapsed-time evidence when available. Noise, near-zero baselines, optimizer-cost-only signals, and below-threshold changes are filtered out before priority is assigned.</p>
                <table>
                  <tr><th>Priority</th><th>Current Rule</th></tr>
                  <tr><td><strong>Must-fix now</strong></td><td>Application SQL with workload impact magnitude of at least 5%, or at least 1% with execution frequency of 100,000 or more.</td></tr>
                  <tr><td><strong>Watchlist</strong></td><td>Application SQL regression that does not meet the must-fix threshold but still shows measurable impact.</td></tr>
                  <tr><td><strong>Low business risk</strong></td><td>Regression is classified as system or monitoring workload, such as DBSNMP or dynamic-performance-view SQL.</td></tr>
                  <tr><td><strong>High-value improvement</strong></td><td>Application SQL improvement meets the same impact and frequency thresholds used for must-fix regressions.</td></tr>
                  <tr><td><strong>Improvement watchlist</strong></td><td>Application SQL improved, but the measured gain is smaller or lower-frequency.</td></tr>
                  <tr><td><strong>Low business priority</strong></td><td>Improvement is limited to system or monitoring workload.</td></tr>
                </table>
                <p style="margin:14px 0 0;">When multiple SQL statements share the same priority, the report orders them by absolute measured impact and then by execution frequency. Contribution percentages show each row's share of the measured regression or improvement in the displayed list.</p>
                <p style="margin:14px 0 0;"><strong>Application Verdict score:</strong> Green 80-90 means no application regression is detected, Amber 60-65 means no application regression is visible but confidence is reduced, and Red 25 means one or more application SQL statements regress.</p>
              </div>
            </details>
          </div>
        </div>
      </section>
    </main>
    <script>
      (function () {
        const button = document.getElementById("saveReportHtml");
        if (!button) {
          return;
        }

        button.addEventListener("click", function () {
          const blob = new Blob(["<!DOCTYPE html>\\n" + document.documentElement.outerHTML], {
            type: "text/html;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "${escapeHtml(saveFileName)}.html";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        });
      })();
    </script>
  </body>
</html>`;
  }

  function buildLLMSummaryPayload(summary) {
    return {
      report_type: "spa",
      task: {
        id: summary.task.id || "",
        name: summary.task.name || "",
        owner: summary.task.owner || "",
        status: summary.task.status || "",
        description: summary.task.desc || "",
      },
      sql_set: {
        name: summary.sqlset.name || "",
        sql_count: toNumber(summary.sqlset.sql_count),
      },
      loaded_metrics: summary.metricSummaries.map((metric) => ({
        metric: metric.metric,
        metric_label: metricLabel(metric.metric),
        file_name: metric.fileName,
        before_execution: metric.beforeExecution?.name || "",
        before_execution_type: metric.beforeExecution?.type || "",
        after_execution: metric.afterExecution?.name || "",
        after_execution_type: metric.afterExecution?.type || "",
        workload_before: metric.workloadBefore,
        workload_after: metric.workloadAfter,
        overall_impact_pct: metric.overallImpact,
        improved_sql: metric.improved,
        regressed_sql: metric.regressed,
        unchanged_sql: metric.unchanged,
        changed_plans: metric.changedPlans,
        errors: metric.errors,
        unsupported_sql: metric.unsupported,
        notes: metric.notes,
      })),
      execution_notes: summary.executionNotes,
      bottom_line: {
        no_application_regression: summary.bottomLine.noApplicationRegression,
        application_regressions: summary.bottomLine.applicationRegressions,
        system_regressions: summary.bottomLine.systemRegressions,
        deterministic_paragraph: summary.bottomLine.paragraph,
      },
      decision_snapshot: {
        verdict: summary.applicationVerdict.label,
        score: summary.applicationVerdict.score,
        confidence: summary.confidence?.label || "",
        confidence_reason: summary.confidence?.reason || "",
        signal_strength: summary.signalStrength?.label || "",
        signal_strength_reason: summary.signalStrength?.reason || "",
        final_interpretation: summary.finalInterpretation?.text || "",
        final_interpretation_narrative: summary.finalInterpretation?.narrative || "",
        dominant_signal: summary.dominantSignal?.label || "",
        dominant_signal_detail: summary.dominantSignal?.detail || "",
        primary_driver: summary.primaryDriver
          ? {
              sql_id: summary.primaryDriver.sqlId,
              impact: summary.primaryDriver.impact,
              frequency: summary.primaryDriver.frequency,
              contribution_pct: summary.primaryDriver.contributionPct,
              contribution_text: summary.primaryDriver.contributionText,
            }
          : null,
      },
      deterministic_narrative: {
        executive_summary: summary.executiveSummary,
        root_cause_themes: summary.rootCauseThemes,
        risks_and_watchouts: summary.risks,
        recommended_next_steps: summary.nextSteps,
      },
      top_regressions: summary.topRegressions.slice(0, 8).map((row) => ({
        sql_id: row.sqlId,
        impact: row.impact,
        frequency: row.frequency,
        contribution_pct: row.contributionPct,
        contribution_text: row.contributionText,
        before: row.before,
        after: row.after,
        plan_change: row.planChange,
        likely_cause: row.likelyCause,
        recommended_action: row.recommendedAction,
        priority: row.priority,
      })),
      top_improvements: summary.topImprovements.slice(0, 8).map((row) => ({
        sql_id: row.sqlId,
        impact: row.impact,
        frequency: row.frequency,
        contribution_pct: row.contributionPct,
        contribution_text: row.contributionText,
        before: row.before,
        after: row.after,
        plan_change: row.planChange,
        likely_cause: row.likelyCause,
        recommended_action: row.recommendedAction,
        priority: row.priority,
      })),
      top_application_sql: summary.applicationSql.slice(0, 5).map((sql) => ({
        sql_id: sql.sqlId,
        schema: sql.schema || "",
        frequency: sql.frequency || 0,
        short_sql_text: sql.shortSqlText || shortenSql(sql.sqlText, 140),
        result: sql.result,
        plan_changed: sql.planChanged,
        result_changed: sql.resultChanged,
        adaptive_plan: sql.adaptivePlan,
        metrics: Object.values(sql.metrics)
          .sort((left, right) => compareMetricPriority(left.metric, right.metric))
          .map((metric) => ({
            metric: metric.metric,
            metric_label: metricLabel(metric.metric),
            before: metric.before,
            after: metric.after,
            statement_impact_pct: metric.statementImpact,
            workload_impact_pct: metric.workloadImpact,
            raw_result: metric.rawResult,
            result: metric.result,
            material_reason: metric.materialReason,
          })),
      })),
      top_system_sql: summary.systemSql.slice(0, 5).map((sql) => ({
        sql_id: sql.sqlId,
        schema: sql.schema || "",
        classification: sql.classification?.label || "",
        frequency: sql.frequency || 0,
        short_sql_text: sql.shortSqlText || shortenSql(sql.sqlText, 140),
        result: sql.result,
        plan_changed: sql.planChanged,
        result_changed: sql.resultChanged,
        adaptive_plan: sql.adaptivePlan,
        metrics: Object.values(sql.metrics)
          .sort((left, right) => compareMetricPriority(left.metric, right.metric))
          .map((metric) => ({
            metric: metric.metric,
            metric_label: metricLabel(metric.metric),
            before: metric.before,
            after: metric.after,
            statement_impact_pct: metric.statementImpact,
            workload_impact_pct: metric.workloadImpact,
            raw_result: metric.rawResult,
            result: metric.result,
            material_reason: metric.materialReason,
          })),
      })),
    };
  }

  function applyLLMSections(summary, llmSections, llmMeta) {
    if (!llmSections) {
      return summary;
    }

    const nextSummary = {
      ...summary,
      bottomLine: {
        ...summary.bottomLine,
        paragraph:
          llmSections.bottom_line || llmSections.executive_summary || summary.bottomLine.paragraph,
      },
      executiveSummary:
        Array.isArray(llmSections.executive_summary_bullets) && llmSections.executive_summary_bullets.length
          ? llmSections.executive_summary_bullets
          : summary.executiveSummary,
      rootCauseThemes:
        Array.isArray(llmSections.root_cause_themes) && llmSections.root_cause_themes.length
          ? llmSections.root_cause_themes
          : summary.rootCauseThemes,
      risks:
        Array.isArray(llmSections.risks_and_watchouts) && llmSections.risks_and_watchouts.length
          ? llmSections.risks_and_watchouts
          : summary.risks,
      nextSteps:
        Array.isArray(llmSections.recommended_next_steps) && llmSections.recommended_next_steps.length
          ? llmSections.recommended_next_steps
          : summary.nextSteps,
    };

    if (llmMeta) {
      nextSummary.llm = {
        used: true,
        model: llmMeta.model || null,
        usage: llmMeta.usage || null,
      };
    }

    return nextSummary;
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
      popup || window.open("", `spa-summary-${summary.task.id || summary.task.name || "task"}`, "width=1260,height=920");
    if (!targetPopup) {
      throw new Error("Popup blocked. Allow popups for this page.");
    }
    return writeToPopup(targetPopup, renderSummaryHtml(summary));
  }

  function openErrorWindow(error, popup) {
    const targetPopup = popup || window.open("", "spa-summary-error", "width=860,height=640");
    if (!targetPopup) {
      throw error;
    }
    return writeToPopup(
      targetPopup,
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>SPA Summary Error</title>
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
      <h1>Unable to build the SPA executive summary</h1>
      <p>The popup was opened, but the summary generation failed before the report could be rendered.</p>
      <pre>${escapeHtml(error?.stack || error?.message || String(error))}</pre>
    </div>
  </body>
</html>`
    );
  }

  window.SpaSummaryApp = {
    buildSpaSummary,
    buildLLMSummaryPayload,
    applyLLMSections,
    openSummaryWindow,
    openErrorWindow,
  };
})();
