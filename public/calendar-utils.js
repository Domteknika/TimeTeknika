export const CALENDAR_ZOOMS = [50, 75, 100, 125, 150, 200];

// ISO weeks start on Monday; the Thursday determines the week year.
export function isoWeek(day) {
  const date=new Date(day+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
  const year=date.getUTCFullYear();
  return {year,number:Math.ceil(((date-Date.UTC(year,0,1))/86400000+1)/7)};
}

export function fitCalendarScale(containerHeight,headerHeight,hours){
  return Math.max(4,Math.floor(Math.max(0,containerHeight-headerHeight-2)/hours*100)/100);
}

// Preserve the time scale: only zero/very short entries use a 2 px hit marker.
// A readable label must never lengthen a block into the break that follows it.
export function layoutCalendarEntries(entries, scale, minHour=0, maxHour=24) {
  const dayHeight=(maxHour-minHour)*scale,minimumHeight=2;
  const items=entries.filter(entry=>entry.topHour<maxHour&&entry.endHour>=minHour).map(entry=>{
    const top=Math.max(0,Math.min(dayHeight-minimumHeight,(entry.topHour-minHour)*scale));
    const durationHeight=Math.max(0,(Math.min(maxHour,entry.endHour)-Math.max(minHour,entry.topHour))*scale);
    const gap=Math.min(3,durationHeight*.15);
    const height=Math.min(dayHeight-top,Math.max(minimumHeight,durationHeight-gap));
    return {...entry,top,height,durationHeight:Math.min(height,durationHeight),gap};
  }).sort((a,b)=>a.top-b.top||a.topHour-b.topHour||String(a.key).localeCompare(String(b.key)));
  let group=[],ends=[],groupEnd=-Infinity;
  const finish=()=>{
    for(const item of group){
      item.columns=ends.length;item.span=1;
      for(let col=item.column+1;col<ends.length;col++){
        if(group.some(other=>other.column===col&&other.top<item.top+item.height&&item.top<other.top+other.height))break;
        item.span++;
      }
    }
  };
  for(const item of items){
    if(item.top>=groupEnd){finish();group=[];ends=[];groupEnd=-Infinity;}
    let column=ends.findIndex(end=>end<=item.top);
    if(column===-1)column=ends.length;
    item.column=column;ends[column]=item.top+item.height+item.gap;
    groupEnd=Math.max(groupEnd,ends[column]);group.push(item);
  }
  finish();return items;
}

// Calendar coordinates are wall-clock minutes, independent of device time zone.
export function calendarSelection(anchor, cursor, lower = 0, upper = 1440, step = 15) {
  const snap = value => Math.round(value / step) * step;
  const a = Math.max(lower, Math.min(upper - step, snap(anchor)));
  const b = Math.max(lower, Math.min(upper, snap(cursor)));
  return b < a ? { start: b, end: a } : { start: a, end: Math.max(a + step, b) };
}

export function calendarWallTime(day, minute) {
  if (minute === 1440) {
    day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    minute = 0;
  }
  return `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// Bounds are local midnights supplied by the calendar, including 23/25-hour days.
export function calendarDayTotals(entries, ranges, timestamp) {
  return ranges.map(({ day, from, to }) => ({
    day,
    seconds: entries.reduce((total, entry) => entry.deleted ? total : total + Math.max(0,
      (Math.min(entry.end ?? timestamp, to) - Math.max(entry.start, from)) / 1000), 0)
  }));
}

export function weeklyProgress(entries, from, to, targetMinutes, timestamp) {
  const seconds = entries.reduce((sum, entry) => sum + Math.max(0,
    (Math.min(entry.end ?? timestamp, to) - Math.max(entry.start, from)) / 1000), 0);
  const target = targetMinutes == null ? null : targetMinutes * 60;
  const balance = target === null ? null : seconds - target;
  return {
    seconds, target, balance,
    status: target === null ? 'unset' : balance > 0 ? 'exceeded' : balance === 0 ? 'reached' : timestamp >= to ? 'deficit' : 'remaining',
    remaining: target === null ? null : Math.max(0, target - seconds),
    excess: target === null ? 0 : Math.max(0, seconds - target),
    percent: target === null ? 0 : target === 0 ? 100 : Math.min(100, seconds / target * 100)
  };
}

const balanceDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Zurich', year:'numeric', month:'2-digit', day:'2-digit'});
// Monday-to-Monday bounds: count calendar weeks, not 168-hour blocks (DST).
export function cumulativeProgress(entries, from, to, targetMinutes, timestamp) {
  const day = value => Date.parse(balanceDate.format(value)+'T00:00:00Z');
  const weeks = Math.max(0, Math.round((day(to)-day(from))/(7*86400000)));
  const progress = weeklyProgress(entries.filter(entry=>!entry.deleted), from, Math.min(to,timestamp), targetMinutes==null?null:targetMinutes*weeks, timestamp);
  return {...progress, weeks, from, to,
    status: targetMinutes==null?'unset':weeks===0?'waiting':progress.balance<0?'deficit':progress.balance>0?'exceeded':'reached'};
}

// A long task total is normal; only an uninterrupted personal timer needs a reminder.
export function longRunningEntry(entries, userId, timestamp) {
  return entries.find(entry => entry.user_id === userId && !entry.deleted &&
    entry.end === null && timestamp - entry.start > 6 * 60 * 60 * 1000) ?? null;
}
