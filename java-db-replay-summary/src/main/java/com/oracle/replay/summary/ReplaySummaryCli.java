package com.oracle.replay.summary;

import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ReplaySummaryCli {
  private ReplaySummaryCli() {
  }

  public static void main(String[] rawArgs) {
    try {
      Args args = Args.parse(rawArgs);
      if (args.help || (isBlank(args.replayId) && isBlank(args.reportDir))) {
        System.out.println(usage());
        System.exit(args.help ? 0 : 1);
      }
      if (!isBlank(args.replayId) && !isBlank(args.reportDir)) {
        throw new IllegalArgumentException("Use either --replay-id or --report-dir, not both.");
      }

      Path projectRoot = Paths.get("").toAbsolutePath().normalize();
      ReportBundle bundle = isBlank(args.reportDir)
          ? ReportBundle.fromReplayId(projectRoot, args.reportsRoot, args.replayId)
          : ReportBundle.fromDirectory(args.reportDir, args.replayId);

      Summary summary = SummaryBuilder.build(bundle, args.includeAwrDeepDive);
      String html = SummaryRenderer.render(summary);
      Path out = Paths.get(isBlank(args.out)
          ? projectRoot.resolve("replay-executive-summary-" + safeFilePart(bundle.replayId) + "-java.html").toString()
          : args.out).toAbsolutePath().normalize();
      Path parent = out.getParent();
      if (parent != null && !Files.exists(parent)) {
        Files.createDirectories(parent);
      }
      Files.write(out, html.getBytes(StandardCharsets.UTF_8));
      System.out.println("Summary generated: " + out);
    } catch (Exception error) {
      System.err.println("Error: " + error.getMessage());
      System.exit(1);
    }
  }

  private static String usage() {
    return join("\n",
        "Usage:",
        "  java -cp java-db-replay-summary/build/classes com.oracle.replay.summary.ReplaySummaryCli (--replay-id <id> [--reports-root <dir>] | --report-dir <dir>) [--out <file>] [--include-awr-deep-dive]",
        "",
        "Examples:",
        "  java -cp java-db-replay-summary/build/classes com.oracle.replay.summary.ReplaySummaryCli --replay-id 22 --out /tmp/replay-22-summary.html",
        "  java -cp java-db-replay-summary/build/classes com.oracle.replay.summary.ReplaySummaryCli --report-dir /path/to/replay22 --out /tmp/replay-22-summary.html");
  }

  private static final class Args {
    String replayId;
    String reportDir;
    String reportsRoot;
    String out;
    boolean includeAwrDeepDive;
    boolean help;

    static Args parse(String[] argv) {
      Args args = new Args();
      for (int i = 0; i < argv.length; i++) {
        String token = argv[i];
        if ("--replay-id".equals(token)) {
          args.replayId = requireValue(argv, ++i, token);
        } else if ("--report-dir".equals(token)) {
          args.reportDir = requireValue(argv, ++i, token);
        } else if ("--reports-root".equals(token)) {
          args.reportsRoot = requireValue(argv, ++i, token);
        } else if ("--out".equals(token)) {
          args.out = requireValue(argv, ++i, token);
        } else if ("--include-awr-deep-dive".equals(token)) {
          args.includeAwrDeepDive = true;
        } else if ("--help".equals(token) || "-h".equals(token)) {
          args.help = true;
        } else {
          throw new IllegalArgumentException("Unknown argument: " + token);
        }
      }
      return args;
    }

    private static String requireValue(String[] argv, int index, String flag) {
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new IllegalArgumentException("Missing value for " + flag);
      }
      return argv[index];
    }
  }

  private static final class ReportBundle {
    final String replayId;
    final String dbReplayHtml;
    final String compareHtml;
    final String awrHtml;
    final String captureHtml;

    ReportBundle(String replayId, String dbReplayHtml, String compareHtml, String awrHtml, String captureHtml) {
      this.replayId = replayId;
      this.dbReplayHtml = dbReplayHtml;
      this.compareHtml = compareHtml;
      this.awrHtml = awrHtml;
      this.captureHtml = captureHtml;
    }

    static ReportBundle fromReplayId(Path projectRoot, String reportsRootRaw, String replayId) throws IOException {
      Path reportsRoot = isBlank(reportsRootRaw) ? defaultReportsRoot(projectRoot) : Paths.get(reportsRootRaw);
      return fromDirectory(reportsRoot.resolve(replayId).toString(), replayId);
    }

    static ReportBundle fromDirectory(String reportDirRaw, String replayIdOverride) throws IOException {
      Path reportDir = Paths.get(reportDirRaw).toAbsolutePath().normalize();
      if (!Files.isDirectory(reportDir)) {
        throw new IllegalArgumentException("Report directory not found: " + reportDir);
      }

      Path dbReplay = findReportFile(reportDir,
          new String[] {"^DB Replay Report\\.htm[l]?$"},
          new String[] {"replay[_ -]?report", "during[_ -]?replay", "replay"},
          new String[] {"<title>\\s*DB Replay Report\\s*</title>", "Replay Divergence Summary"});
      Path compare = findReportFile(reportDir,
          new String[] {"^Compare Period Report\\.htm[l]?$"},
          new String[] {"compare[_ -]?period", "compare"},
          new String[] {"<title>\\s*Compare Period Report\\s*</title>", "Main Performance Statistics"});
      Path awr = findReportFile(reportDir,
          new String[] {"^AWR Compare Period Report.*\\.htm[l]?$"},
          new String[] {"awr.*(compare|diff|report)", "awr"},
          new String[] {"<title>\\s*AWR Compare Period Report", "WORKLOAD REPOSITORY"});
      Path capture = findReportFile(reportDir,
          new String[] {"^Database Capture Report.*\\.htm[l]?$", "^workload_capture_report\\.htm[l]?$", "^capture_report\\.htm[l]?$"},
          new String[] {"database[_ -]?capture", "workload[_ -]?capture", "capture[_ -]?report"},
          new String[] {"<title>\\s*Database Capture Report\\s*</title>", "Captured Workload Statistics"});

      if (dbReplay == null) {
        throw new IllegalArgumentException("DB Replay Report file not found in " + reportDir);
      }
      if (compare == null) {
        throw new IllegalArgumentException("Compare Period Report file not found in " + reportDir);
      }

      String replayId = isBlank(replayIdOverride) ? reportDir.getFileName().toString() : replayIdOverride;
      return new ReportBundle(
          replayId,
          readUtf8(dbReplay),
          readUtf8(compare),
          awr == null ? "" : readUtf8(awr),
          capture == null ? "" : readUtf8(capture));
    }

    private static Path defaultReportsRoot(Path projectRoot) {
      Path preferred = projectRoot.resolve("reports");
      if (Files.isDirectory(preferred)) {
        return preferred;
      }
      return projectRoot.resolve("tests/fixtures/dbrep_reports");
    }
  }

  private static final class Summary {
    String replayId;
    String replayName;
    String replayStatus;
    String captureDb;
    String replayDb;
    String captureVersion;
    String replayVersion;
    Metric dbTime;
    Metric cpuTime;
    Metric userIoTime;
    String divergenceLevel;
    Double divergencePct;
    String verdict;
    String verdictIcon;
    String bottomLineBanner;
    String bottomLineDetail;
    String tone;
    String riskRating;
    String headline;
    String testObjectiveType;
    String testObjectiveReason;
    String testOutcomeValid;
    String testOutcomeReason;
    String replayVerdict;
    String capturePlatform;
    String replayPlatform;
    CpuUsage captureCpu;
    CpuUsage replayCpu;
    InstanceInfo captureInstance;
    InstanceInfo replayInstance;
    FunctionalAssessment functionalAssessment;
    List<String> findings = new ArrayList<String>();
    List<String> likelyCauses = new ArrayList<String>();
    List<String> actions = new ArrayList<String>();
    List<AddmFinding> addm = new ArrayList<AddmFinding>();
    List<TopSql> topCaptureSql = new ArrayList<TopSql>();
    List<TopSql> topReplaySql = new ArrayList<TopSql>();
    List<AwrEvent> awrEvents = new ArrayList<AwrEvent>();
    List<AwrSql> awrSql = new ArrayList<AwrSql>();
    boolean includeAwrDeepDive;
    String generatedAt;
  }

  private static final class Metric {
    String name;
    Double changePct;
    String captureTotal;
    String replayTotal;
    Double captureDbPct;
    Double replayDbPct;
  }

  private static final class CpuUsage {
    String system;
    String topology;
    String hostUsage;
    String sessionsOnCpu;
    String runQueue;
  }

  private static final class InstanceInfo {
    String cpuCores;
    String cpuSockets;
    String physicalMemory;
  }

  private static final class CaptureInfo {
    boolean available;
    String status;
    Double userCallsCaptured;
    Double userCallsWithErrors;
    int filterCount;
    int topSessionCount;
    int coreSessionCount;
    int unreplayableCount;
    int nonCoreUnreplayableCount;
    int backgroundSessionCount;
  }

  private static final class CaptureValidity {
    String representative;
    String reason;
    List<String> evidence = new ArrayList<String>();
  }

  private static final class FunctionalAssessment {
    String status;
    String divergenceLabel;
    String localizedDivergence;
    String errorSourceSummary;
    CaptureValidity captureValidity;
    List<String> highlights = new ArrayList<String>();
    List<String> actions = new ArrayList<String>();
  }

  private static final class AddmFinding {
    String name;
    Double captureImpactSec;
    Double replayImpactSec;
    Double capturePct;
    Double replayPct;
  }

  private static final class TopSql {
    String sqlId;
    String sqlText;
    Double dbTime;
  }

  private static final class AwrEvent {
    String event;
    String waitClass;
    Double replayPctDbTime;
    Double diffPctDbTime;
  }

  private static final class AwrSql {
    String sqlId;
    Double firstMetricPct;
    Double secondMetricPct;
    Double diffMetricPct;
    Double executionsFirst;
    Double executionsSecond;
    Double perExecMsFirst;
    Double perExecMsSecond;
  }

  private static final class SummaryBuilder {
    static Summary build(ReportBundle bundle, boolean includeAwrDeepDive) {
      Summary summary = new Summary();
      summary.replayId = bundle.replayId;
      summary.includeAwrDeepDive = includeAwrDeepDive;
      summary.generatedAt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss z", Locale.US).format(new Date());

      List<List<String>> dbHeaderRows = Html.tableRows(Html.findTableBySummary(bundle.dbReplayHtml, "database header"));
      Map<String, String> dbHeader = headerMap(dbHeaderRows);
      Map<String, Pair> replayInfo = pairRows(Html.tableRows(Html.findTableBySummary(bundle.dbReplayHtml, "capture/replay header")));
      Map<String, Pair> replayStats = pairRows(Html.tableRows(Html.findTableBySummary(bundle.dbReplayHtml, "capture/replay statistics")));
      Map<String, DivergenceItem> replayDivergence = divergenceRows(Html.tableRows(Html.findTableBySummary(bundle.dbReplayHtml, "replay divergence summary")));

      Map<String, Pair> databaseInfo = comparePairRows(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "Information About Databases")));
      Map<String, Metric> mainPerformance = mainPerformance(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "Main Performance Statistics")));
      Map<String, DivergenceItem> compareDivergence = compareDivergence(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "Replay Divergence")));
      Map<String, CpuUsage> cpuUsage = cpuUsage(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "CPU Usage")));

      summary.replayName = firstNonBlank(dbHeader.get("Replay Name"), getReplay(replayInfo, "Name"), "Replay " + bundle.replayId);
      summary.replayStatus = normalizeStatus(firstNonBlank(dbHeader.get("Replay Status"), getReplay(replayInfo, "Status"), "UNKNOWN"));
      summary.replayVersion = firstNonBlank(getReplay(replayInfo, "Database Version"), dbHeader.get("Release"));
      summary.captureVersion = getCapture(replayInfo, "Database Version");
      summary.replayPlatform = getReplay(databaseInfo, "Platform");
      summary.capturePlatform = getCapture(databaseInfo, "Platform");
      summary.replayDb = formatDb(firstNonBlank(getReplay(databaseInfo, "Database Name"), getReplay(replayInfo, "Database Name")), summary.replayVersion);
      summary.captureDb = formatDb(firstNonBlank(getCapture(databaseInfo, "Database Name"), getCapture(replayInfo, "Database Name")), summary.captureVersion);
      summary.dbTime = mainPerformance.get("Database Time");
      summary.cpuTime = mainPerformance.get("CPU Time");
      summary.userIoTime = mainPerformance.get("User I/O Wait Time");
      summary.captureCpu = cpuUsage.get("Capture");
      summary.replayCpu = cpuUsage.get("Replay");
      summary.captureInstance = instanceInfo(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "Instances of the Capture Database")));
      summary.replayInstance = instanceInfo(Html.tableRows(Html.tableAfterLabel(bundle.compareHtml, "Instances of the Replay Database")));

      DivergenceItem div = compareDivergence.get("Replay Divergence (compared to Capture)");
      if (div == null) {
        div = replayDivergence.get("SELECTs with Different Number of Rows Fetched");
      }
      summary.divergenceLevel = div == null || isBlank(div.level) ? "UNKNOWN" : div.level;
      summary.divergencePct = div == null ? null : div.percent;

      summary.addm = parseAddm(bundle.compareHtml);
      summary.topCaptureSql = parseTopSqlByDbTime(bundle.compareHtml, "Top SQL by DB Time for Time Period(1)");
      summary.topReplaySql = parseTopSqlByDbTime(bundle.compareHtml, "Top SQL by DB Time for Time Period(2)");
      if (includeAwrDeepDive && !isBlank(bundle.awrHtml)) {
        summary.awrEvents = parseAwrEvents(bundle.awrHtml);
        summary.awrSql = parseAwrSql(bundle.awrHtml);
      }

      CaptureInfo captureInfo = parseCaptureInfo(bundle.captureHtml);
      buildNarrative(summary, replayStats, mainPerformance, captureInfo);
      return summary;
    }

    private static void buildNarrative(Summary summary, Map<String, Pair> replayStats, Map<String, Metric> mainPerformance, CaptureInfo captureInfo) {
      Double dbChange = summary.dbTime == null ? null : summary.dbTime.changePct;
      Double cpuChange = summary.cpuTime == null ? null : summary.cpuTime.changePct;
      Double divergencePct = summary.divergencePct;
      Pair userCalls = findMetric(replayStats, "user", "calls");
      Pair finishedSessions = findMetric(replayStats, "finished", "sessions");
      Metric compareUserCalls = mainPerformance.get("User Calls");
      String userCallsCapture = firstNonBlank(compareUserCalls == null ? "" : compareUserCalls.captureTotal, userCalls == null ? "" : userCalls.capture);
      String userCallsReplay = firstNonBlank(compareUserCalls == null ? "" : compareUserCalls.replayTotal, userCalls == null ? "" : userCalls.replay);
      Double userCallsDiffPct = compareMagnitudePct(userCallsCapture, userCallsReplay);
      Boolean userCallsSimilar = userCallsDiffPct == null ? null : Boolean.valueOf(Math.abs(userCallsDiffPct.doubleValue()) <= 10.0);
      Double sessionsDiffPct = finishedSessions == null ? null : compareMagnitudePct(finishedSessions.capture, finishedSessions.replay);
      Boolean sessionsStable = sessionsDiffPct == null ? null : Boolean.valueOf(sessionsDiffPct.doubleValue() >= -5.0);
      Integer captureCores = coreCount(summary.captureCpu, summary.captureInstance);
      Integer replayCores = coreCount(summary.replayCpu, summary.replayInstance);
      boolean cpuMismatch = captureCores != null && replayCores != null && replayCores.intValue() < captureCores.intValue();
      Double captureMemoryGb = parseMemoryInGb(summary.captureInstance == null ? "" : summary.captureInstance.physicalMemory);
      Double replayMemoryGb = parseMemoryInGb(summary.replayInstance == null ? "" : summary.replayInstance.physicalMemory);
      boolean memoryReduced = captureMemoryGb != null && replayMemoryGb != null && replayMemoryGb.doubleValue() < captureMemoryGb.doubleValue();
      String divergenceAssessment = classifyDivergence(divergencePct);
      CaptureValidity captureValidity = summarizeCaptureValidity(captureInfo);
      summary.functionalAssessment = buildFunctionalAssessment(summary, captureInfo, captureValidity, divergenceAssessment);

      boolean isUpgradeTest = !isBlank(summary.captureVersion) && !isBlank(summary.replayVersion) && !summary.captureVersion.equals(summary.replayVersion);
      if (isUpgradeTest) {
        summary.testObjectiveType = "Version upgrade";
        summary.testObjectiveReason = "Capture ran on " + defaultText(summary.captureVersion) + " and replay ran on " + defaultText(summary.replayVersion) + ".";
      } else if (cpuMismatch || memoryReduced) {
        summary.testObjectiveType = "Hardware change";
        summary.testObjectiveReason = "CPU or memory configuration differs between the capture and replay environments.";
      } else if (!isBlank(summary.capturePlatform) && !isBlank(summary.replayPlatform) && !summary.capturePlatform.equals(summary.replayPlatform)) {
        summary.testObjectiveType = "Hardware change";
        summary.testObjectiveReason = "Platform differs between environments: " + summary.capturePlatform + " vs " + summary.replayPlatform + ".";
      } else {
        summary.testObjectiveType = "Unknown";
        summary.testObjectiveReason = "No major version, parameter, or hardware change was identified from the available reports.";
      }

      List<String> validityIssues = new ArrayList<String>();
      if (!"COMPLETED".equals(summary.replayStatus)) {
        validityIssues.add("Replay status is " + summary.replayStatus + ", so the workload did not complete successfully.");
      }
      if (divergencePct != null && divergencePct.doubleValue() > 20.0) {
        validityIssues.add("Replay divergence is " + fmt(divergencePct, 2) + "%, which is high enough to make the replay unreliable.");
      }
      if (userCallsSimilar != null && !userCallsSimilar.booleanValue()) {
        validityIssues.add("User Calls differ materially between capture and replay (" + signedPct(userCallsDiffPct, 1) + ").");
      }
      if (sessionsStable != null && !sessionsStable.booleanValue()) {
        validityIssues.add("Finished Replay Sessions dropped materially, indicating instability during replay.");
      }
      boolean isValid = validityIssues.isEmpty();
      summary.testOutcomeValid = isValid ? "Yes" : "No";
      summary.testOutcomeReason = isValid
          ? "Replay completed and the core comparability checks do not show a major fidelity failure."
          : join(" ", validityIssues);

      if (!"COMPLETED".equals(summary.replayStatus)) {
        summary.findings.add("Replay status is " + summary.replayStatus + "; validate replay logs before using the comparison for promotion decisions.");
      } else {
        summary.findings.add("Replay completed successfully.");
      }
      if (dbChange != null) {
        if (dbChange <= -10.0) {
          summary.findings.add("Database Time improved by " + fmt(Math.abs(dbChange), 1) + "% in replay.");
        } else if (dbChange >= 10.0) {
          summary.findings.add("Database Time regressed by " + fmt(dbChange, 1) + "% in replay.");
        } else {
          summary.findings.add("Database Time is broadly similar between capture and replay (" + signedPct(dbChange, 1) + ").");
        }
      } else {
        summary.findings.add("Database Time comparison is unavailable in the supplied reports.");
      }
      if (cpuChange != null) {
        summary.findings.add("CPU Time changed by " + signedPct(cpuChange, 1) + "; replay CPU share is " + nullSafePct(summary.cpuTime.replayDbPct) + " of DB time.");
      }
      if (divergencePct != null && divergencePct > 0) {
        summary.findings.add("Replay divergence is " + fmt(divergencePct, 2) + "% of calls (Oracle label: " + summary.divergenceLevel + ").");
      }
      if (userCallsDiffPct != null) {
        summary.findings.add(Boolean.TRUE.equals(userCallsSimilar)
            ? "User Calls are similar between capture and replay (" + defaultText(userCallsCapture) + " -> " + defaultText(userCallsReplay) + ", " + signedPct(userCallsDiffPct, 1) + " difference)."
            : "User Calls differ materially between capture and replay (" + defaultText(userCallsCapture) + " -> " + defaultText(userCallsReplay) + ", " + signedPct(userCallsDiffPct, 1) + " difference).");
      }
      if (finishedSessions != null) {
        summary.findings.add(Boolean.FALSE.equals(sessionsStable)
            ? "Finished Replay Sessions dropped from " + defaultText(finishedSessions.capture) + " to " + defaultText(finishedSessions.replay) + ", which suggests replay instability."
            : "Finished Replay Sessions stayed broadly consistent (" + defaultText(finishedSessions.capture) + " -> " + defaultText(finishedSessions.replay) + ").");
      }
      if (captureCores != null && replayCores != null) {
        if (replayCores.intValue() < captureCores.intValue()) {
          summary.findings.add("CPU cores decreased from " + captureCores + " to " + replayCores + ", which can degrade performance.");
        } else if (replayCores.intValue() > captureCores.intValue()) {
          summary.findings.add("CPU cores increased from " + captureCores + " to " + replayCores + ", which can make the result look better than capture.");
        } else {
          summary.findings.add("CPU core count is the same in capture and replay (" + captureCores + ").");
        }
      }
      if (summary.captureInstance != null || summary.replayInstance != null) {
        String captureMemory = summary.captureInstance == null ? "" : summary.captureInstance.physicalMemory;
        String replayMemory = summary.replayInstance == null ? "" : summary.replayInstance.physicalMemory;
        summary.findings.add(memoryReduced
            ? "Physical memory decreased from " + defaultText(captureMemory) + " to " + defaultText(replayMemory) + "."
            : "Physical memory appears comparable (" + defaultText(captureMemory) + " -> " + defaultText(replayMemory) + ").");
      }

      AddmFinding topAddm = summary.addm.isEmpty() ? null : summary.addm.get(0);
      if (topAddm != null) {
        summary.likelyCauses.add("The largest replay ADDM signal is " + topAddm.name + " at " + nullSafePct(topAddm.replayPct) + " of active sessions.");
      }
      if (cpuMismatch) {
        summary.likelyCauses.add("Replay environment is CPU-downgraded versus capture.");
      }
      if (memoryReduced) {
        summary.likelyCauses.add("Replay environment has less physical memory than capture.");
      }
      if (cpuChange != null && cpuChange > 0) {
        summary.likelyCauses.add("CPU consumption increased, which can happen when I/O waits fall away, SQL plans change, or parse/metadata work rises.");
      }
      if (userCalls != null) {
        summary.likelyCauses.add("Replay user calls were " + defaultText(userCalls.replay) + " versus capture user calls " + defaultText(userCalls.capture) + ".");
      }
      if (summary.likelyCauses.isEmpty()) {
        summary.likelyCauses.add("No single dominant cause was available from the parsed report tables.");
      }

      summary.actions.add("Prioritize DB Time and divergence together; workload-level DB Time takes precedence over isolated SQL-level changes.");
      summary.actions.add(summary.topReplaySql.isEmpty()
          ? "Top replay SQL by DB Time was unavailable; review the original Compare Period report for SQL detail."
          : "Review top replay SQL by DB Time: " + joinSqlIds(summary.topReplaySql, 3) + ".");
      if (cpuMismatch) {
        summary.actions.add("Re-run with CPU parity if the goal is an apples-to-apples validation.");
      }
      if (memoryReduced) {
        summary.actions.add("Validate replay on equivalent memory capacity if this is not an intentional hardware-change test.");
      }
      summary.actions.add("Validate replay comparability before promoting the tested change, especially if divergence, errors, or environment differences are present.");

      String performanceStatus = "Mixed";
      if (!"COMPLETED".equals(summary.replayStatus)) {
        performanceStatus = "Not reliable";
      } else if (dbChange != null && dbChange >= 10.0) {
        performanceStatus = "Degraded";
      } else if (dbChange != null && dbChange <= -10.0) {
        performanceStatus = "Good";
      }
      summary.replayVerdict = "degraded";
      if ("Invalid".equals(summary.functionalAssessment.status)) {
        summary.replayVerdict = "invalid";
      } else if ("Good".equals(performanceStatus) && "Usable".equals(summary.functionalAssessment.status)) {
        summary.replayVerdict = "good";
      }
      if ("invalid".equals(summary.replayVerdict)) {
        summary.verdictIcon = "FAIL";
        summary.verdict = "bad";
        summary.tone = "negative";
        summary.bottomLineDetail = "Invalid replay result";
      } else if ("good".equals(summary.replayVerdict)) {
        summary.verdictIcon = "PASS";
        summary.verdict = "good";
        summary.tone = "positive";
        summary.bottomLineDetail = cpuMismatch
            ? "Good replay result (with comparability caveat: fewer replay CPU cores than capture)"
            : "Good replay result";
      } else {
        summary.verdictIcon = "WARN";
        summary.verdict = "mixed";
        summary.tone = "caution";
        summary.bottomLineDetail = "Degraded or mixed test result";
      }
      summary.bottomLineBanner = "Bottom line: " + verdictLabelText(summary.bottomLineDetail);
      summary.riskRating = riskRating(summary, dbChange, divergencePct, cpuMismatch, memoryReduced);
      summary.headline = summary.replayName + " finished with status " + summary.replayStatus + ". "
          + dbTimePhrase(dbChange) + " " + divergencePhrase(summary.divergenceLevel, divergencePct)
          + " Overall verdict: " + summary.verdict + ".";
      if (cpuMismatch) {
        summary.headline += " Replay has fewer CPU cores than capture (" + captureCores + " vs " + replayCores + "), which weakens comparability and can explain slower replay.";
      }
      if (memoryReduced) {
        summary.headline += " Replay also has lower physical memory than capture.";
      }
    }
  }

  private static final class SummaryRenderer {
    static String render(Summary summary) {
      String dbTimeChart = metricChart("DB Time", summary.dbTime, "seconds");
      String cpuChart = metricChart("CPU Time", summary.cpuTime, "seconds");
      String userIoChart = metricChart("User I/O Wait Time", summary.userIoTime, "seconds");
      String topSqlRows = topSqlRows(summary.topReplaySql);
      String addmRows = addmRows(summary.addm);
      String functionalSection = functionalSection(summary.functionalAssessment);
      String awrDeepDive = summary.includeAwrDeepDive ? awrDeepDive(summary) : "";

      String toneColor = "positive".equals(summary.tone) ? "#166534" : "negative".equals(summary.tone) ? "#991b1b" : "#92400e";
      String toneBg = "positive".equals(summary.tone) ? "rgba(22,101,52,.12)" : "negative".equals(summary.tone) ? "rgba(153,27,27,.12)" : "rgba(146,64,14,.12)";

      return "<!DOCTYPE html>\n"
          + "<html lang=\"en\"><head><meta charset=\"UTF-8\"><title>Replay Executive Summary " + esc(summary.replayId) + "</title>\n"
          + "<style>\n"
          + ":root{--ink:#172033;--muted:#526174;--line:rgba(23,32,51,.12);--bg:#fbfaf6;--panel:#fff;--accent:#0f766e}"
          + "*{box-sizing:border-box}body{margin:0;color:var(--ink);font:16px/1.55 \"Segoe UI\",Arial,sans-serif;background:linear-gradient(180deg,#fffefb 0%,var(--bg) 100%)}"
          + "main{max-width:1120px;margin:0 auto;padding:36px 20px 64px}.hero{padding:28px;border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 18px 45px rgba(15,23,42,.08)}"
          + "h1{margin:0 0 10px;font-size:2rem;line-height:1.12}h2{margin:0 0 14px;font-size:1.35rem}h3{margin:0 0 10px;font-size:1.05rem}.sub{color:var(--muted);margin:0;max-width:880px}"
          + ".eyebrow{color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-size:.76rem;font-weight:700}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;margin-top:18px}"
          + ".card,.summary-block{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:18px}.value{margin-top:8px;font-size:1.1rem;font-weight:800}section{margin-top:28px}"
          + ".verdict{display:inline-flex;align-items:center;border-radius:999px;padding:8px 12px;font-weight:800;margin-top:16px}.clean{margin:0;padding-left:20px}.clean li{margin:9px 0}"
          + "table{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line);border-radius:14px;overflow:hidden}th,td{padding:11px 13px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f8fafc}"
          + ".metric-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.metric-chart{border:1px solid var(--line);border-radius:14px;background:#fcfdfd;padding:12px}.metric-row{margin:8px 0}.metric-meta{display:flex;justify-content:space-between;gap:8px;font-size:.9rem}.bar-track{height:10px;border-radius:999px;background:#e5e7eb;overflow:hidden}.bar-fill{height:100%;border-radius:999px}.capture{background:#2563eb}.replay{background:#dc2626}"
          + "@media print{body{background:white}.hero,.card,.summary-block,.metric-chart{box-shadow:none}}\n"
          + "</style></head><body><main>\n"
          + "<section class=\"hero\"><div class=\"eyebrow\">Oracle Database Replay Executive Summary</div><h1>Replay Name: " + esc(summary.replayName) + "</h1>"
          + "<p class=\"sub\">" + esc(summary.headline) + "</p><div class=\"verdict\" style=\"color:" + toneColor + ";background:" + toneBg + "\">" + esc(defaultText(summary.verdictIcon)) + " " + esc(defaultText(summary.bottomLineBanner)) + "</div>"
          + "<div class=\"cards\"><div class=\"card\"><div class=\"eyebrow\">Risk Rating</div><div class=\"value\">" + esc(summary.riskRating) + "</div></div>"
          + "<div class=\"card\"><div class=\"eyebrow\">Replay Database</div><div class=\"value\">" + esc(defaultDash(summary.replayDb)) + "</div></div>"
          + "<div class=\"card\"><div class=\"eyebrow\">Capture Database</div><div class=\"value\">" + esc(defaultDash(summary.captureDb)) + "</div></div></div></section>\n"
          + "<section><h2>Executive Summary</h2><div class=\"summary-block\">" + esc(executiveParagraph(summary)) + "</div></section>\n"
          + "<section><h2>Replay At-a-Glance</h2><div class=\"summary-block\"><ul class=\"clean\">"
          + "<li><strong>Verdict:</strong> " + esc(defaultText(summary.replayVerdict)) + "</li>"
          + "<li><strong>Replay status:</strong> " + esc(summary.replayStatus) + "</li>"
          + "<li><strong>Test outcome:</strong> " + esc(defaultText(summary.testOutcomeValid)) + " - " + esc(defaultText(summary.testOutcomeReason)) + "</li>"
          + "<li><strong>Test objective:</strong> " + esc(defaultText(summary.testObjectiveType)) + " - " + esc(defaultText(summary.testObjectiveReason)) + "</li>"
          + "<li><strong>Database Time:</strong> " + esc(metricSummary(summary.dbTime)) + "</li>"
          + "<li><strong>CPU Time:</strong> " + esc(metricSummary(summary.cpuTime)) + "</li>"
          + "<li><strong>Divergence:</strong> " + esc(divergenceValue(summary.divergenceLevel, summary.divergencePct)) + "</li>"
          + "</ul></div></section>\n"
          + functionalSection
          + "<section><h2>Performance Assessment</h2><div class=\"summary-block\"><div class=\"metric-charts\">" + dbTimeChart + cpuChart + userIoChart + "</div>"
          + "<h3>Key Findings</h3><ul class=\"clean\">" + listItems(summary.findings) + "</ul>"
          + "<h3>Likely Causes</h3><ul class=\"clean\">" + listItems(summary.likelyCauses) + "</ul>"
          + "<h3>Recommended Actions</h3><ul class=\"clean\">" + listItems(summary.actions) + "</ul></div></section>\n"
          + "<section><h2>Replay SQL Drivers</h2><table><tr><th>SQL ID</th><th>Replay DB Time</th><th>SQL Text</th></tr>" + topSqlRows + "</table></section>\n"
          + "<section><h2>ADDM Comparison Signals</h2><table><tr><th>Finding</th><th>Capture Impact</th><th>Replay Impact</th><th>Replay Share</th></tr>" + addmRows + "</table></section>\n"
          + awrDeepDive
          + "<section><h2>Final Verdict</h2><div class=\"summary-block\"><strong>" + esc(defaultText(summary.bottomLineDetail)) + "</strong>"
          + "<div style=\"margin-top:10px;\">" + esc(defaultText(summary.testOutcomeReason)) + "</div></div></section>\n"
          + "<section><h2>Key Data Points</h2><table><tr><th>Metric</th><th>Value</th></tr>"
          + row("Replay status", summary.replayStatus)
          + row("Replay divergence", divergenceValue(summary.divergenceLevel, summary.divergencePct))
          + row("Database Time change", changeValue(summary.dbTime))
          + row("CPU Time change", changeValue(summary.cpuTime))
          + row("Capture CPU topology", summary.captureCpu == null ? "" : summary.captureCpu.topology)
          + row("Replay CPU topology", summary.replayCpu == null ? "" : summary.replayCpu.topology)
          + row("Capture physical memory", summary.captureInstance == null ? "" : summary.captureInstance.physicalMemory)
          + row("Replay physical memory", summary.replayInstance == null ? "" : summary.replayInstance.physicalMemory)
          + row("Generated", summary.generatedAt)
          + "</table></section>\n"
          + "<section><h2>Java Utility Notes</h2><div class=\"summary-block\">Generated by the standalone Java 8 utility. LLM narrative mode is not used; all text is deterministic and derived from supplied report tables.</div></section>\n"
          + "</main></body></html>\n";
    }

    private static String awrDeepDive(Summary summary) {
      return "<section><h2>Detailed Drill-down (AWR Compare)</h2><div class=\"summary-block\">"
          + "<p style=\"margin-top:0;\">AWR sections are included because --include-awr-deep-dive was supplied.</p>"
          + "</div></section>"
          + "<section><h2>AWR Wait Events Focus</h2><table><tr><th>Event</th><th>Wait Class</th><th>Replay % DB Time</th><th>Diff % DB Time</th></tr>"
          + awrEventRows(summary.awrEvents) + "</table></section>"
          + "<section><h2>AWR SQL-Level Comparison</h2><table><tr><th>SQL ID</th><th>Diff % Metric</th><th>1st Execs</th><th>2nd Execs</th><th>Per-Exec Change</th></tr>"
          + awrSqlRows(summary.awrSql) + "</table></section>";
    }
  }

  private static Map<String, String> headerMap(List<List<String>> rows) {
    Map<String, String> result = new LinkedHashMap<String, String>();
    if (rows.size() < 2) {
      return result;
    }
    List<String> headers = rows.get(0);
    List<String> values = rows.get(1);
    for (int i = 0; i < headers.size(); i++) {
      result.put(headers.get(i), i < values.size() ? values.get(i) : "");
    }
    return result;
  }

  private static Map<String, Pair> pairRows(List<List<String>> rows) {
    Map<String, Pair> result = new LinkedHashMap<String, Pair>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 2) {
        result.put(cells.get(0), new Pair(cells.get(1), cells.size() >= 3 ? cells.get(2) : ""));
      }
    }
    return result;
  }

  private static Map<String, Pair> comparePairRows(List<List<String>> rows) {
    Map<String, Pair> result = new LinkedHashMap<String, Pair>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 3) {
        result.put(cells.get(0), new Pair(cells.get(2), cells.get(1)));
      }
    }
    return result;
  }

  private static Map<String, DivergenceItem> divergenceRows(List<List<String>> rows) {
    Map<String, DivergenceItem> result = new LinkedHashMap<String, DivergenceItem>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 2) {
        DivergenceItem item = new DivergenceItem();
        item.count = toNumber(cells.get(1));
        item.percent = cells.size() >= 3 ? toNumber(cells.get(2)) : null;
        result.put(cells.get(0), item);
      }
    }
    return result;
  }

  private static Map<String, DivergenceItem> compareDivergence(List<List<String>> rows) {
    Map<String, DivergenceItem> result = new LinkedHashMap<String, DivergenceItem>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 3) {
        DivergenceItem item = new DivergenceItem();
        item.level = cells.get(1);
        item.percent = toNumber(cells.get(2));
        result.put(cells.get(0), item);
      }
    }
    return result;
  }

  private static Map<String, Metric> mainPerformance(List<List<String>> rows) {
    Map<String, Metric> result = new LinkedHashMap<String, Metric>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 2) {
        Metric metric = new Metric();
        metric.name = cells.get(0);
        metric.changePct = toNumber(cells.get(1));
        metric.captureTotal = cells.size() > 2 ? cells.get(2) : "";
        metric.replayTotal = cells.size() > 3 ? cells.get(3) : "";
        metric.captureDbPct = cells.size() > 4 ? toNumber(cells.get(4)) : null;
        metric.replayDbPct = cells.size() > 5 ? toNumber(cells.get(5)) : null;
        result.put(metric.name, metric);
      }
    }
    return result;
  }

  private static Map<String, CpuUsage> cpuUsage(List<List<String>> rows) {
    Map<String, CpuUsage> result = new LinkedHashMap<String, CpuUsage>();
    for (int i = 1; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() >= 2) {
        CpuUsage usage = new CpuUsage();
        usage.system = cells.get(0);
        usage.topology = cells.size() > 1 ? cells.get(1) : "";
        usage.hostUsage = cells.size() > 2 ? cells.get(2) : "";
        usage.sessionsOnCpu = cells.size() > 3 ? cells.get(3) : "";
        usage.runQueue = cells.size() > 4 ? cells.get(4) : "";
        result.put(usage.system, usage);
      }
    }
    return result;
  }

  private static InstanceInfo instanceInfo(List<List<String>> rows) {
    if (rows.size() < 2) {
      return null;
    }
    List<String> headers = rows.get(0);
    List<String> values = rows.get(1);
    InstanceInfo info = new InstanceInfo();
    for (int i = 0; i < headers.size() && i < values.size(); i++) {
      String header = headers.get(i).toLowerCase(Locale.US);
      if (header.contains("cpu cores")) {
        info.cpuCores = values.get(i);
      } else if (header.contains("cpu sockets")) {
        info.cpuSockets = values.get(i);
      } else if (header.contains("physical memory")) {
        info.physicalMemory = values.get(i);
      }
    }
    return info;
  }

  private static CaptureInfo parseCaptureInfo(String html) {
    CaptureInfo info = new CaptureInfo();
    info.available = !isBlank(html);
    if (!info.available) {
      return info;
    }
    Map<String, String> captureDb = headerMap(Html.tableRows(Html.findTableBySummary(html, "capture database")));
    info.status = firstNonBlank(captureDb.get("Status"), captureDb.get("Capture Status"));
    List<List<String>> statsRows = Html.tableRows(Html.findTableBySummary(html, "captured workload statistics"));
    for (int i = 1; i < statsRows.size(); i++) {
      List<String> cells = statsRows.get(i);
      if (cells.size() < 2) {
        continue;
      }
      String name = cells.get(0).toLowerCase(Locale.US);
      if (name.contains("user calls captured with errors")) {
        info.userCallsWithErrors = toNumber(cells.get(1));
      } else if (name.contains("user calls captured")) {
        info.userCallsCaptured = toNumber(cells.get(1));
      }
    }
    List<List<String>> filterRows = Html.tableRows(Html.findTableBySummary(html, "workload capture filters"));
    info.filterCount = Math.max(0, filterRows.size() - 1);
    List<List<String>> topSessions = Html.tableRows(Html.findTableBySummary(html, "Top Sessions Captured"));
    for (int i = 1; i < topSessions.size(); i++) {
      List<String> cells = topSessions.get(i);
      if (cells.size() >= 6) {
        info.topSessionCount++;
        if (!isNonCoreWorkloadIdentity(cells.get(4), cells.get(5), "", "")) {
          info.coreSessionCount++;
        }
      }
    }
    List<List<String>> unreplayableSessions = Html.tableRows(Html.findTableBySummary(html, "Top Sessions containing Unreplayable Calls"));
    for (int i = 1; i < unreplayableSessions.size(); i++) {
      List<String> cells = unreplayableSessions.get(i);
      if (cells.size() >= 6) {
        info.unreplayableCount++;
        if (isNonCoreWorkloadIdentity(cells.get(4), cells.get(5), "", "")) {
          info.nonCoreUnreplayableCount++;
        }
      }
    }
    List<List<String>> unreplayableServices = Html.tableRows(Html.findTableBySummary(html, "Top Service/Module containing Unreplayable Calls"));
    for (int i = 1; i < unreplayableServices.size(); i++) {
      List<String> cells = unreplayableServices.get(i);
      if (cells.size() >= 2) {
        info.unreplayableCount++;
        if (isNonCoreWorkloadIdentity("", "", cells.get(0), cells.get(1))) {
          info.nonCoreUnreplayableCount++;
        }
      }
    }
    info.backgroundSessionCount = Math.max(0, Html.tableRows(Html.findTableBySummary(html, "Top Sessions (Jobs and Background Activity)")).size() - 1);
    return info;
  }

  private static CaptureValidity summarizeCaptureValidity(CaptureInfo capture) {
    CaptureValidity validity = new CaptureValidity();
    if (capture == null || !capture.available) {
      validity.representative = "Unknown";
      validity.reason = "Database Capture Report is missing.";
      return validity;
    }
    String status = defaultText(capture.status).toUpperCase(Locale.US);
    boolean representative = status.contains("COMPLETED")
        && value(capture.userCallsCaptured) > 0.0
        && capture.coreSessionCount > 0;
    validity.representative = representative ? "Likely representative" : "Potentially unrepresentative";
    validity.reason = representative
        ? "Capture includes meaningful application sessions and completed cleanly."
        : "Capture appears limited, background-heavy, or did not complete cleanly.";
    if (!isBlank(status) && !"UNKNOWN".equals(status)) {
      validity.evidence.add("Capture status: " + status + ".");
    }
    if (capture.userCallsCaptured != null) {
      validity.evidence.add("User calls captured: " + fmt(capture.userCallsCaptured, 0) + ".");
    }
    if (capture.userCallsWithErrors != null) {
      validity.evidence.add("Captured calls with errors: " + fmt(capture.userCallsWithErrors, 0) + ".");
    }
    if (capture.filterCount > 0) {
      validity.evidence.add("Capture filters are present (" + capture.filterCount + ").");
    }
    return validity;
  }

  private static FunctionalAssessment buildFunctionalAssessment(Summary summary, CaptureInfo capture, CaptureValidity captureValidity, String divergenceLabel) {
    FunctionalAssessment assessment = new FunctionalAssessment();
    assessment.divergenceLabel = divergenceLabel;
    assessment.captureValidity = captureValidity;
    int totalUnreplayable = capture == null ? 0 : capture.unreplayableCount;
    int nonCoreUnreplayable = capture == null ? 0 : capture.nonCoreUnreplayableCount;
    boolean unreplayableMostlyNonCore = totalUnreplayable > 0 && ((double) nonCoreUnreplayable / (double) totalUnreplayable) >= 0.6;
    assessment.errorSourceSummary = totalUnreplayable == 0
        ? "No material unreplayable-call sources detected in capture report."
        : unreplayableMostlyNonCore
            ? "Unreplayable-call sources are mostly background/non-core workloads."
            : "Unreplayable-call sources include potentially core workload identities.";
    boolean localizedDivergence = "Good".equals(divergenceLabel)
        || ("Moderate".equals(divergenceLabel) && (unreplayableMostlyNonCore || totalUnreplayable <= 2));
    assessment.localizedDivergence = localizedDivergence ? "Yes" : "No";
    assessment.status = !"COMPLETED".equals(summary.replayStatus) || "High".equals(divergenceLabel)
        ? "Invalid"
        : "Moderate".equals(divergenceLabel) && !localizedDivergence
            ? "Degraded"
            : "Usable";
    if (capture == null || !capture.available) {
      assessment.highlights.add("Capture report is not available, so workload representativeness cannot be verified.");
    } else {
      assessment.highlights.add("Capture validity: " + captureValidity.representative + ".");
      if (unreplayableMostlyNonCore) {
        assessment.highlights.add("Unreplayable activity appears concentrated in background or non-core workloads.");
      } else if (totalUnreplayable > 0) {
        assessment.highlights.add("Unreplayable activity includes potentially core workloads and needs review.");
      }
      if (capture.backgroundSessionCount > 0) {
        assessment.highlights.add("Background activity is visible in the capture report.");
      }
    }
    if (summary.divergencePct != null) {
      assessment.highlights.add("Replay divergence is " + fmt(summary.divergencePct, 2) + "% (" + divergenceLabel + ").");
    }
    assessment.highlights.add(assessment.errorSourceSummary);
    if ("Invalid".equals(assessment.status)) {
      assessment.actions.add("Treat this replay as invalid and rerun after fixing capture/replay comparability issues.");
    } else if ("Degraded".equals(assessment.status)) {
      assessment.actions.add("Replay is usable with caveats; isolate failing schemas/users/jobs before final sign-off.");
    } else {
      assessment.actions.add("Functional fidelity is acceptable for decision-making, with noted caveats if any.");
    }
    if (capture == null || !capture.available) {
      assessment.actions.add("Include Database Capture Report in future runs to validate captured workload quality.");
    }
    return assessment;
  }

  private static List<AddmFinding> parseAddm(String html) {
    List<AddmFinding> rows = new ArrayList<AddmFinding>();
    String table = Html.findTableBySummary(html, "top statistics");
    for (List<String> cells : Html.tableRows(table)) {
      if (cells.size() < 5 || "impact (sec)".equalsIgnoreCase(cells.get(2))) {
        continue;
      }
      AddmFinding row = new AddmFinding();
      row.name = cells.get(0);
      List<String> impact = splitPairText(cells.get(2));
      List<String> pct = splitPairText(cells.get(4));
      row.captureImpactSec = impact.size() > 0 ? toNumber(impact.get(0)) : null;
      row.replayImpactSec = impact.size() > 1 ? toNumber(impact.get(1)) : null;
      row.capturePct = pct.size() > 0 ? toNumber(pct.get(0)) : null;
      row.replayPct = pct.size() > 1 ? toNumber(pct.get(1)) : null;
      rows.add(row);
    }
    Collections.sort(rows, new Comparator<AddmFinding>() {
      public int compare(AddmFinding a, AddmFinding b) {
        return Double.compare(value(b.replayPct), value(a.replayPct));
      }
    });
    return rows;
  }

  private static List<TopSql> parseTopSqlByDbTime(String html, String summaryFragment) {
    List<TopSql> result = new ArrayList<TopSql>();
    String table = Html.findTableBySummary(html, summaryFragment);
    if (isBlank(table)) {
      return result;
    }
    Pattern sqlIdCell = Pattern.compile("<td[^>]*>\\s*([0-9a-v]{13})\\s*</td>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    Matcher matcher = sqlIdCell.matcher(table);
    List<int[]> hits = new ArrayList<int[]>();
    List<String> ids = new ArrayList<String>();
    while (matcher.find()) {
      hits.add(new int[] {matcher.start(), matcher.end()});
      ids.add(matcher.group(1).toLowerCase(Locale.US));
    }
    for (int i = 0; i < hits.size(); i++) {
      int segmentStart = hits.get(i)[1];
      int segmentEnd = i + 1 < hits.size() ? hits.get(i + 1)[0] : table.length();
      String body = table.substring(segmentStart, segmentEnd);
      TopSql row = new TopSql();
      row.sqlId = ids.get(i);
      row.dbTime = lastSimpleNumberCell(body);
      String summary = firstMatch(body, "id\\s*=\\s*['\"][^'\"]*_summary['\"][^>]*>(.*?)</td>");
      row.sqlText = Html.text(summary);
      result.add(row);
    }
    return result;
  }

  private static List<AwrEvent> parseAwrEvents(String html) {
    List<AwrEvent> result = new ArrayList<AwrEvent>();
    String table = Html.findTableBySummary(html, "top timed events");
    List<List<String>> rows = Html.tableRows(table);
    for (int i = 2; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      if (cells.size() < 6) {
        continue;
      }
      AwrEvent event = new AwrEvent();
      event.event = cells.get(0);
      event.waitClass = cells.size() > 1 ? cells.get(1) : "";
      event.replayPctDbTime = cells.size() > 7 ? toNumber(cells.get(7)) : null;
      event.diffPctDbTime = cells.size() > 8 ? toNumber(cells.get(8)) : null;
      if (!isBlank(event.event)) {
        result.add(event);
      }
    }
    return first(result, 5);
  }

  private static List<AwrSql> parseAwrSql(String html) {
    List<AwrSql> result = new ArrayList<AwrSql>();
    String table = Html.findTableBySummary(html, "top SQL comparisons by elapsed time");
    List<List<String>> rows = Html.tableRows(table);
    for (int i = 2; i < rows.size(); i++) {
      List<String> cells = rows.get(i);
      String sqlId = normalizeSqlId(cells.isEmpty() ? "" : cells.get(0));
      if (isBlank(sqlId)) {
        continue;
      }
      AwrSql row = new AwrSql();
      row.sqlId = sqlId;
      row.firstMetricPct = cells.size() > 1 ? toNumber(cells.get(1)) : null;
      row.secondMetricPct = cells.size() > 3 ? toNumber(cells.get(3)) : null;
      row.diffMetricPct = cells.size() > 5 ? toNumber(cells.get(5)) : null;
      row.executionsFirst = cells.size() > 7 ? toNumber(cells.get(7)) : null;
      row.executionsSecond = cells.size() > 8 ? toNumber(cells.get(8)) : null;
      row.perExecMsFirst = cells.size() > 9 ? toNumber(cells.get(9)) : null;
      row.perExecMsSecond = cells.size() > 10 ? toNumber(cells.get(10)) : null;
      result.add(row);
    }
    Collections.sort(result, new Comparator<AwrSql>() {
      public int compare(AwrSql a, AwrSql b) {
        return Double.compare(Math.abs(value(b.diffMetricPct)), Math.abs(value(a.diffMetricPct)));
      }
    });
    return first(result, 5);
  }

  private static final class Html {
    private static final Pattern TABLE_OPEN = Pattern.compile("<table\\b[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern TABLE_TOKEN = Pattern.compile("</?table\\b[^>]*>", Pattern.CASE_INSENSITIVE);

    static String findTableBySummary(String html, String summaryFragment) {
      if (isBlank(html)) {
        return "";
      }
      Matcher matcher = TABLE_OPEN.matcher(html);
      String needle = compact(summaryFragment);
      while (matcher.find()) {
        String tag = matcher.group();
        String summary = firstMatch(tag, "summary\\s*=\\s*['\"]([^'\"]*)['\"]");
        if (!isBlank(summary) && compact(summary).contains(needle)) {
          return extractBalancedTable(html, matcher.start());
        }
      }
      return "";
    }

    static String tableAfterLabel(String html, String label) {
      if (isBlank(html)) {
        return "";
      }
      int labelIndex = compactIndexOf(html, label);
      if (labelIndex < 0) {
        return "";
      }
      Matcher matcher = TABLE_OPEN.matcher(html);
      if (matcher.find(labelIndex)) {
        return extractBalancedTable(html, matcher.start());
      }
      return "";
    }

    static List<List<String>> tableRows(String tableHtml) {
      List<List<String>> rows = new ArrayList<List<String>>();
      if (isBlank(tableHtml)) {
        return rows;
      }
      Matcher rowMatcher = Pattern.compile("<tr\\b[^>]*>(.*?)</tr>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(tableHtml);
      while (rowMatcher.find()) {
        String row = rowMatcher.group(1);
        List<String> cells = new ArrayList<String>();
        Matcher cellMatcher = Pattern.compile("<t[dh]\\b[^>]*>(.*?)</t[dh]>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(row);
        while (cellMatcher.find()) {
          cells.add(text(cellMatcher.group(1)));
        }
        if (!cells.isEmpty()) {
          rows.add(cells);
        }
      }
      return rows;
    }

    static String text(String html) {
      if (html == null) {
        return "";
      }
      String text = html
          .replaceAll("(?is)<script\\b.*?</script>", " ")
          .replaceAll("(?is)<style\\b.*?</style>", " ")
          .replaceAll("(?is)<br\\s*/?>", " ")
          .replaceAll("(?is)</p>", " ")
          .replaceAll("(?is)<[^>]+>", " ");
      return unescape(text).replaceAll("\\s+", " ").trim();
    }

    private static String extractBalancedTable(String html, int start) {
      Matcher matcher = TABLE_TOKEN.matcher(html);
      int depth = 0;
      boolean found = matcher.find(start);
      while (found) {
        String token = matcher.group().toLowerCase(Locale.US);
        if (token.startsWith("</table")) {
          depth--;
          if (depth == 0) {
            return html.substring(start, matcher.end());
          }
        } else {
          depth++;
        }
        found = matcher.find();
      }
      return html.substring(start);
    }
  }

  private static final class Pair {
    final String replay;
    final String capture;

    Pair(String replay, String capture) {
      this.replay = replay;
      this.capture = capture;
    }
  }

  private static final class DivergenceItem {
    String level;
    Double count;
    Double percent;
  }

  private static Path findReportFile(Path dir, String[] primary, String[] fallback, String[] contentMatchers) throws IOException {
    List<Path> files = new ArrayList<Path>();
    for (File file : dir.toFile().listFiles()) {
      if (file.isFile() && file.getName().matches("(?i).*\\.html?$")) {
        files.add(file.toPath());
      }
    }
    Collections.sort(files);
    Path hit = findByName(files, primary);
    if (hit != null) {
      return hit;
    }
    hit = findByName(files, fallback);
    if (hit != null) {
      return hit;
    }
    for (Path file : files) {
      String content = readUtf8(file);
      for (String matcher : contentMatchers) {
        if (Pattern.compile(matcher, Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(content).find()) {
          return file;
        }
      }
    }
    return null;
  }

  private static Path findByName(List<Path> files, String[] patterns) {
    for (String pattern : patterns) {
      Pattern compiled = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
      for (Path file : files) {
        if (compiled.matcher(file.getFileName().toString()).find()) {
          return file;
        }
      }
    }
    return null;
  }

  private static String readUtf8(Path path) throws IOException {
    return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
  }

  private static String executiveParagraph(Summary summary) {
    List<String> parts = new ArrayList<String>();
    parts.add(summary.headline);
    if (!isBlank(summary.captureVersion) && !isBlank(summary.replayVersion) && !summary.captureVersion.equals(summary.replayVersion)) {
      parts.add("This is an upgrade validation from " + summary.captureVersion + " to " + summary.replayVersion + ".");
    }
    if (summary.functionalAssessment != null) {
      parts.add("Functional comparability is " + summary.functionalAssessment.status.toLowerCase(Locale.US) + " based on measured divergence and capture/replay fidelity checks.");
    }
    parts.add("The highest-priority review items are Database Time, replay divergence, environment comparability, ADDM comparison signals, and top replay SQL by DB Time.");
    return join(" ", parts);
  }

  private static String metricChart(String title, Metric metric, String unit) {
    if (metric == null) {
      return "";
    }
    Double capture = toNumber(metric.captureTotal);
    Double replay = toNumber(metric.replayTotal);
    if (capture == null && replay == null) {
      return "";
    }
    double max = Math.max(Math.max(value(capture), value(replay)), 1.0);
    int captureWidth = capture == null ? 0 : Math.max(4, (int) Math.round((capture / max) * 100.0));
    int replayWidth = replay == null ? 0 : Math.max(4, (int) Math.round((replay / max) * 100.0));
    return "<div class=\"metric-chart\"><h3>" + esc(title) + "</h3>"
        + metricBar("Capture", capture, metric.captureTotal, unit, captureWidth, "capture")
        + metricBar("Replay", replay, metric.replayTotal, unit, replayWidth, "replay")
        + "</div>";
  }

  private static String metricBar(String label, Double value, String raw, String unit, int width, String klass) {
    return "<div class=\"metric-row\"><div class=\"metric-meta\"><span>" + esc(label) + "</span><strong>"
        + esc(value == null ? defaultDash(raw) : fmt(value, 2) + " " + unit)
        + "</strong></div><div class=\"bar-track\"><div class=\"bar-fill " + klass + "\" style=\"width:" + width + "%\"></div></div></div>";
  }

  private static String topSqlRows(List<TopSql> rows) {
    if (rows.isEmpty()) {
      return "<tr><td colspan=\"3\">Top SQL by DB Time was not available.</td></tr>";
    }
    StringBuilder out = new StringBuilder();
    for (TopSql row : first(rows, 8)) {
      out.append("<tr><td>").append(esc(row.sqlId)).append("</td><td>").append(esc(row.dbTime == null ? "-" : fmt(row.dbTime, 2))).append("</td><td>")
          .append(esc(defaultDash(row.sqlText))).append("</td></tr>");
    }
    return out.toString();
  }

  private static String addmRows(List<AddmFinding> rows) {
    if (rows.isEmpty()) {
      return "<tr><td colspan=\"4\">ADDM comparison data was not available.</td></tr>";
    }
    StringBuilder out = new StringBuilder();
    for (AddmFinding row : first(rows, 8)) {
      out.append("<tr><td>").append(esc(row.name)).append("</td><td>").append(esc(numberOrDash(row.captureImpactSec))).append("</td><td>")
          .append(esc(numberOrDash(row.replayImpactSec))).append("</td><td>").append(esc(nullSafePct(row.replayPct))).append("</td></tr>");
    }
    return out.toString();
  }

  private static String functionalSection(FunctionalAssessment assessment) {
    if (assessment == null) {
      return "<section><h2>Functional Assessment</h2><div class=\"summary-block\">Insufficient data</div></section>\n";
    }
    StringBuilder out = new StringBuilder();
    out.append("<section><h2>Functional Assessment</h2><div class=\"summary-block\">");
    out.append("<p style=\"margin-top:0;\">Status is ").append(esc(defaultText(assessment.status))).append(". ");
    out.append("Divergence is ").append(esc(defaultText(assessment.divergenceLabel))).append(". ");
    out.append(esc(defaultText(assessment.errorSourceSummary))).append(" ");
    out.append("Capture validity: ").append(esc(assessment.captureValidity == null ? "Unknown" : assessment.captureValidity.representative)).append(".</p>");
    out.append("<ul class=\"clean\">");
    out.append("<li><strong>Assessment status:</strong> ").append(esc(defaultText(assessment.status))).append("</li>");
    out.append("<li><strong>Divergence:</strong> ").append(esc(defaultText(assessment.divergenceLabel))).append("</li>");
    out.append("<li><strong>Localized divergence:</strong> ").append(esc(defaultText(assessment.localizedDivergence))).append("</li>");
    out.append("<li><strong>Error source profile:</strong> ").append(esc(defaultText(assessment.errorSourceSummary))).append("</li>");
    out.append("<li><strong>Capture validity:</strong> ").append(esc(assessment.captureValidity == null ? "Unknown" : assessment.captureValidity.representative));
    if (assessment.captureValidity != null && !isBlank(assessment.captureValidity.reason)) {
      out.append(" - ").append(esc(assessment.captureValidity.reason));
    }
    out.append("</li></ul>");
    out.append("<h3>Highlights</h3><ul class=\"clean\">").append(listItems(assessment.highlights)).append("</ul>");
    if (assessment.captureValidity != null && !assessment.captureValidity.evidence.isEmpty()) {
      out.append("<h3>Capture Evidence</h3><ul class=\"clean\">").append(listItems(assessment.captureValidity.evidence)).append("</ul>");
    }
    out.append("<h3>Actions</h3><ul class=\"clean\">").append(listItems(assessment.actions)).append("</ul>");
    out.append("</div></section>\n");
    return out.toString();
  }

  private static String awrEventRows(List<AwrEvent> rows) {
    if (rows.isEmpty()) {
      return "<tr><td colspan=\"4\">AWR top wait-event data was not available.</td></tr>";
    }
    StringBuilder out = new StringBuilder();
    for (AwrEvent row : rows) {
      out.append("<tr><td>").append(esc(row.event)).append("</td><td>").append(esc(row.waitClass)).append("</td><td>")
          .append(esc(numberOrDash(row.replayPctDbTime))).append("</td><td>").append(esc(numberOrDash(row.diffPctDbTime))).append("</td></tr>");
    }
    return out.toString();
  }

  private static String awrSqlRows(List<AwrSql> rows) {
    if (rows.isEmpty()) {
      return "<tr><td colspan=\"5\">AWR SQL comparison data was not available.</td></tr>";
    }
    StringBuilder out = new StringBuilder();
    for (AwrSql row : rows) {
      Double perExecChange = row.perExecMsFirst == null || row.perExecMsSecond == null ? null : row.perExecMsSecond - row.perExecMsFirst;
      out.append("<tr><td>").append(esc(row.sqlId)).append("</td><td>").append(esc(numberOrDash(row.diffMetricPct))).append("</td><td>")
          .append(esc(numberOrDash(row.executionsFirst))).append("</td><td>").append(esc(numberOrDash(row.executionsSecond))).append("</td><td>")
          .append(esc(numberOrDash(perExecChange))).append("</td></tr>");
    }
    return out.toString();
  }

  private static String listItems(List<String> items) {
    StringBuilder out = new StringBuilder();
    for (String item : items) {
      out.append("<li>").append(esc(item)).append("</li>");
    }
    return out.toString();
  }

  private static String row(String label, String value) {
    return "<tr><td>" + esc(label) + "</td><td>" + esc(defaultDash(value)) + "</td></tr>";
  }

  private static String metricSummary(Metric metric) {
    if (metric == null) {
      return "Unavailable";
    }
    return defaultText(metric.captureTotal) + " -> " + defaultText(metric.replayTotal) + " (" + changeValue(metric) + ")";
  }

  private static String changeValue(Metric metric) {
    return metric == null || metric.changePct == null ? "-" : signedPct(metric.changePct, 2);
  }

  private static String divergenceValue(String level, Double pct) {
    return defaultText(level) + (pct == null ? "" : " (" + fmt(pct, 2) + "%)");
  }

  private static String dbTimePhrase(Double change) {
    if (change == null) {
      return "Replay DB time comparison is unavailable.";
    }
    if (change < 0) {
      return "Replay DB time improved by " + fmt(Math.abs(change), 1) + "% versus capture.";
    }
    if (change > 0) {
      return "Replay DB time regressed by " + fmt(change, 1) + "% versus capture.";
    }
    return "Replay DB time is unchanged versus capture.";
  }

  private static String divergencePhrase(String level, Double pct) {
    if (pct == null) {
      return "Divergence is unavailable (Oracle label: " + defaultText(level) + ").";
    }
    return "Divergence is " + fmt(pct, 2) + "% of calls (Oracle label: " + defaultText(level) + ").";
  }

  private static List<String> splitPairText(String value) {
    List<String> parts = new ArrayList<String>();
    for (String part : value.split("\\s+")) {
      if (!isBlank(part) && !"Capture".equalsIgnoreCase(part) && !"Replay".equalsIgnoreCase(part)) {
        parts.add(part);
      }
    }
    return parts;
  }

  private static Double lastSimpleNumberCell(String html) {
    Matcher matcher = Pattern.compile("<td[^>]*>\\s*([+-]?[0-9][0-9,]*(?:\\.[0-9]+)?)\\s*</td>", Pattern.CASE_INSENSITIVE).matcher(html);
    Double value = null;
    while (matcher.find()) {
      value = toNumber(matcher.group(1));
    }
    return value;
  }

  private static String firstMatch(String text, String regex) {
    Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(text == null ? "" : text);
    return matcher.find() ? matcher.group(1) : "";
  }

  private static Pair findMetric(Map<String, Pair> rows, String partA, String partB) {
    for (Map.Entry<String, Pair> entry : rows.entrySet()) {
      String key = entry.getKey().toLowerCase(Locale.US);
      if (key.contains(partA) && key.contains(partB)) {
        return entry.getValue();
      }
    }
    return null;
  }

  private static String getReplay(Map<String, Pair> rows, String key) {
    Pair pair = rows.get(key);
    return pair == null ? "" : pair.replay;
  }

  private static String getCapture(Map<String, Pair> rows, String key) {
    Pair pair = rows.get(key);
    return pair == null ? "" : pair.capture;
  }

  private static String formatDb(String name, String version) {
    if (isBlank(name) && isBlank(version)) {
      return "";
    }
    return isBlank(version) ? name : defaultText(name) + " (" + version + ")";
  }

  private static String normalizeStatus(String status) {
    String value = defaultText(status).toUpperCase(Locale.US);
    if (value.contains("ABORT")) {
      return "ABORTED";
    }
    if (value.contains("FAIL")) {
      return "FAILED";
    }
    if (value.contains("COMPLETE")) {
      return "COMPLETED";
    }
    return value;
  }

  private static Double compareMagnitudePct(String left, String right) {
    Double leftNum = toNumber(left);
    Double rightNum = toNumber(right);
    if (leftNum == null || rightNum == null || leftNum.doubleValue() == 0.0) {
      return null;
    }
    return Double.valueOf(((rightNum.doubleValue() - leftNum.doubleValue()) / leftNum.doubleValue()) * 100.0);
  }

  private static Integer coreCount(CpuUsage cpuUsage, InstanceInfo instanceInfo) {
    if (cpuUsage != null) {
      Integer parsed = parseCoreCount(cpuUsage.topology);
      if (parsed != null) {
        return parsed;
      }
    }
    if (instanceInfo != null) {
      Double cores = toNumber(instanceInfo.cpuCores);
      if (cores != null) {
        return Integer.valueOf((int) Math.round(cores.doubleValue()));
      }
    }
    return null;
  }

  private static Integer parseCoreCount(String topology) {
    Matcher matcher = Pattern.compile("(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)").matcher(topology == null ? "" : topology);
    return matcher.find() ? Integer.valueOf(matcher.group(2)) : null;
  }

  private static Double parseMemoryInGb(String value) {
    if (isBlank(value)) {
      return null;
    }
    Double number = toNumber(value);
    if (number == null) {
      return null;
    }
    String text = value.toUpperCase(Locale.US);
    if (text.contains("TB")) {
      return Double.valueOf(number.doubleValue() * 1024.0);
    }
    if (text.contains("GB") || Pattern.compile("\\bG\\b").matcher(text).find()) {
      return number;
    }
    if (text.contains("MB") || Pattern.compile("\\bM\\b").matcher(text).find()) {
      return Double.valueOf(number.doubleValue() / 1024.0);
    }
    if (text.contains("KB") || Pattern.compile("\\bK\\b").matcher(text).find()) {
      return Double.valueOf(number.doubleValue() / (1024.0 * 1024.0));
    }
    if (number.doubleValue() > 1024.0 * 1024.0 * 32.0) {
      return Double.valueOf(number.doubleValue() / (1024.0 * 1024.0 * 1024.0));
    }
    if (number.doubleValue() > 1024.0 * 32.0) {
      return Double.valueOf(number.doubleValue() / (1024.0 * 1024.0));
    }
    return number;
  }

  private static String classifyDivergence(Double pct) {
    if (pct == null) {
      return "Insufficient data";
    }
    if (pct.doubleValue() > 20.0) {
      return "High";
    }
    if (pct.doubleValue() >= 5.0) {
      return "Moderate";
    }
    return "Good";
  }

  private static String verdictLabelText(String text) {
    String value = defaultText(text);
    if (Pattern.compile("\\b(Unsuccessful|Invalid|Bad|Failed|Degraded)\\b", Pattern.CASE_INSENSITIVE).matcher(value).find()) {
      return "bad";
    }
    if (Pattern.compile("\\b(Successful|Good|Pass)\\b", Pattern.CASE_INSENSITIVE).matcher(value).find()) {
      return "good";
    }
    return "mixed";
  }

  private static String riskRating(Summary summary, Double dbChange, Double divergencePct, boolean cpuMismatch, boolean memoryReduced) {
    if (!"COMPLETED".equals(summary.replayStatus) || (divergencePct != null && divergencePct.doubleValue() > 20.0)) {
      return "High";
    }
    if ((dbChange != null && dbChange.doubleValue() >= 10.0) || cpuMismatch || memoryReduced) {
      return "Moderate";
    }
    if (divergencePct != null && divergencePct.doubleValue() >= 5.0) {
      return "Moderate";
    }
    return "Low";
  }

  private static boolean isNonCoreWorkloadIdentity(String user, String program, String service, String module) {
    String text = (defaultText(user) + " " + defaultText(program) + " " + defaultText(service) + " " + defaultText(module)).toLowerCase(Locale.US);
    return text.contains("oracle")
        || text.contains("sys")
        || text.contains("system")
        || text.contains("background")
        || text.contains("mmon")
        || text.contains("dbw")
        || text.contains("lgwr")
        || text.contains("smon")
        || text.contains("pmon")
        || text.contains("ckpt")
        || text.contains("jq")
        || text.contains("scheduler");
  }

  private static String normalizeSqlId(String value) {
    Matcher matcher = Pattern.compile("\\b[0-9a-v]{13}\\b", Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
    return matcher.find() ? matcher.group().toLowerCase(Locale.US) : "";
  }

  private static Double toNumber(String value) {
    if (value == null) {
      return null;
    }
    String cleaned = value.replace(",", "").replace("%", "").replaceAll("[^0-9.+-]", "");
    if (isBlank(cleaned) || ".".equals(cleaned) || "+".equals(cleaned) || "-".equals(cleaned)) {
      return null;
    }
    try {
      return Double.parseDouble(cleaned);
    } catch (NumberFormatException error) {
      return null;
    }
  }

  private static String unescape(String value) {
    return value
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
  }

  private static String esc(String value) {
    return String.valueOf(value == null ? "" : value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  private static String safeFilePart(String value) {
    return defaultText(value).replaceAll("[^A-Za-z0-9._-]+", "-").replaceAll("-+", "-").replaceAll("^-|-$", "");
  }

  private static String compact(String value) {
    return defaultText(value).toLowerCase(Locale.US).replaceAll("\\s+", "");
  }

  private static int compactIndexOf(String html, String label) {
    Matcher matcher = Pattern.compile(Pattern.quote(defaultText(label)), Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
    return matcher.find() ? matcher.start() : -1;
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (!isBlank(value)) {
        return value;
      }
    }
    return "";
  }

  private static boolean isBlank(String value) {
    return value == null || value.trim().isEmpty();
  }

  private static String defaultText(String value) {
    return isBlank(value) ? "UNKNOWN" : value.trim();
  }

  private static String defaultDash(String value) {
    return isBlank(value) ? "-" : value.trim();
  }

  private static double value(Double input) {
    return input == null || input.isNaN() || input.isInfinite() ? 0.0 : input;
  }

  private static String fmt(Double value, int scale) {
    if (value == null) {
      return "-";
    }
    BigDecimal decimal = BigDecimal.valueOf(value).setScale(scale, RoundingMode.HALF_UP).stripTrailingZeros();
    return decimal.toPlainString();
  }

  private static String signedPct(Double value, int scale) {
    if (value == null) {
      return "-";
    }
    return (value > 0 ? "+" : "") + fmt(value, scale) + "%";
  }

  private static String nullSafePct(Double value) {
    return value == null ? "-" : fmt(value, 2) + "%";
  }

  private static String numberOrDash(Double value) {
    return value == null ? "-" : fmt(value, 2);
  }

  private static String joinSqlIds(List<TopSql> rows, int limit) {
    List<String> ids = new ArrayList<String>();
    for (TopSql row : first(rows, limit)) {
      ids.add(row.sqlId);
    }
    return join(", ", ids);
  }

  private static <T> List<T> first(List<T> rows, int limit) {
    if (rows.size() <= limit) {
      return rows;
    }
    return rows.subList(0, limit);
  }

  private static String join(String sep, String... values) {
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < values.length; i++) {
      if (i > 0) {
        out.append(sep);
      }
      out.append(values[i]);
    }
    return out.toString();
  }

  private static String join(String sep, List<String> values) {
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) {
        out.append(sep);
      }
      out.append(values.get(i));
    }
    return out.toString();
  }
}
