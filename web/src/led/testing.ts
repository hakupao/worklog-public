import { __clearBitsCache } from "./bits";
import { __resetLoopForTests } from "./loop";
import { __resetMotionForTests } from "./motion";
import { __resetRegistryForTests } from "./registry";
import { resetWorldStore } from "../world/store";
import { __resetHoverForTests } from "../ui/hover";
import { __resetWorldForTests } from "../world/transitions";

export function __resetLedForTests() {
  __resetLoopForTests(); __resetRegistryForTests(); __resetMotionForTests(); __clearBitsCache();
  __resetWorldForTests(); resetWorldStore();
  __resetHoverForTests();
}
