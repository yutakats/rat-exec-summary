require "webrick"
require "json"
require "net/http"
require "uri"

ROOT = File.expand_path("../..", __dir__)
PORT = Integer(ENV.fetch("PORT", "4567"))
OPENAI_MODEL = ENV.fetch("OPENAI_MODEL", "gpt-4.1")
REPORTS_ROOT = ENV.fetch("REPORTS_ROOT", File.join(ROOT, "tests/fixtures/dbrep_reports"))

def find_report_file(replay_dir, primary_globs:, fallback_patterns:, content_patterns: [])
  primary_globs.each do |glob_pattern|
    match = Dir.glob(File.join(replay_dir, glob_pattern)).sort.find { |path| File.file?(path) }
    return match if match
  end

  html_files = Dir.glob(File.join(replay_dir, "*.ht*")).select { |path| File.file?(path) }.sort
  fallback_patterns.each do |pattern|
    match = html_files.find { |path| File.basename(path).match?(pattern) }
    return match if match
  end

  unless content_patterns.empty?
    html_files.each do |path|
      begin
        content = File.read(path)
      rescue
        next
      end
      return path if content_patterns.any? { |pattern| content.match?(pattern) }
    end
  end

  nil
end

def json_response(res, status:, body:)
  res.status = status
  res["Content-Type"] = "application/json"
  res["Access-Control-Allow-Origin"] = "*"
  res["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
  res["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
  res.body = JSON.generate(body)
end

def build_replay_prompt(payload)
  <<~PROMPT
    You are generating an executive Oracle Database Replay summary for an internal enterprise tool.

    Requirements:
    - Use only the structured metrics provided.
    - Do not invent values or conditions.
    - If captureVersion and replayVersion differ, mention this as an upgrade validation.
    - If they are the same, do not call it an upgrade test.
    - If dbTimeChangePct is negative, say Database Time improved/lowered.
    - If dbTimeChangePct is positive, say Database Time regressed/increased.
    - If divergencePct is 0 or null, do not claim row-fetch divergence.
    - Treat divergencePct as the numeric severity signal for comparability language.
    - If divergencePct is below 5, do not describe divergence severity as high, even if divergenceLevel text says HIGH.
    - If divergenceLevel and divergencePct disagree, explicitly note: "Oracle label: <level>, measured divergence: <pct>%".
    - Keep the tone executive and concise, but richer than a simple rules list.
    - Return valid JSON only.

    Return this JSON object shape:
    {
      "executive_summary": "paragraph",
      "key_findings": ["...", "..."],
      "problems_detected": ["...", "..."],
      "likely_causes": ["...", "..."],
      "recommended_actions": ["...", "..."],
      "bottom_line_title": "Replay performance looks \\\"good\\\" overall",
      "bottom_line": "sentence or short paragraph"
    }

    Input metrics:
    #{JSON.pretty_generate(payload)}
  PROMPT
end

def build_spa_prompt(payload)
  <<~PROMPT
    You are analyzing an Oracle SQL Performance Analyzer (SPA) report set for an internal enterprise tool.

    Requirements:
    - Use only the structured metrics provided.
    - Do not invent values, root causes, or SQL classifications.
    - Write for an upgrade go/no-go decision.
    - Keep application workload and system/monitoring workload clearly separated.
    - Do not let DBSNMP, EMAGENT, SYS, SYSTEM, SYSMAN, GV$, V$, or scheduler monitoring SQL drive the business conclusion unless the payload explicitly indicates an application regression.
    - Treat only material SQL changes as actionable. Noise, near-zero baselines, microsecond-level timing shifts, and below-threshold changes should not be described as regressions.
    - Optimizer cost alone must not drive the verdict.
    - If regressions exist only in monitoring/system SQL, explicitly state that no application-level regression was detected.
    - If application SQL improves while monitoring SQL regresses, say that application workload improved and regression is limited to monitoring workload.
    - If optimizer-cost or logical-I/O signals improve while runtime metrics such as elapsed time or CPU regress, describe that explicitly as mixed evidence; do not summarize it as overall improvement.
    - If errors or unsupported SQL exist, describe them as confidence or coverage limitations.
    - If runtime metrics are missing and only optimizer cost is available, explicitly say runtime workload safety is not fully validated.
    - If the metric summaries come from different post-change executions, mention that the metrics should be interpreted as complementary signals rather than a single uniform run.
    - Identify top regressed SQL by elapsed-time impact when elapsed-time evidence exists.
    - Highlight whether regressions are severe but low-frequency versus smaller but high-frequency.
    - Compare old and new plans only when the payload contains evidence for a plan change or plan hash change.
    - If the payload does not contain enough evidence to explain a join method, access path, join order, predicate pushdown, parallelism, or row-count estimate issue, explicitly say the report is ambiguous on that point.
    - For resource profile, use only the supplied elapsed time, CPU time, and logical I/O signals. If physical I/O or waits are not present, say they are not visible in this report set.
    - Prefer GO / WARN / NO-GO wording in the narrative.
    - Keep the tone executive, concise, practical, and decision-oriented.
    - Return valid JSON only.

    Return this JSON object shape:
    {
      "bottom_line": "one paragraph",
      "executive_summary_bullets": ["...", "..."],
      "root_cause_themes": ["...", "..."],
      "risks_and_watchouts": ["...", "..."],
      "recommended_next_steps": ["...", "..."]
    }

    Input metrics:
    #{JSON.pretty_generate(payload)}
  PROMPT
end

def build_prompt(payload)
  case payload["report_type"].to_s.downcase
  when "spa"
    build_spa_prompt(payload)
  else
    build_replay_prompt(payload)
  end
end

def extract_output_text(response_json)
  return response_json["output_text"] if response_json["output_text"].is_a?(String) && !response_json["output_text"].empty?

  output = response_json["output"]
  return nil unless output.is_a?(Array)

  texts = output.flat_map do |item|
    contents = item["content"]
    next [] unless contents.is_a?(Array)
    contents.map { |content| content["text"] if content["type"] == "output_text" }.compact
  end

  texts.join("\n").strip
end

def parse_llm_json(text)
  cleaned = text.to_s.strip
  cleaned = cleaned.gsub(/\A```json\s*/i, "").gsub(/\A```\s*/i, "").gsub(/```\s*\z/, "").strip

  begin
    parsed = JSON.parse(cleaned)
    return JSON.parse(parsed) if parsed.is_a?(String) && parsed.strip.start_with?("{")
    return parsed if parsed.is_a?(Hash)
  rescue JSON::ParserError
  end

  start_index = cleaned.index("{")
  end_index = cleaned.rindex("}")
  if start_index && end_index && end_index > start_index
    candidate = cleaned[start_index..end_index]
    parsed = JSON.parse(candidate)
    return JSON.parse(parsed) if parsed.is_a?(String) && parsed.strip.start_with?("{")
    return parsed if parsed.is_a?(Hash)
  end

  raise "LLM output was not a valid JSON object."
end

def call_openai(payload)
  api_key = ENV["OPENAI_API_KEY"]
  raise "OPENAI_API_KEY is not set." if api_key.to_s.empty?

  uri = URI("https://api.openai.com/v1/responses")
  request = Net::HTTP::Post.new(uri)
  request["Authorization"] = "Bearer #{api_key}"
  request["Content-Type"] = "application/json"
  request.body = JSON.generate(
    model: OPENAI_MODEL,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "Rewrite structured Oracle report analysis into executive report sections. Preserve factual accuracy from the supplied metrics and do not invent unsupported conclusions."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: build_prompt(payload)
          }
        ]
      }
    ]
  )

  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.read_timeout = 120
  response = http.request(request)
  raise "OpenAI API error #{response.code}: #{response.body}" unless response.is_a?(Net::HTTPSuccess)

  parsed = JSON.parse(response.body)
  text = extract_output_text(parsed)
  raise "OpenAI response did not include text output." if text.to_s.empty?

  {
    llm_sections: parse_llm_json(text),
    usage: parsed["usage"],
  }
end

server = WEBrick::HTTPServer.new(
  Port: PORT,
  BindAddress: "127.0.0.1",
  DocumentRoot: ROOT,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO)
)

server.mount_proc "/api/llm-summary" do |req, res|
  if req.request_method == "OPTIONS"
    json_response(res, status: 200, body: { ok: true })
    next
  end

  unless req.request_method == "POST"
    json_response(res, status: 405, body: { error: "Method not allowed" })
    next
  end

  begin
    payload = JSON.parse(req.body)
    result = call_openai(payload)
    json_response(
      res,
      status: 200,
      body: {
        llm_sections: result[:llm_sections],
        usage: result[:usage],
        model: OPENAI_MODEL,
      }
    )
  rescue => e
    json_response(res, status: 500, body: { error: e.message })
  end
end

server.mount_proc "/api/replay-reports" do |req, res|
  if req.request_method == "OPTIONS"
    json_response(res, status: 200, body: { ok: true })
    next
  end

  unless req.request_method == "GET"
    json_response(res, status: 405, body: { error: "Method not allowed" })
    next
  end

  begin
    replay_id = req.query["replay_id"].to_s.strip
    raise "Replay ID is required." if replay_id.empty?
    raise "Replay ID contains invalid characters." unless replay_id.match?(/\A[\w\- ]+\z/)

    replay_dir = File.join(REPORTS_ROOT, replay_id)
    raise "No report directory found for Replay ID #{replay_id}." unless Dir.exist?(replay_dir)

    db_replay_path = find_report_file(
      replay_dir,
      primary_globs: ["DB Replay Report.ht*"],
      fallback_patterns: [
        /replay[_ -]?report/i,
        /_replay\.ht/i,
        /during[_ -]?replay/i,
        /replay/i,
      ],
      content_patterns: [
        /<title>\s*DB Replay Report\s*<\/title>/i,
        /summary="replay options"/i,
        /Replay Divergence Summary/i,
      ]
    )
    compare_path = find_report_file(
      replay_dir,
      primary_globs: ["Compare Period Report.ht*"],
      fallback_patterns: [
        /compare[_ -]?period/i,
        /compare/i,
      ],
      content_patterns: [
        /<title>\s*Compare Period Report\s*<\/title>/i,
        /AWR snapshots not found for Replay/i,
        /Main Performance Statistics/i,
      ]
    )
    awr_path = find_report_file(
      replay_dir,
      primary_globs: ["AWR Compare Period Report*.ht*"],
      fallback_patterns: [
        /awr.*(compare|diff|report)/i,
        /awr/i,
      ],
      content_patterns: [
        /<title>\s*AWR Compare Period Report/i,
        /WORKLOAD REPOSITORY/i,
      ]
    )
    capture_path = find_report_file(
      replay_dir,
      primary_globs: ["Database Capture Report*.ht*", "workload_capture_report.ht*", "capture_report.ht*"],
      fallback_patterns: [
        /database[_ -]?capture/i,
        /workload[_ -]?capture/i,
        /capture[_ -]?report/i,
      ],
      content_patterns: [
        /<title>\s*Database Capture Report\s*<\/title>/i,
        /DB Capture Report/i,
        /Captured Workload Statistics/i,
      ]
    )

    raise "DB Replay Report file was not found in #{replay_dir}." unless db_replay_path && File.file?(db_replay_path)
    raise "Compare Period Report file was not found in #{replay_dir}." unless compare_path && File.file?(compare_path)

    json_response(
      res,
      status: 200,
      body: {
        replay_id: replay_id,
        directory: replay_dir,
        db_replay_html: File.read(db_replay_path),
        compare_html: File.read(compare_path),
        awr_html: awr_path && File.file?(awr_path) ? File.read(awr_path) : nil,
        capture_html: capture_path && File.file?(capture_path) ? File.read(capture_path) : nil,
        files: {
          db_replay: File.basename(db_replay_path),
          compare: File.basename(compare_path),
          awr: awr_path && File.file?(awr_path) ? File.basename(awr_path) : nil,
          capture: capture_path && File.file?(capture_path) ? File.basename(capture_path) : nil,
        },
      }
    )
  rescue => e
    json_response(res, status: 404, body: { error: e.message })
  end
end

trap("INT") { server.shutdown }
trap("TERM") { server.shutdown }

server.start
