// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectorWidget } from "./DetectorWidget";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderWidget() {
  return render(<DetectorWidget projectId="p1" spec={{ detectorId: "d1" }} />, { wrapper });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("DetectorWidget", () => {
  it("shows a loading state while the detector query is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderWidget();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows a deleted message when the detector 404s", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "not found" }, 404)));
    renderWidget();
    await waitFor(() =>
      expect(screen.getByText("Detector deleted — remove this widget")).toBeTruthy(),
    );
  });

  it("shows a failure message when the detector fetch errors", async () => {
    // The widget hardcodes retry: 1 on the detector query, so the failure
    // state only lands after one retry-delay round trip.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "boom" }, 500)));
    renderWidget();
    await waitFor(() => expect(screen.getByText("Failed to load detector")).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it("renders the happy path: name, findings total, last-finding time, and findings link", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/projects/p1/detectors/d1") {
        return jsonResponse({
          detector: {
            id: "d1",
            projectId: "p1",
            name: "Hallucination detector",
            template: "custom",
            prompt: "check things",
            outputSchema: [],
            sampleRate: 100,
            enableRca: false,
            detectionModel: null,
            detectionProvider: null,
            detectionSource: null,
            createTime: "2026-01-01T00:00:00Z",
            updateTime: "2026-01-01T00:00:00Z",
          },
        });
      }
      if (url === "/api/projects/p1/detectors/d1/runs?identified=true&limit=1") {
        return jsonResponse({
          data: [
            {
              run_id: "r1",
              detector_id: "d1",
              project_id: "p1",
              trace_id: "t1",
              finding_id: "f1",
              status: "done",
              timestamp: "2026-06-01T12:00:00Z",
              summary: "found something",
            },
          ],
          meta: { page: 0, limit: 1, total: 7 },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWidget();

    await waitFor(() => expect(screen.getByText("Hallucination detector")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("7")).toBeTruthy());

    const expectedTimestamp = new Date("2026-06-01T12:00:00Z").toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(expectedTimestamp)).toBeTruthy();

    const findingsLink = screen.getByText("View findings →");
    expect(findingsLink.getAttribute("href")).toBe("/projects/p1/detectors");

    const findingsCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("/runs"),
    );
    expect(findingsCall?.[0]).toBe("/api/projects/p1/detectors/d1/runs?identified=true&limit=1");
  });
});
