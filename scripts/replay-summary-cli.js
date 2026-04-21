#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const net = require("net");
const path = require("path");
const tls = require("tls");

function parseArgs(argv) {
  const args = { includeAwrDeepDive: false, useLlm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--replay-id") {
      args.replayId = argv[++i];
    } else if (token === "--report-dir") {
      args.reportDir = argv[++i];
    } else if (token === "--reports-root") {
      args.reportsRoot = argv[++i];
    } else if (token === "--out") {
      args.out = argv[++i];
    } else if (token === "--include-awr-deep-dive") {
      args.includeAwrDeepDive = true;
    } else if (token === "--use-llm") {
      args.useLlm = true;
    } else if (token === "--openai-model") {
      args.openaiModel = argv[++i];
    } else if (token === "--openai-base-url") {
      args.openaiBaseUrl = argv[++i];
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/replay-summary-cli.js (--replay-id <id> [--reports-root <dir>] | --report-dir <dir>) [--out <file>] [--include-awr-deep-dive] [--use-llm] [--openai-model <model>] [--openai-base-url <url>]",
    "",
    "Examples:",
    "  node scripts/replay-summary-cli.js --replay-id 22 --out /tmp/replay-22-summary.html",
    "  node scripts/replay-summary-cli.js --replay-id 'Replay 4' --include-awr-deep-dive",
    "  node scripts/replay-summary-cli.js --report-dir /path/to/replay22 --out /tmp/replay-22-summary.html",
    "  node scripts/replay-summary-cli.js --replay-id 22 --use-llm --openai-model gpt-4.1",
    "  node scripts/replay-summary-cli.js --report-dir /home/opc/replay_reports --use-llm --openai-base-url https://<gateway-host>",
  ].join("\n");
}

function findReportFile(replayDir, primaryMatchers, fallbackMatchers) {
  const files = fs.readdirSync(replayDir)
    .filter((name) => /\.htm[l]?$/i.test(name))
    .map((name) => ({ name, fullPath: path.join(replayDir, name) }));

  for (const matcher of primaryMatchers) {
    const hit = files.find((file) => matcher.test(file.name));
    if (hit) {
      return hit.fullPath;
    }
  }

  for (const matcher of fallbackMatchers) {
    const hit = files.find((file) => matcher.test(file.name));
    if (hit) {
      return hit.fullPath;
    }
  }

  return null;
}

function loadReplayBundle(reportsRoot, replayId) {
  const replayDir = path.join(reportsRoot, replayId);
  if (!fs.existsSync(replayDir) || !fs.statSync(replayDir).isDirectory()) {
    throw new Error(`Replay directory not found: ${replayDir}`);
  }

  const dbReplayPath = findReportFile(
    replayDir,
    [/^DB Replay Report\.htm[l]?$/i],
    [/replay[_ -]?report/i, /during[_ -]?replay/i, /replay/i]
  );
  const comparePath = findReportFile(
    replayDir,
    [/^Compare Period Report\.htm[l]?$/i],
    [/compare[_ -]?period/i, /compare/i]
  );
  const awrPath = findReportFile(
    replayDir,
    [/^AWR Compare Period Report.*\.htm[l]?$/i],
    [/awr.*(compare|diff|report)/i, /awr/i]
  );
  const capturePath = findReportFile(
    replayDir,
    [/^Database Capture Report.*\.htm[l]?$/i, /^workload_capture_report\.htm[l]?$/i, /^capture_report\.htm[l]?$/i],
    [/database[_ -]?capture/i, /workload[_ -]?capture/i, /capture[_ -]?report/i]
  );

  if (!dbReplayPath) {
    throw new Error(`DB Replay Report file not found in ${replayDir}`);
  }
  if (!comparePath) {
    throw new Error(`Compare Period Report file not found in ${replayDir}`);
  }

  return {
    replayId,
    dbReplayHtml: fs.readFileSync(dbReplayPath, "utf8"),
    compareHtml: fs.readFileSync(comparePath, "utf8"),
    awrHtml: awrPath ? fs.readFileSync(awrPath, "utf8") : "",
    captureHtml: capturePath ? fs.readFileSync(capturePath, "utf8") : "",
  };
}

function loadReplayBundleFromDir(reportDir, replayIdOverride) {
  const replayDir = path.resolve(reportDir);
  if (!fs.existsSync(replayDir) || !fs.statSync(replayDir).isDirectory()) {
    throw new Error(`Report directory not found: ${replayDir}`);
  }

  const dbReplayPath = findReportFile(
    replayDir,
    [/^DB Replay Report\.htm[l]?$/i],
    [/replay[_ -]?report/i, /during[_ -]?replay/i, /replay/i]
  );
  const comparePath = findReportFile(
    replayDir,
    [/^Compare Period Report\.htm[l]?$/i],
    [/compare[_ -]?period/i, /compare/i]
  );
  const awrPath = findReportFile(
    replayDir,
    [/^AWR Compare Period Report.*\.htm[l]?$/i],
    [/awr.*(compare|diff|report)/i, /awr/i]
  );
  const capturePath = findReportFile(
    replayDir,
    [/^Database Capture Report.*\.htm[l]?$/i, /^workload_capture_report\.htm[l]?$/i, /^capture_report\.htm[l]?$/i],
    [/database[_ -]?capture/i, /workload[_ -]?capture/i, /capture[_ -]?report/i]
  );

  if (!dbReplayPath) {
    throw new Error(`DB Replay Report file not found in ${replayDir}`);
  }
  if (!comparePath) {
    throw new Error(`Compare Period Report file not found in ${replayDir}`);
  }

  const replayId = replayIdOverride || path.basename(replayDir);
  return {
    replayId,
    dbReplayHtml: fs.readFileSync(dbReplayPath, "utf8"),
    compareHtml: fs.readFileSync(comparePath, "utf8"),
    awrHtml: awrPath ? fs.readFileSync(awrPath, "utf8") : "",
    captureHtml: capturePath ? fs.readFileSync(capturePath, "utf8") : "",
  };
}

function loadCoreParser(projectRoot) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.DOMParser = dom.window.DOMParser;
  global.window = {};
  require(path.join(projectRoot, "packages/core-parser/replay-summary-core.js"));
  if (!global.window.ReplaySummaryApp) {
    throw new Error("ReplaySummaryApp was not initialized.");
  }
  return global.window.ReplaySummaryApp;
}

function renderSummaryHtml(app, summary) {
  let rendered = "";
  const popup = {
    closed: false,
    document: {
      open() {
        rendered = "";
      },
      write(chunk) {
        rendered += String(chunk);
      },
      close() {},
    },
  };
  app.openSummaryWindow(summary, popup);
  return rendered;
}

function buildReplayPrompt(payload) {
  return [
    "You are generating an executive Oracle Database Replay summary for an internal enterprise tool.",
    "",
    "Requirements:",
    "- Use only the structured metrics provided.",
    "- Do not invent values or conditions.",
    "- If captureVersion and replayVersion differ, mention this as an upgrade validation.",
    "- If they are the same, do not call it an upgrade test.",
    "- If dbTimeChangePct is negative, say Database Time improved/lowered.",
    "- If dbTimeChangePct is positive, say Database Time regressed/increased.",
    "- If divergencePct is 0 or null, do not claim row-fetch divergence.",
    "- Treat divergencePct as the numeric severity signal for comparability language.",
    "- If divergencePct is below 5, do not describe divergence severity as high, even if divergenceLevel text says HIGH.",
    "- If divergenceLevel and divergencePct disagree, explicitly note: \"Oracle label: <level>, measured divergence: <pct>%\".",
    "- Keep the tone executive and concise, but richer than a simple rules list.",
    "- Return valid JSON only.",
    "",
    "Return this JSON object shape:",
    "{",
    "  \"executive_summary\": \"paragraph\",",
    "  \"key_findings\": [\"...\", \"...\"],",
    "  \"problems_detected\": [\"...\", \"...\"],",
    "  \"likely_causes\": [\"...\", \"...\"],",
    "  \"recommended_actions\": [\"...\", \"...\"],",
    "  \"bottom_line_title\": \"Replay performance looks \\\"good\\\" overall\",",
    "  \"bottom_line\": \"sentence or short paragraph\"",
    "}",
    "",
    "Input metrics:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function extractOutputText(responseJson) {
  if (typeof responseJson?.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const output = Array.isArray(responseJson?.output) ? responseJson.output : [];
  const texts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const piece of content) {
      if (piece?.type === "output_text" && typeof piece?.text === "string" && piece.text.trim()) {
        texts.push(piece.text.trim());
      }
    }
  }
  return texts.join("\n").trim();
}

function parseLlmJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      return JSON.parse(parsed);
    }
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    // fall through
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(candidate);
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      return JSON.parse(parsed);
    }
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  throw new Error("LLM output was not a valid JSON object.");
}

function resolveResponsesUrl(baseUrlRaw) {
  const baseRaw = String(baseUrlRaw || "https://api.openai.com").trim();
  const base = new URL(baseRaw);
  const cleanedPath = (base.pathname || "/").replace(/\/+$/, "");
  if (cleanedPath === "" || cleanedPath === "/") {
    base.pathname = "/v1/responses";
  } else if (cleanedPath.endsWith("/v1")) {
    base.pathname = `${cleanedPath}/responses`;
  } else if (cleanedPath.endsWith("/v1/responses")) {
    base.pathname = cleanedPath;
  } else {
    base.pathname = `${cleanedPath}/v1/responses`;
  }
  base.search = "";
  base.hash = "";
  return base;
}

function callOpenAi(payload, model, baseUrlRaw) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Export it or omit --use-llm.");
  }
  const responsesUrl = resolveResponsesUrl(baseUrlRaw);
  if (responsesUrl.protocol !== "https:") {
    throw new Error(`Only https endpoints are supported for LLM mode. Got: ${responsesUrl.protocol}`);
  }

  const requestBody = JSON.stringify({
    model,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "Rewrite structured Oracle report analysis into executive report sections. Preserve factual accuracy from the supplied metrics and do not invent unsupported conclusions.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildReplayPrompt(payload),
          },
        ],
      },
    ],
  });

  const requestOptions = {
    hostname: responsesUrl.hostname,
    port: Number(responsesUrl.port || 443),
    path: `${responsesUrl.pathname}${responsesUrl.search || ""}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestBody),
    },
  };

  const proxyUrlRaw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const proxyUrl = proxyUrlRaw ? new URL(proxyUrlRaw) : null;
  if (proxyUrl && proxyUrl.hostname) {
    requestOptions.createConnection = (_opts, callback) => {
      const proxyPort = Number(proxyUrl.port || 80);
      const proxySocket = net.connect(proxyPort, proxyUrl.hostname);

      proxySocket.once("error", callback);
      proxySocket.once("connect", () => {
        const authHeader =
          proxyUrl.username || proxyUrl.password
            ? `Proxy-Authorization: Basic ${Buffer.from(
                `${decodeURIComponent(proxyUrl.username || "")}:${decodeURIComponent(proxyUrl.password || "")}`
              ).toString("base64")}\r\n`
            : "";
        const connectReq =
          `CONNECT ${responsesUrl.hostname}:${requestOptions.port} HTTP/1.1\r\n` +
          `Host: ${responsesUrl.hostname}:${requestOptions.port}\r\n` +
          authHeader +
          `Connection: close\r\n\r\n`;
        proxySocket.write(connectReq);
      });

      let responseBuffer = "";
      const onData = (chunk) => {
        responseBuffer += chunk.toString("utf8");
        if (!responseBuffer.includes("\r\n\r\n")) {
          return;
        }
        proxySocket.removeListener("data", onData);
        const statusLine = responseBuffer.split("\r\n")[0] || "";
        if (!/^HTTP\/1\.[01] 200 /.test(statusLine)) {
          callback(new Error(`Proxy CONNECT failed: ${statusLine}`));
          proxySocket.destroy();
          return;
        }
        const secureSocket = tls.connect({
          socket: proxySocket,
          servername: responsesUrl.hostname,
        });
        secureSocket.once("secureConnect", () => callback(null, secureSocket));
        secureSocket.once("error", callback);
      };
      proxySocket.on("data", onData);
    };
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      requestOptions,
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`OpenAI API error ${res.statusCode}: ${body}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            const outputText = extractOutputText(parsed);
            if (!outputText) {
              reject(new Error("OpenAI response did not include text output."));
              return;
            }
            resolve({
              llmSections: parseLlmJson(outputText),
              usage: parsed.usage || null,
              model,
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.replayId && !args.reportDir)) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  if (args.replayId && args.reportDir) {
    throw new Error("Use either --replay-id or --report-dir, not both.");
  }

  const projectRoot = path.resolve(__dirname, "..");
  const reportsRoot = path.resolve(
    args.reportsRoot || process.env.REPORTS_ROOT || path.join(projectRoot, "tests/fixtures/dbrep_reports")
  );

  const app = loadCoreParser(projectRoot);
  const bundle = args.reportDir
    ? loadReplayBundleFromDir(args.reportDir, args.replayId)
    : loadReplayBundle(reportsRoot, args.replayId);
  const deterministicSummary = app.buildReplaySummary({
    replayId: bundle.replayId,
    dbReplayHtml: bundle.dbReplayHtml,
    compareHtml: bundle.compareHtml,
    awrHtml: bundle.awrHtml,
    captureHtml: bundle.captureHtml,
    options: {
      includeAwrDeepDive: Boolean(args.includeAwrDeepDive),
    },
  });
  let finalSummary = deterministicSummary;

  if (args.useLlm) {
    const model = args.openaiModel || process.env.OPENAI_MODEL || "gpt-4.1";
    const baseUrl = args.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com";
    const llmPayload = app.buildLLMSummaryPayload(deterministicSummary);
    const llmResult = await callOpenAi(llmPayload, model, baseUrl);
    finalSummary = app.applyLLMSections(deterministicSummary, llmResult.llmSections);
    finalSummary = {
      ...finalSummary,
      llm: {
        used: true,
        model: llmResult.model || model,
        usage: llmResult.usage || null,
      },
    };
  }

  const html = renderSummaryHtml(app, finalSummary);
  const outPath = path.resolve(
    args.out || path.join(projectRoot, `replay-executive-summary-${args.replayId}.html`)
  );
  fs.writeFileSync(outPath, html, "utf8");

  console.log(`Summary generated: ${outPath}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
