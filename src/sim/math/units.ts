/** The sim stores SI (metres). Period oilfield units are for display only. */
export const M_PER_FT = 0.3048;
export const ftToM = (ft: number): number => ft * M_PER_FT;
export const mToFt = (m: number): number => m / M_PER_FT;

/**
 * How a depth is shown: to the nearest whole foot, everywhere, as the crew's own record writes it
 * (seats, the bailer's reports, the driller's log). Display only: the simulation keeps its precision.
 */
export const wholeFeet = (ft: number): number => Math.round(ft);
