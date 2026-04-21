#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { includeAwrDeepDive: false };
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
    "  node scripts/replay-summary-cli.js --replay-id <id> [--reports-root <dir>] [--out <file>] [--include-awr-deep-dive]",
    "",
    "Examples:",
    "  node scripts/replay-summary-cli.js --replay-id 22 --out /tmp/replay-22-summary.html",
    "  node scripts/replay-summary-cli.js --replay-id 'Replay 4' --include-awr-deep-dive",
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

function main() {
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
  const summary = app.buildReplaySummary({
    replayId: bundle.replayId,
    dbReplayHtml: bundle.dbReplayHtml,
    compareHtml: bundle.compareHtml,
    awrHtml: bundle.awrHtml,
    captureHtml: bundle.captureHtml,
    options: {
      includeAwrDeepDive: Boolean(args.includeAwrDeepDive),
    },
  });

  const html = renderSummaryHtml(app, summary);
  const outPath = path.resolve(
    args.out || path.join(projectRoot, `replay-executive-summary-${args.replayId}.html`)
  );
  fs.writeFileSync(outPath, html, "utf8");

  console.log(`Summary generated: ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
