#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const path = require("path");

function parseArgs(argv) {
  const args = { includeAwrDeepDive: false, useLlm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--replay-id") {
      args.replayId = argv[++i];
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
    "  node scripts/replay-summary-cli.js --replay-id <id> [--reports-root <dir>] [--out <file>] [--include-awr-deep-dive] [--use-llm] [--openai-model <model>]",
    "",
    "Examples:",
    "  node scripts/replay-summary-cli.js --replay-id 22 --out /tmp/replay-22-summary.html",
    "  node scripts/replay-summary-cli.js --replay-id 'Replay 4' --include-awr-deep-dive",
    "  node scripts/replay-summary-cli.js --replay-id 22 --use-llm --openai-model gpt-4.1",
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

function callOpenAi(payload, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Export it or omit --use-llm.");
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

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        port: 443,
        path: "/v1/responses",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      },
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
  if (args.help || !args.replayId) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const reportsRoot = path.resolve(
    args.reportsRoot || process.env.REPORTS_ROOT || path.join(projectRoot, "tests/fixtures/dbrep_reports")
  );

  const app = loadCoreParser(projectRoot);
  const bundle = loadReplayBundle(reportsRoot, args.replayId);
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
    const llmPayload = app.buildLLMSummaryPayload(deterministicSummary);
    const llmResult = await callOpenAi(llmPayload, model);
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
