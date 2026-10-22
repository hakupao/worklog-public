import { describe, expect, it } from "vitest";
import { joinRequesters, splitRequesters } from "../../src/lib/requesters";

describe("requesters", () => {
  it("splits on 、 , and ，, trimming and dropping blanks and repeats", () => {
    expect(splitRequesters("田中、 佐藤 ,鈴木，田中、")).toEqual(["田中", "佐藤", "鈴木"]);
    expect(splitRequesters("高橋リーダー（開発部）")).toEqual(["高橋リーダー（開発部）"]);
    expect(splitRequesters("")).toEqual([]);
  });

  it("joins with 、", () => {
    expect(joinRequesters(["田中", "佐藤"])).toBe("田中、佐藤");
  });
});
