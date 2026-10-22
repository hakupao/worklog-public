import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../../src/api/client";
import { ToastHost } from "../../src/components/Toast";
import { reportWriteError } from "../../src/pages/writeError";

describe("reportWriteError", () => {
  it("lives outside the session drawer, so the plan queue does not pull the drawer in", () => {
    expect(readFileSync("src/pages/plan/write.ts", "utf8")).not.toContain("SessionDrawer");
  });
  it("says refreshed for a 409 and save-failed otherwise", async () => {
    render(<ToastHost />);
    reportWriteError("zh", new ConflictError({}));
    expect(await screen.findByText(/已在别处被修改/)).toBeInTheDocument();
    reportWriteError("en", new Error("x"));
    expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
  });
});
