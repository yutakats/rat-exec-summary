# Java DB Replay Executive Summary Utility

Standalone Java 8 command-line utility for generating an Oracle Database Replay executive summary HTML report.

This Java project is intentionally independent from the existing JavaScript implementation. The JavaScript flow remains in place under `scripts/`, `apps/`, and `packages/`.

## Requirements

- JDK 8 or newer
- No third-party Java dependencies

The Oracle Java browser/runtime plugin is not enough by itself because it provides `java` but not `javac`. On macOS, a full JDK normally appears under `/Library/Java/JavaVirtualMachines` and `javac -version` should print a compiler version.

## Build

From the repository root:

```sh
mkdir -p java-db-replay-summary/build/classes
javac -source 1.8 -target 1.8 -d java-db-replay-summary/build/classes \
  java-db-replay-summary/src/main/java/com/oracle/replay/summary/ReplaySummaryCli.java
```

## Run

Generate from a replay ID under the default `reports/` folder:

```sh
java -cp java-db-replay-summary/build/classes \
  com.oracle.replay.summary.ReplaySummaryCli \
  --replay-id 22 \
  --out /tmp/replay-22-java-summary.html
```

Generate from a specific report directory:

```sh
java -cp java-db-replay-summary/build/classes \
  com.oracle.replay.summary.ReplaySummaryCli \
  --report-dir /path/to/replay22 \
  --out /tmp/replay-22-java-summary.html
```

Optional flags:

- `--reports-root <dir>` overrides the report root when using `--replay-id`
- `--include-awr-deep-dive` adds lightweight AWR wait-event and SQL-driver sections when the AWR report is present
- `--llm-narrative` optionally rewrites the Executive Summary narrative with an LLM; requires `OPENAI_API_KEY`
- `--llm-model <model>` overrides the LLM model used with `--llm-narrative` (`OPENAI_MODEL` can also be used)
- `--llm-endpoint <url>` overrides the OpenAI Responses API endpoint
- `--llm-timeout-seconds <seconds>` overrides the LLM HTTP timeout
- `--help` prints usage

Example with optional LLM narrative:

```sh
OPENAI_API_KEY=... java -cp java-db-replay-summary/build/classes \
  com.oracle.replay.summary.ReplaySummaryCli \
  --report-dir /path/to/replay22 \
  --llm-narrative \
  --out /tmp/replay-22-java-summary.html
```

## Notes

- The parser uses only data present in the supplied Oracle HTML reports.
- Missing optional reports are tolerated where possible; missing DB Replay or Compare Period reports are errors.
- LLM narrative rewrite is optional. Without `--llm-narrative`, the utility runs fully offline with deterministic text.
- LLM HTTP calls auto-detect `https_proxy`, `HTTPS_PROXY`, `all_proxy`, or `ALL_PROXY` when Java proxy system properties are not already supplied.
- If `--llm-narrative` is enabled but the API key or network call is unavailable, the utility falls back to deterministic text and records the warning in the generated report.
