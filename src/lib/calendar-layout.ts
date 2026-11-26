import { layoutCalendarEntries } from "../../public/calendar-utils.js";
import type { Entry } from "./types";

type CalendarSegment = Entry & { key: string; topHour: number; endHour: number };
type PositionedSegment = CalendarSegment & {
  top: number;
  height: number;
  column: number;
  columns: number;
  span: number;
};

export function layoutCalendarDay(
  entries: CalendarSegment[],
  scale: number,
  min: number,
  max: number,
  minimumLabelHeight: number,
) {
  const layout = (segments: CalendarSegment[]): PositionedSegment[] => layoutCalendarEntries(segments, scale, min, max);
  const segments = layout(entries);
  const blocks = segments.filter((segment) => segment.height >= minimumLabelHeight);
  const markers = segments.filter((segment) => segment.height < minimumLabelHeight);
  if (!blocks.length || !markers.length) return { blocks, markers };
  return { blocks: layout(blocks), markers: layout(markers) };
}
