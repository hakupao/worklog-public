import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "../src/api/queries";
import { CalSettings } from "../src/pages/settings/CalSettings";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { Prefs } from "../src/prefs/types";
import { V2Context } from "../src/ui/context";

let latest: Prefs = DEFAULT_PREFS;
/** Stateful provider: setPrefs really updates, so the component re-renders from what it saved. */
function Stateful({ children, start = DEFAULT_PREFS }: { children: ReactNode; start?: Prefs }) {
  const [prefs, set] = useState(start);
  latest = prefs;
  return (
    <QueryClientProvider client={createQueryClient()}>
      <V2Context.Provider value={{ prefs, lang: "zh", setPrefs: (f) => set((p) => f(p)), resetPrefs: () => {}, setLang: () => {} }}>
        {children}
      </V2Context.Provider>
    </QueryClientProvider>
  );
}
const setup = (start?: Prefs) => render(<Stateful start={start}><CalSettings /></Stateful>);
const payday = () => screen.getByLabelText("给料日") as HTMLInputElement;

describe("CalSettings", () => {
  it("payday: shows 25, commits on Enter, rolls back an invalid value on blur", () => {
    setup();
    expect(payday().value).toBe("25");
    fireEvent.change(payday(), { target: { value: "31" } });
    fireEvent.keyDown(payday(), { key: "Enter" });
    expect(latest.cal.payday).toBe(31);
    fireEvent.change(payday(), { target: { value: "0" } });
    fireEvent.blur(payday());
    expect(payday().value).toBe("31");
    expect(latest.cal.payday).toBe(31);
  });

  it("renders the 3 default break rows", () => {
    setup();
    expect(screen.getAllByLabelText("休假名称")).toHaveLength(3);
    expect((screen.getAllByLabelText("休假名称")[0] as HTMLInputElement).value).toBe("年末年始");
    expect((screen.getAllByLabelText("起 MM-DD")[0] as HTMLInputElement).value).toBe("12-29");
    expect((screen.getAllByLabelText("止 MM-DD")[0] as HTMLInputElement).value).toBe("01-03");
  });

  it("添加 appends an empty row that is saved only once name, from and to are all valid", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getAllByLabelText("休假名称")).toHaveLength(4);
    const [name, from, to] = ["休假名称", "起 MM-DD", "止 MM-DD"].map((l) => screen.getAllByLabelText(l)[3]);
    expect((name as HTMLInputElement).value).toBe("");
    fireEvent.change(name, { target: { value: "社内休" } });
    fireEvent.blur(name);
    fireEvent.change(from, { target: { value: "13-40" } });
    fireEvent.blur(from);
    expect(latest.cal.breaks).toHaveLength(3);
    fireEvent.change(from, { target: { value: "09-01" } });
    fireEvent.blur(from);
    expect(latest.cal.breaks).toHaveLength(3);
    fireEvent.change(to, { target: { value: "09-03" } });
    fireEvent.blur(to);
    expect(latest.cal.breaks).toHaveLength(4);
    expect(latest.cal.breaks[3]).toEqual({ name: "社内休", from: "09-01", to: "09-03" });
  });

  it("an edited saved row rolls back when invalid, saves when valid", () => {
    setup();
    const from = screen.getAllByLabelText("起 MM-DD")[1] as HTMLInputElement;
    fireEvent.change(from, { target: { value: "99-99" } });
    fireEvent.blur(from);
    expect(from.value).toBe("04-29");
    fireEvent.change(from, { target: { value: "04-28" } });
    fireEvent.blur(from);
    expect(latest.cal.breaks[1].from).toBe("04-28");
  });

  it("× removes a row", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[1]);
    expect(latest.cal.breaks.map((b) => b.name)).toEqual(["年末年始", "お盆"]);
  });

  it("恢复默认日历 restores DEFAULT_PREFS.cal (a copy, not the shared defaults)", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    fireEvent.change(payday(), { target: { value: "10" } });
    fireEvent.keyDown(payday(), { key: "Enter" });
    expect(latest.cal.payday).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认日历" }));
    expect(latest.cal).toEqual(DEFAULT_PREFS.cal);
    expect(latest.cal).not.toBe(DEFAULT_PREFS.cal);
    expect(latest.cal.breaks).not.toBe(DEFAULT_PREFS.cal.breaks);
    expect(latest.cal.breaks[0]).not.toBe(DEFAULT_PREFS.cal.breaks[0]);
  });
});
