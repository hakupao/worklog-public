import { hmOf, jstDate, mdOf } from "../predict/time";

/** Header / 运行情报 / rows: MAC, WIN, or the name in capitals. (Moved here from Header.tsx.) */
export const machineLabel = (name: string) => (/^mac/i.test(name) ? "MAC" : /^win/i.test(name) ? "WIN" : name.toUpperCase());
/** A collection time: HH:MM when it is today in Tokyo, M/D HH:MM otherwise (assumption 1). */
export const seenText = (ms: number, today: string) => (jstDate(ms) === today ? hmOf(ms) : `${mdOf(jstDate(ms))} ${hmOf(ms)}`);
