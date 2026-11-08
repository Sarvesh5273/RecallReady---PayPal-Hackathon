import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../../lib/db";
import { migrate } from "../../scripts/migrate";
import { seedWorkspace } from "../../lib/services/seed";
import { fixtureCandidate, fixtureDocs } from "../../lib/adapters/fixtures";
import { ingestSource, runExtraction } from "../../lib/services/ingestion";
const mocks = vi.hoisted(() => ({
  fetchRecall: vi.fn(),
  extractSource: vi.fn(),
}));
vi.mock("../../lib/adapters/cpsc", () => ({ fetchRecall: mocks.fetchRecall }));
vi.mock("../../lib/adapters/extraction", () => ({
  extractSource: mocks.extractSource,
  extractionReadiness: () => ({
    model: "test-model",
    provider: "GEMINI",
    configured: true,
  }),
}));
async function newWorkspace() {
  return transaction(async (db) => {
    const userId = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,'unusable')",
      [userId, userId + "@example.test"],
    );
    return seedWorkspace(db, userId);
  });
}
beforeAll(migrate);
afterAll(() => pool.end());
beforeEach(() => {
  mocks.fetchRecall.mockReset().mockResolvedValue({
    digits: "26090",
    url: "https://www.cpsc.gov/Recalls/2026/test",
    raw: { RecallNumber: "26090" },
    html: "test raw snapshot",
    documents: fixtureDocs,
    hash: "integration-new-source",
    sourceDate: "2025-11-13",
    fetchedAt: new Date(),
  });
  mocks.extractSource
    .mockReset()
    .mockResolvedValue({
      candidate: fixtureCandidate,
      model: "test-model",
      responseId: "test-response",
      provider: "GEMINI",
    });
});
describe("source extraction reservation", () => {
  it("coalesces concurrent rechecks into one extraction job", async () => {
    const w = await newWorkspace();
    const ids = await Promise.all([
      ingestSource(w.workspaceId, "26090"),
      ingestSource(w.workspaceId, "26090"),
      ingestSource(w.workspaceId, "26090"),
    ]);
    expect(new Set(ids).size).toBe(1);
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='EXTRACT_SOURCE' AND status='READY'",
      [w.workspaceId],
    );
    expect(jobs.rowCount).toBe(1);
  });
  it("reserves one live call across concurrent workers and reuses the validated result", async () => {
    const w = await newWorkspace();
    const sourceId = await ingestSource(w.workspaceId, "26090");
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      started = r;
    });
    mocks.extractSource.mockImplementationOnce(async () => {
      started();
      await held;
      return {
        candidate: fixtureCandidate,
        model: "test-model",
        responseId: "test-response",
        provider: "GEMINI",
      };
    });
    const first = runExtraction(w.workspaceId, sourceId);
    await entered;
    try {
      const second = await runExtraction(w.workspaceId, sourceId);
      expect(mocks.extractSource).toHaveBeenCalledTimes(1);
      release();
      expect(await first).toBe(second);
      expect(await runExtraction(w.workspaceId, sourceId)).toBe(second);
      expect(mocks.extractSource).toHaveBeenCalledTimes(1);
      const quota = await pool.query(
        "SELECT count FROM rate_limits WHERE key=$1",
        ["extract:" + w.workspaceId],
      );
      expect(quota.rows[0].count).toBe(1);
    } finally {
      release();
      await first;
    }
  });
  it("preserves diagnostic detail for rejected evidence and consumes one request", async () => {
    const w = await newWorkspace(),
      sourceId = await ingestSource(w.workspaceId, "26090");
    const { ExtractionValidationError } =
      await import("../../lib/adapters/extraction-contract");
    mocks.extractSource.mockRejectedValueOnce(
      new ExtractionValidationError(fixtureCandidate, "QUOTE_NOT_FOUND"),
    );
    const id = await runExtraction(w.workspaceId, sourceId);
    const saved = await pool.query(
      "SELECT status,validation_errors FROM extractions WHERE id=$1",
      [id],
    );
    expect(saved.rows[0]).toEqual({
      status: "EXTRACTION_FAILED",
      validation_errors: ["AI_EVIDENCE_INVALID", "QUOTE_NOT_FOUND"],
    });
  });
});
