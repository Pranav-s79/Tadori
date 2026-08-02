import { afterEach, describe, expect, it, vi } from "vitest";
import * as inspectApi from "../inspect/inspectApi.ts";
import { resolveStepNames } from "./stepNames.ts";

afterEach(() => { vi.restoreAllMocks(); });

describe("resolveStepNames", () => {
  it("resolves each distinct key exactly once", async () => {
    const fetchNodeDetail = vi.spyOn(inspectApi, "fetchNodeDetail").mockResolvedValue({
      status: "ok",
      node: { displayName: "getUser", qualifiedName: "svc.UserService.getUser" }
    } as never);

    const names = await resolveStepNames(["k1", "k1", "k2"]);

    expect(fetchNodeDetail).toHaveBeenCalledTimes(2);
    expect(names.get("k1")?.displayName).toBe("getUser");
    expect(names.get("k1")?.qualifiedName).toBe("svc.UserService.getUser");
  });

  /**
   * "Not looked up yet" and "looked up, and this snapshot cannot name it" are
   * different states and the caller has to be able to tell them apart — one
   * shows a pending row, the other says so out loud. Dropping the key would
   * collapse them.
   */
  it("records an unresolvable key instead of dropping it", async () => {
    vi.spyOn(inspectApi, "fetchNodeDetail").mockResolvedValue({ status: "not_found" } as never);

    const names = await resolveStepNames(["missing"]);

    expect(names.has("missing")).toBe(true);
    expect(names.get("missing")?.displayName).toBeNull();
  });

  it("survives a rejected lookup without losing the other steps", async () => {
    vi.spyOn(inspectApi, "fetchNodeDetail").mockImplementation(async (key: string) => {
      if (key === "boom") throw new Error("network");
      return { status: "ok", node: { displayName: "ok", qualifiedName: "m.ok" } } as never;
    });

    const names = await resolveStepNames(["boom", "fine"]);

    expect(names.get("boom")?.displayName).toBeNull();
    expect(names.get("fine")?.displayName).toBe("ok");
  });

  it("returns an empty map for an empty step list without calling the API", async () => {
    const fetchNodeDetail = vi.spyOn(inspectApi, "fetchNodeDetail");

    expect((await resolveStepNames([])).size).toBe(0);
    expect(fetchNodeDetail).not.toHaveBeenCalled();
  });
});
