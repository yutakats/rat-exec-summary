Project: Oracle SPA Executive Summary Report

Goal:
Enhance the SPA HTML report with decision-quality visuals and analysis.

Key Requirement:
Add workload-level insight that explains differences between SQL-level and workload-level results.

---

SECTION: Executive Summary Enhancements

Add a new subsection called:

"Workload Drivers"

Place it:
- Immediately after the Executive Summary bullet list
- Before the "Workload Reconciliation" section

---

VISUAL 1: Contribution Bar Chart (MANDATORY)

Purpose:
Show which SQL statements contribute most to total workload regression or improvement.

Requirements:
- Use top SQL statements only (focus on highest impact)
- Rank by absolute workload impact
- Show:
  - SQL ID
  - Direction (Improved / Regressed)
  - Contribution % of total workload change
- Use horizontal bars
- Add caption:
  "This chart shows which SQL statements drive the overall workload change."

Rules:
- Do NOT invent contribution numbers
- If exact % cannot be computed, approximate using relative impact or omit %

---

VISUAL 2: Impact vs Frequency Matrix

Purpose:
Explain why workload-level results differ from SQL-level results.

Axes:
- X-axis: Execution frequency
- Y-axis: Per-execution elapsed time (or delta)

Bubble:
- Size: total workload contribution
- Color:
  - Red = regressed
  - Green = improved

Include quadrant explanation:

- High frequency + slower → highest priority
- High frequency + faster → still impactful
- Low frequency + slower → lower priority
- Low frequency + faster → low impact

---

DATA RULES

- Use only data present in the report
- Do not fabricate execution counts or timings
- If missing data:
  - Skip the SQL
  - or label as "N/A"

---

STYLE RULES

- Match existing HTML/CSS design
- Keep visuals lightweight (prefer inline JS or simple SVG)
- Ensure:
  - Works in standalone HTML
  - Printable
  - Responsive

---

IMPORTANT INTERPRETATION RULE

If SQL-level shows improvement but workload-level regresses:

Explain clearly:
- High execution frequency amplifies small per-execution changes
- Workload-level impact takes precedence over SQL-level metrics

---

VALIDATION

After changes:

- Executive Summary content must remain unchanged
- New "Workload Drivers" section must appear in correct position
- HTML must render without errors
- No existing tables or logic should be modified

---

OUTPUT

- Modify the HTML report
- Add minimal CSS/JS if needed
- Summarize changes at the end
