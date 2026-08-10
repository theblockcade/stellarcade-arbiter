import { describe, expect, it } from "vitest";
import { UnimplementedVrfProvider, VrfNotImplementedError } from "./vrf.js";

describe("UnimplementedVrfProvider", () => {
  it("throws VrfNotImplementedError on prove()", async () => {
    const provider = new UnimplementedVrfProvider();
    await expect(provider.prove("input")).rejects.toBeInstanceOf(VrfNotImplementedError);
  });

  it("throws VrfNotImplementedError on verify()", async () => {
    const provider = new UnimplementedVrfProvider();
    await expect(
      provider.verify({ publicKey: "pk", input: "in", output: "out", proof: "proof" }),
    ).rejects.toBeInstanceOf(VrfNotImplementedError);
  });
});
