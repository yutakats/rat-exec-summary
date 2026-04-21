# Architecture Diagram

This implementation has two entry paths that share the same core idea:

- local demo flow via [apps/web/index.html](/Users/yutaka/Documents/codex-1/apps/web/index.html)
- Enterprise Manager browser integration via [apps/userscript/enterprise-manager-replay-summary.user.js](/Users/yutaka/Documents/codex-1/apps/userscript/enterprise-manager-replay-summary.user.js)

## System View

```mermaid
flowchart LR
    U[User]

    subgraph Demo["Local Demo"]
      IDX[apps/web/index.html]
      FILES[Three Oracle HTML files<br/>DB Replay / Compare / AWR]
    end

    subgraph EM["Enterprise Manager Integration"]
      EMUI[Enterprise Manager DB Replay page]
      USR[apps/userscript/enterprise-manager-replay-summary.user.js]
      FETCH[Fetch related reports by Replay ID]
    end

    subgraph CORE["Shared Analysis Pipeline"]
      INPUT[Raw report HTML]
      P1[parseDbReplayReport]
      P2[parseCompareReport]
      P3[parseAwrReport]
      ENGINE[buildReplaySummary<br/>rules + heuristics]
      MODEL[Summary model<br/>executive summary, findings,<br/>problems, causes, actions, bottom line]
      RENDER[renderSummaryHtml]
      POPUP[Separate browser window]
      ERROR[Error renderer]
    end

    U --> IDX
    U --> EMUI

    FILES --> IDX
    IDX --> INPUT

    EMUI --> USR
    USR --> FETCH
    FETCH --> INPUT
    EMUI --> INPUT

    INPUT --> P1
    INPUT --> P2
    INPUT --> P3

    P1 --> ENGINE
    P2 --> ENGINE
    P3 --> ENGINE

    ENGINE --> MODEL
    MODEL --> RENDER
    RENDER --> POPUP
    ENGINE --> ERROR
    ERROR --> POPUP
```

## Runtime Flow

```mermaid
sequenceDiagram
    actor User
    participant Entry as apps/web/index.html or EM userscript
    participant Source as Local files / EM report endpoints
    participant Parser as packages/core-parser parser layer
    participant Engine as Summary rules engine
    participant Popup as Summary window

    User->>Entry: Click "Open Executive Summary"
    Entry->>Popup: Open placeholder window
    Entry->>Source: Read or fetch 3 Oracle reports
    Source-->>Entry: DB Replay / Compare / AWR HTML
    Entry->>Parser: Parse report HTML into structured metrics
    Parser-->>Engine: Replay info, divergence, waits, CPU, AWR metrics
    Engine-->>Entry: Summary object
    Entry->>Popup: Render formatted executive summary

    alt Parse or render failure
      Entry->>Popup: Render error details instead of blank page
    end
```

## Logical Layers

```mermaid
flowchart TB
    A[Presentation Layer<br/>apps/web/index.html<br/>summary popup HTML]
    B[Integration Layer<br/>Enterprise Manager userscript<br/>Replay ID based report fetch]
    C[Parsing Layer<br/>HTML DOM parsing<br/>table extraction]
    D[Analysis Layer<br/>heuristics<br/>comparisons<br/>verdict generation]
    E[Output Layer<br/>executive summary<br/>highlighted findings<br/>bottom line]

    A --> C
    B --> C
    C --> D
    D --> E
```

## Main Code Responsibilities

- [apps/web/index.html](/Users/yutaka/Documents/codex-1/apps/web/index.html): local UI, Replay ID entry, popup creation
- [packages/core-parser/replay-summary-core.js](/Users/yutaka/Documents/codex-1/packages/core-parser/replay-summary-core.js): shared parser, analysis logic, summary model, rendering, popup/error handling
- [apps/userscript/enterprise-manager-replay-summary.user.js](/Users/yutaka/Documents/codex-1/apps/userscript/enterprise-manager-replay-summary.user.js): Enterprise Manager button injection, Replay ID-based report retrieval, EM-side summary popup
