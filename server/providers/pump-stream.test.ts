import { describe, expect, it } from "vitest";
import { extractPumpTradeInstructions, PUMP_PROGRAMS } from "./pump-stream";

const pump = PUMP_PROGRAMS[0].address;

describe("Pump.fun confirmed log classification", () => {
  it("recognizes explicit buy and sell variants inside the Pump.fun invocation", () => {
    const logs = [
      `Program ${pump} invoke [1]`,
      "Program log: Instruction: BuyExactQuoteInV3",
      `Program ${pump} success`,
      `Program ${pump} invoke [1]`,
      "Program log: Instruction: SellV3",
      `Program ${pump} success`,
    ];
    const found = extractPumpTradeInstructions(logs, pump);
    expect(found).toEqual([
      { side: "BUY", instruction: "BuyExactQuoteInV3" },
      { side: "SELL", instruction: "SellV3" },
    ]);
  });

  it("does not classify create instructions or a buy-like log from an unrelated program", () => {
    const unrelated = "11111111111111111111111111111111";
    const logs = [
      `Program ${unrelated} invoke [1]`,
      "Program log: Instruction: Buy",
      `Program ${unrelated} success`,
      `Program ${pump} invoke [1]`,
      "Program log: Instruction: CreateV2",
      `Program ${pump} success`,
    ];
    expect(extractPumpTradeInstructions(logs, pump)).toEqual([]);
  });
});
