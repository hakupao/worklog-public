// The demo entry's first import: the clock is shifted before any other module (server or UI) evaluates.
import { installClock } from "./clock";
installClock();
