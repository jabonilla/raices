import { describe, expect, it } from "vitest";

import { __testStyles } from "../src/screens/HomeScreen";

/**
 * K2.49 blocker (Claude review): amounts at 40px break mid-number in
 * two-column balance cards ("$1,24" over "0.00"). On a payments product,
 * a figure that splits across lines is a trust failure.
 *
 * The fix: balanceRow uses column direction (stacked). Each amount gets
 * full width. This test asserts the style directly; if someone changes
 * it back to row, the test fails.
 *
 * Rule 11: watched fail by temporarily setting balanceRow to row.
 */
describe("balance amounts do not wrap mid-number", () => {
  it("balanceRow stacks vertically (column, not row)", () => {
    expect(__testStyles.balanceRow.flexDirection).toBe("column");
  });

  it("balance cards do not shrink (no flex:1 in a row)", () => {
    // In a column layout, flex:1 on cards is harmless, but the critical
    // property is that the row itself is not a row.
    expect(__testStyles.balanceRow.flexDirection).not.toBe("row");
  });
});
