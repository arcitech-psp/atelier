/**
 * Resolve bounded display occupancy from independently updated pressure fields.
 * @param pressure - latest token-meter projection.
 * @returns occupancy, or null until numerator and capacity are known.
 */
export function contextOccupancy(pressure) {
    const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
    if (usedTokens === undefined || pressure?.contextWindow === undefined)
        return null;
    return {
        percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
        usedTokens,
        contextWindow: pressure.contextWindow,
    };
}
