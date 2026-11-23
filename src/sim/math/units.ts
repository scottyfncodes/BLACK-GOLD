/** The sim stores SI (metres). Period oilfield units are for display only. */
export const M_PER_FT = 0.3048;
export const ftToM = (ft: number): number => ft * M_PER_FT;
export const mToFt = (m: number): number => m / M_PER_FT;
