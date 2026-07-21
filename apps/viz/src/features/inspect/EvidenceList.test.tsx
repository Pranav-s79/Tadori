import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceList } from "./EvidenceList.tsx";
import type { Evidence } from "./inspectApi.ts";

const anchor: Evidence = {
  file: "src/a.ts",
  kind: "source",
  lineStart: 10,
  lineEnd: 12,
  columnStart: null,
  columnEnd: null,
  commitSha: null,
  excerptHash: null
};

describe("EvidenceList", () => {
  it("renders the '+N more' note when omittedCount > 0", () => {
    render(<EvidenceList evidence={[anchor]} omittedCount={3} repoRoot="/repo" />);
    expect(screen.getByText("+3 more")).toBeInTheDocument();
  });

  it("renders no omitted note when omittedCount is 0 (not '+0 more')", () => {
    render(<EvidenceList evidence={[anchor]} omittedCount={0} repoRoot="/repo" />);
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    expect(screen.queryByText("+0 more")).not.toBeInTheDocument();
  });

  it("renders a deep link for a confined anchor path", () => {
    render(<EvidenceList evidence={[anchor]} omittedCount={0} repoRoot="/repo" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "vscode://file//repo/src/a.ts:10");
  });

  it("renders no link element for a non-confined anchor path", () => {
    const escaping: Evidence = { ...anchor, file: "../../etc/passwd" };
    render(<EvidenceList evidence={[escaping]} omittedCount={0} repoRoot="/repo" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The anchor text still appears, just not as a link.
    expect(screen.getByText(/etc\/passwd/)).toBeInTheDocument();
  });

  it("renders no link when repoRoot is null", () => {
    render(<EvidenceList evidence={[anchor]} omittedCount={0} repoRoot={null} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
