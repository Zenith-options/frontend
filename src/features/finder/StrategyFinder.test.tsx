import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyFinder } from "./StrategyFinder";
import { FIXTURE_MARKET } from "./fixtures";

const renderFinder = (onLoad = vi.fn()) => {
  render(
    <StrategyFinder sym="TEST" spot={FIXTURE_MARKET.spot} vol={FIXTURE_MARKET.vol} strikes={FIXTURE_MARKET.strikes}
      expiries={FIXTURE_MARKET.expiries} priceHistory={[]} onLoad={onLoad} />,
  );
  return onLoad;
};

describe("StrategyFinder", () => {
  it("shows ranked candidates and loads one into the builder", async () => {
    const onLoad = renderFinder();
    const rows = await screen.findAllByRole("button", { name: "Load →" }, { timeout: 3000 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    await userEvent.click(rows[0]);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].legs.length).toBeGreaterThan(0);
  });

  it("moves the target marker with the keyboard", async () => {
    renderFinder();
    const slider = screen.getByRole("slider", { name: "Target price" });
    const before = Number(slider.getAttribute("aria-valuenow"));
    slider.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  });

  it("switching outlook re-targets and re-ranks", async () => {
    renderFinder();
    await userEvent.click(screen.getByRole("button", { name: "bearish" }));
    const slider = screen.getByRole("slider", { name: "Target price" });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeLessThan(FIXTURE_MARKET.spot);
    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    expect(within(table).getAllByText(/Bear|Put|Collar/i).length).toBeGreaterThan(0);
  });
});
