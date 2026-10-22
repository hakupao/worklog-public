import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BadgeWorld, BADGE_H, TaskBadge, TaskBadges } from "../src/ui/TaskBadge";

describe("TaskBadge", () => {
  it("holds the badge footprint while the engine loads, then shows the badge with the code as its name", async () => {
    const { container } = render(<TaskBadge id="T20261001-01" height={BADGE_H.row} />);
    const box = container.querySelector<HTMLElement>(".tbadge")!;
    expect(box.style.width).toBe("70px"); expect(box.style.height).toBe("22px"); expect(box.dataset.task).toBe("T20261001-01");
    expect(box.title).toBe("1001-01");
    const img = await screen.findByRole("img", { name: "1001-01" }, { timeout: 5000 });
    expect(img.getAttribute("height")).toBe("22");
  });
  it("BadgeWorld picks the material", async () => {
    render(<BadgeWorld.Provider value="omote"><TaskBadge id="T20261001-01" height={36} /></BadgeWorld.Provider>);
    const img = await screen.findByRole("img", { name: "1001-01" }, { timeout: 5000 }) as HTMLImageElement;
    expect(decodeURIComponent(img.src)).toContain("sand-");
  });
});

describe("TaskBadges", () => {
  it("first badge then +k, all codes in the title", async () => {
    const { container } = render(<TaskBadges ids={["T20261001-01", "T20261002-01", "T20261003-02"]} height={22} />);
    expect(container.querySelectorAll(".tbadge")).toHaveLength(1);
    expect(container.querySelector(".tb-more")!.textContent).toBe("+2");
    expect(container.querySelector<HTMLElement>(".tbadges")!.title).toBe("1001-01 1002-01 1003-02");
    await screen.findByRole("img", { name: "1001-01" }, { timeout: 5000 });
  });
  it("dim dims every badge and the +k", () => {
    const { container } = render(<TaskBadges ids={["T20261001-01", "T20261002-01", "T20261003-02"]} height={22} max={2} dim />);
    const bs = container.querySelectorAll(".tbadge");
    expect(bs).toHaveLength(2);
    bs.forEach((b) => expect(b.classList.contains("dim")).toBe(true));
    expect(container.querySelector(".tbadges")!.classList.contains("dim")).toBe(true);
    expect(render(<TaskBadges ids={["T20261001-01"]} height={22} />).container.querySelector(".tbadge.dim")).toBeNull();
  });
  it("a group has the title, its inner badges none; a single badge keeps its code title", () => {
    const multi = render(<TaskBadges ids={["T20261001-01", "T20261002-01"]} height={22} max={2} />).container;
    expect(multi.querySelector(".tbadges")!.getAttribute("title")).toBe("1001-01 1002-01");
    multi.querySelectorAll(".tbadge").forEach((b) => expect(b.hasAttribute("title")).toBe(false));
    const one = render(<TaskBadges ids={["T20261001-01"]} height={22} />).container;
    expect(one.querySelector(".tbadge")!.getAttribute("title")).toBe("1001-01");
  });
  it("max shows more; one id has no +k; none renders nothing", () => {
    expect(render(<TaskBadges ids={["T20261001-01", "T20261002-01"]} height={22} max={2} />).container.querySelectorAll(".tbadge")).toHaveLength(2);
    expect(render(<TaskBadges ids={["T20261001-01"]} height={22} />).container.querySelector(".tb-more")).toBeNull();
    expect(render(<TaskBadges ids={[]} height={22} />).container.innerHTML).toBe("");
  });
});
