import { explorationLocalTime, explorationOffset, type ExplorationTimeZone } from '@pm25/shared-core';
export const zoneLabel = (zone: ExplorationTimeZone) => zone === 'UTC' ? 'UTC' : 'UTC' + zone;
const fullFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'medium' });
const shortFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export function formatWorkspaceTime(ts: string, zone: ExplorationTimeZone, short = false) {
  return (short ? shortFormatter : fullFormatter).format(new Date(Date.parse(ts) + explorationOffset(zone) * 3600000));
}
export { explorationLocalTime };
