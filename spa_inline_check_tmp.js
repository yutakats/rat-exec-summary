      const fileInput = document.getElementById("spaFiles");
      const selectedFiles = document.getElementById("selectedFiles");
      const statusMessage = document.getElementById("statusMessage");

      function escapeHtml(value) {
        return String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function renderSelectedFiles() {
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
          selectedFiles.textContent = "No files selected.";
          return;
        }

        selectedFiles.innerHTML = `<ul>${files
          .map(
            (file) =>
              `<li><strong>${escapeHtml(file.name)}</strong> (${escapeHtml(
                file.type || "text/html"
              )}, ${file.size.toLocaleString()} bytes)</li>`
          )
          .join("")}</ul>`;
      }

      async function readSelectedReports() {
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
          throw new Error("Please select one or more SPA HTML reports.");
        }

        const reports = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            html: await file.text(),
          }))
        );
        return reports;
      }

      function formatTokenUsage(usage) {
        if (!usage || typeof usage !== "object") {
          return "Token usage unavailable";
        }
        const prompt = Number(usage.input_tokens);
        const completion = Number(usage.output_tokens);
        const total = Number(usage.total_tokens);
        const parts = [];
        if (Number.isFinite(total)) parts.push(`total ${total}`);
        if (Number.isFinite(prompt)) parts.push(`prompt ${prompt}`);
        if (Number.isFinite(completion)) parts.push(`completion ${completion}`);
        return parts.length ? parts.join(" | ") : "Token usage unavailable";
      }

      async function fetchLlmSections(summary) {
        if (window.location.protocol === "file:") {
          throw new Error(
            "The LLM-assisted mode cannot be used from file://. Start apps/api/server.rb and open the app at http://127.0.0.1:4567/apps/web/spa.html."
          );
        }

        const response = await fetch("/api/llm-summary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(window.SpaSummaryApp.buildLLMSummaryPayload(summary)),
        });

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await response.text();
          throw new Error(
            `LLM proxy returned a non-JSON response. Restart apps/api/server.rb and make sure the local server is serving the latest code. Response started with: ${text.slice(0, 120)}`
          );
        }

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "LLM summary request failed.");
        }
        return {
          llmSections: data.llm_sections,
          usage: data.usage || null,
          model: data.model || null,
        };
      }

      function improveErrorMessage(error) {
        const message = String(error?.message || error || "");
        if (message.includes("Failed to fetch")) {
          return new Error(
            "Unable to reach the local LLM proxy. Make sure apps/api/server.rb is running, then open the SPA app at http://127.0.0.1:4567/apps/web/spa.html instead of the local file path."
          );
        }
        return error;
      }

      document.getElementById("openSummary").addEventListener("click", async () => {
        const popup = window.open("", "spa-summary-preview", "width=1260,height=920");
        try {
          if (!popup) {
            throw new Error("Popup blocked. Allow popups for this page.");
          }
          popup.document.open();
          popup.document.write("<p style='font:16px sans-serif;padding:24px'>Building SPA executive summary...</p>");
          popup.document.close();

          statusMessage.textContent = "Reading SPA report files...";
          const reports = await readSelectedReports();
          statusMessage.textContent = `Loaded ${reports.length} file(s). Parsing report content...`;

          const summary = window.SpaSummaryApp.buildSpaSummary({ reports });
          let finalSummary = summary;

          if (document.getElementById("useLlm").checked) {
            popup.document.open();
            popup.document.write("<p style='font:16px sans-serif;padding:24px'>Building SPA executive summary with LLM-assisted narrative...</p>");
            popup.document.close();
            const llmResult = await fetchLlmSections(summary);
            finalSummary = window.SpaSummaryApp.applyLLMSections(summary, llmResult.llmSections, {
              model: llmResult.model,
              usage: llmResult.usage,
            });
            statusMessage.textContent = `LLM narrative generated (${formatTokenUsage(llmResult.usage)}).`;
          }

          statusMessage.textContent =
            `Summary built for task ${finalSummary.task.name || finalSummary.task.id || "unknown task"} using ${finalSummary.reports.length} unique metric report(s).${
              finalSummary.llm?.used ? ` LLM tokens: ${formatTokenUsage(finalSummary.llm.usage)}.` : ""
            }`;
          window.SpaSummaryApp.openSummaryWindow(finalSummary, popup);
        } catch (error) {
          const improved = improveErrorMessage(error);
          statusMessage.textContent = improved.message || String(improved);
          console.error(improved);
          window.SpaSummaryApp.openErrorWindow(improved, popup || undefined);
        }
      });

      document.getElementById("clearFiles").addEventListener("click", () => {
        fileInput.value = "";
        renderSelectedFiles();
        statusMessage.textContent = "Waiting for SPA report files.";
      });

      fileInput.addEventListener("change", () => {
        renderSelectedFiles();
        const count = (fileInput.files || []).length;
        statusMessage.textContent = count
          ? `${count} file(s) selected. Ready to build the SPA executive summary.`
          : "Waiting for SPA report files.";
      });
    